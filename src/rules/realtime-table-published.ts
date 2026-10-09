import { ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import { snapshotCache } from '../schema/engine.js';
import { schemaForFile, type SchemaLookup } from '../schema/lookup.js';
import type { SnapshotLocation, SnapshotName } from '../schema/snapshot.js';
import type { SchemaView } from '../schema/view.js';
import { readSettings } from '../settings.js';
import { stats, type StatsReason } from '../stats.js';
import { analyzeCall } from '../supabase/calls.js';
import { createRule } from '../util/create-rule.js';
import { unresolvedReason } from './unresolved.js';

export { unresolvedReason };

export type MessageId = 'notPublished' | 'unknownTable' | 'publicationUncertain' | 'unresolved';

/** Why this rule skips a table of a resolved subscription. */
export type RealtimeSkipReason = 'unknown-table' | 'publication-uncertain';

export interface IgnoredTable {
  /** `schema.table`, or `table` in schema `public`. */
  readonly table: string;
  readonly reason: string;
}

export interface Options {
  readonly publication: string;
  readonly ignoreTables: readonly IgnoredTable[];
  readonly reportUnknownTables: boolean;
  readonly reportUnresolved: boolean;
}

export const DEFAULT_PUBLICATION = 'supabase_realtime';

/** What the rule decides for one (schema, table) of a subscription. */
export type Verdict =
  | { readonly kind: 'ok' }
  | { readonly kind: 'report'; readonly messageId: 'notPublished' | 'unknownTable' }
  | { readonly kind: 'skip'; readonly reason: 'unknown-table' }
  | {
      readonly kind: 'skip';
      readonly reason: 'publication-uncertain';
      /** Where the replay lost track of the publication. */
      readonly at: SnapshotLocation | null;
    };

const OK: Verdict = { kind: 'ok' };

/** `schema.name`, as messages and `ignoreTables` write it. */
export function qualified(table: SnapshotName): string {
  return `${table.schema}.${table.name}`;
}

/** The `ignoreTables` entries as qualified names (a bare name is in schema `public`). */
export function ignoredNames(ignoreTables: readonly IgnoredTable[]): ReadonlySet<string> {
  return new Set(
    ignoreTables.map(({ table }) => (table.includes('.') ? table : `public.${table}`)),
  );
}

/**
 * The decision of the rule for a `postgres_changes` subscription on `table` (§6.6, ADR-015):
 * report when the migrations leave the table out of the publication, skip when they make its
 * membership unknown, and skip a table they never create unless `reportUnknownTables` is set.
 */
export function publicationVerdict(
  view: SchemaView,
  table: SnapshotName,
  options: Pick<Options, 'publication' | 'reportUnknownTables'> & {
    readonly ignored: ReadonlySet<string>;
  },
): Verdict {
  if (options.ignored.has(qualified(table))) return OK;
  // Only tables can be published: a view or a table the migrations never create is unknown here.
  const isTable = view.relation(table.schema, table.name)?.kind === 'table';
  if (!isTable && !options.reportUnknownTables) return { kind: 'skip', reason: 'unknown-table' };
  switch (view.inPublication(options.publication, table.schema, table.name)) {
    case 'yes':
      return OK;
    case 'unknown':
      return {
        kind: 'skip',
        reason: 'publication-uncertain',
        at: view.publication(options.publication)?.uncertain ?? null,
      };
    case 'no':
      return { kind: 'report', messageId: isTable ? 'notPublished' : 'unknownTable' };
  }
}

/** Where a migration made the publication uncertain, as `file:line`. */
export function locationText(at: SnapshotLocation | null): string {
  return at === null ? 'an earlier migration' : `${at.file}:${at.line}`;
}

export const realtimeTablePublished = createRule<[Options], MessageId>({
  name: 'realtime-table-published',
  meta: {
    type: 'problem',
    docs: {
      description: 'Require Realtime `postgres_changes` tables to be in the publication',
      recommended: true,
      requiresTypeChecking: true,
    },
    messages: {
      notPublished:
        '`{{table}}` is not in the `{{publication}}` publication in your migrations, so this subscription connects and never receives an event. Add it in a migration: `alter publication {{publication}} add table {{table}};`',
      unknownTable:
        '`{{table}}` is not created as a table in your migrations, so it is not in the `{{publication}}` publication there either, and in a fresh environment this subscription never receives an event. Create the table and add it to the publication in a migration, or list it in `ignoreTables`.',
      publicationUncertain:
        'This subscription is not checked, because your migrations change the `{{publication}}` publication at {{location}} in a way this rule cannot read (a `do` block or a function body), so whether `{{table}}` is a member is unknown. Replace that block with plain statements, such as `alter publication {{publication}} add table {{table}};`.',
      unresolved:
        'This subscription is not checked against your migrations, so a table missing from the `{{publication}}` publication would go unnoticed: {{reason}}',
    },
    schema: [
      {
        type: 'object',
        properties: {
          publication: {
            type: 'string',
            minLength: 1,
            description: 'The publication Realtime reads changes from.',
          },
          ignoreTables: {
            type: 'array',
            description:
              'Tables not to check, each with the reason (for example, published from the dashboard on purpose).',
            items: {
              type: 'object',
              properties: {
                table: {
                  type: 'string',
                  minLength: 1,
                  description:
                    'In an `ignoreTables` entry: `schema.table`, or `table` in schema `public`.',
                },
                reason: {
                  type: 'string',
                  minLength: 1,
                  description: 'In an `ignoreTables` entry: why the table is not checked.',
                },
              },
              required: ['table', 'reason'],
              additionalProperties: false,
            },
          },
          reportUnknownTables: {
            type: 'boolean',
            description:
              'Also report subscriptions to tables that no migration creates, instead of skipping them.',
          },
          reportUnresolved: {
            type: 'boolean',
            description:
              'Report subscriptions the rule cannot check (dynamic names, no project, membership changed in a `do` block), instead of skipping them.',
          },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [
      {
        publication: DEFAULT_PUBLICATION,
        ignoreTables: [],
        reportUnknownTables: false,
        reportUnresolved: false,
      },
    ],
  },
  create(context, [options]) {
    // Settings first, so a settings error fails every typed file, not only files with a project.
    const settings = readSettings(context);
    const services = ESLintUtils.getParserServices(context);
    const ignored = ignoredNames(options.ignoreTables);
    const publication = options.publication;
    stats.recordFile(context.filename);

    // Replayed only when the file has a subscription.
    let lookup: SchemaLookup | undefined;

    const unresolved = (node: TSESTree.Node, reason: StatsReason, table?: string) => {
      stats.recordCall(node, reason);
      if (!options.reportUnresolved) return;
      context.report({
        node,
        messageId: 'unresolved',
        data: { publication, reason: unresolvedReason(reason, table) },
      });
    };

    return {
      CallExpression(node) {
        const call = analyzeCall(services, node);
        if (call?.kind !== 'realtime') return;
        if (call.skip !== undefined) {
          unresolved(node, call.skip);
          return;
        }
        lookup ??= schemaForFile(snapshotCache, context.filename, settings);
        if (lookup.skip !== undefined) {
          unresolved(node, lookup.skip);
          return;
        }
        const view = lookup.view;
        for (const schema of call.schemas) {
          for (const name of call.tables) {
            const table = qualified({ schema, name });
            const verdict = publicationVerdict(
              view,
              { schema, name },
              { publication, reportUnknownTables: options.reportUnknownTables, ignored },
            );
            if (verdict.kind === 'ok') {
              stats.recordCall(node, undefined);
            } else if (verdict.kind === 'report') {
              stats.recordCall(node, undefined);
              context.report({ node, messageId: verdict.messageId, data: { table, publication } });
            } else if (verdict.reason === 'unknown-table') {
              unresolved(node, verdict.reason, table);
            } else {
              stats.recordCall(node, verdict.reason);
              if (!options.reportUnresolved) continue;
              context.report({
                node,
                messageId: 'publicationUncertain',
                data: { table, publication, location: locationText(verdict.at) },
              });
            }
          }
        }
      },
    };
  },
});
