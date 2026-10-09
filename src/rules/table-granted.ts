import { ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import { resolveClientRoles } from '../roles/resolve.js';
import { snapshotCache } from '../schema/engine.js';
import { projectForFile } from '../schema/project.js';
import { schemaForFile, type SchemaLookup } from '../schema/lookup.js';
import type { SnapshotName } from '../schema/snapshot.js';
import type { Privilege, SchemaView } from '../schema/view.js';
import { readSettings, type Role } from '../settings.js';
import { stats, type StatsReason } from '../stats.js';
import { analyzeCall, type Subscription, type TableCall } from '../supabase/calls.js';
import { createRule } from '../util/create-rule.js';
import { ignoredNames, qualified, type IgnoredTable } from './realtime-table-published.js';
import { unresolvedReason } from './unresolved.js';

export type MessageId = 'noPrivilege' | 'subscriptionNoPrivilege' | 'unresolved';

export interface Options {
  readonly ignoreTables: readonly IgnoredTable[];
  readonly reportUnresolved: boolean;
}

/** What the rule decides for one (schema, table) of a call. */
export type Verdict =
  | { readonly kind: 'ok' }
  | {
      readonly kind: 'report';
      /** The role the message names: the one that misses the fewest privileges. */
      readonly role: Role;
      /** The privileges that role misses, in the order the call needs them. */
      readonly missing: readonly Privilege[];
    }
  | { readonly kind: 'skip'; readonly reason: 'unknown-relation' };

const OK: Verdict = { kind: 'ok' };

/**
 * The table privileges a call needs (`research/postgrest-privileges.md` §10.1, ADR-008): a
 * subscription needs SELECT; a write needs SELECT too when it returns rows (`.select()`), when a
 * filter reads rows, or for an `upsert` (merge also needs UPDATE). An `upsert` whose
 * `ignoreDuplicates` is not a literal needs only what both forms need: INSERT and SELECT.
 */
export function privilegesOf(call: TableCall | Subscription): readonly Privilege[] {
  if (call.kind === 'realtime') return ['select'];
  switch (call.operation) {
    case 'select':
      return ['select'];
    case 'insert':
      return call.returning ? ['insert', 'select'] : ['insert'];
    case 'update':
    case 'delete':
      return call.filtered || call.returning ? [call.operation, 'select'] : [call.operation];
    case 'upsert':
      return call.ignoreDuplicates === false
        ? ['insert', 'update', 'select']
        : ['insert', 'select'];
    default:
      return [];
  }
}

/**
 * The decision of the rule for a call by `roles` that needs `needed` on `table` (§6.6, ADR-008):
 * report when no role in the set holds every privilege, through a table or column grant to the
 * role or PUBLIC. The report names the role that misses the fewest privileges (the last in the
 * set on a tie, so `authenticated` for the default set). Relations the migrations never create
 * are skipped.
 */
export function grantVerdict(
  view: SchemaView,
  table: SnapshotName,
  roles: readonly Role[],
  needed: readonly Privilege[],
  ignored: ReadonlySet<string>,
): Verdict {
  if (ignored.has(qualified(table))) return OK;
  if (view.relation(table.schema, table.name) === undefined) {
    return { kind: 'skip', reason: 'unknown-relation' };
  }
  let closest: { readonly role: Role; readonly missing: readonly Privilege[] } | undefined;
  for (const role of roles) {
    const missing = needed.filter(
      (privilege) => !view.canUse(role, table.schema, table.name, privilege),
    );
    if (missing.length === 0) return OK;
    if (closest === undefined || missing.length <= closest.missing.length) {
      closest = { role, missing };
    }
  }
  return closest === undefined ? OK : { kind: 'report', ...closest };
}

/** The privileges as the message names them: `insert`, `insert or select`, `insert, update or select`. */
export function privilegesText(privileges: readonly Privilege[]): string {
  if (privileges.length < 2) return privileges.join('');
  return `${privileges.slice(0, -1).join(', ')} or ${privileges.at(-1)!}`;
}

export const tableGranted = createRule<[Options], MessageId>({
  name: 'table-granted',
  meta: {
    type: 'problem',
    docs: {
      description: 'Require the table privileges that client calls and subscriptions need',
      recommended: true,
      requiresTypeChecking: true,
    },
    messages: {
      noPrivilege:
        '{{role}} has no {{privileges}} privilege on `{{table}}` in your migrations, so this call fails with 42501 (permission denied). Fix in a migration: `grant {{grants}} on {{table}} to {{role}};`',
      subscriptionNoPrivilege:
        '{{role}} has no select privilege on `{{table}}` in your migrations, so this subscription receives no data (events arrive with an Unauthorized error, or a filtered subscription is rejected after SUBSCRIBED). Fix in a migration: `grant select on {{table}} to {{role}};`',
      unresolved:
        'This call is not checked against your table grants, so a missing privilege would go unnoticed: {{reason}}',
    },
    schema: [
      {
        type: 'object',
        properties: {
          ignoreTables: {
            type: 'array',
            description:
              'Tables not to check, each with the reason (for example, granted outside the migrations).',
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
          reportUnresolved: {
            type: 'boolean',
            description:
              'Report calls the rule cannot check (dynamic names, untraceable clients, no project, tables the migrations never create), instead of skipping them.',
          },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ ignoreTables: [], reportUnresolved: false }],
  },
  create(context, [options]) {
    // Settings first, so a settings error fails every typed file, not only files with a project.
    const settings = readSettings(context);
    const services = ESLintUtils.getParserServices(context);
    const ignored = ignoredNames(options.ignoreTables);
    stats.recordFile(context.filename);

    // Found, and replayed, only when the file has a call to check.
    let projectDir: string | null | undefined;
    let lookup: SchemaLookup | undefined;

    const unresolved = (node: TSESTree.Node, reason: StatsReason, table?: string) => {
      stats.recordCall(node, reason);
      if (!options.reportUnresolved) return;
      context.report({
        node,
        messageId: 'unresolved',
        data: { reason: unresolvedReason(reason, table) },
      });
    };

    return {
      CallExpression(node) {
        const call = analyzeCall(services, node);
        if (call === undefined || call.kind === 'rpc') return;
        if (call.skip !== undefined) {
          unresolved(node, call.skip);
          return;
        }
        if (projectDir === undefined) {
          projectDir = projectForFile(context.filename, settings.projectDir) ?? null;
        }
        if (projectDir === null) {
          unresolved(node, 'no-project');
          return;
        }
        const client = resolveClientRoles(services, call, settings, projectDir);
        if (client.skip !== undefined) {
          unresolved(node, client.skip);
          return;
        }
        lookup ??= schemaForFile(snapshotCache, context.filename, {
          projectDir,
          grantsLintConfig: settings.grantsLintConfig,
        });
        if (lookup.skip !== undefined) {
          unresolved(node, lookup.skip);
          return;
        }
        const view = lookup.view;
        const needed = privilegesOf(call);
        const messageId = call.kind === 'realtime' ? 'subscriptionNoPrivilege' : 'noPrivilege';
        for (const schema of call.schemas) {
          for (const name of call.tables) {
            const table = qualified({ schema, name });
            const verdict = grantVerdict(view, { schema, name }, client.roles, needed, ignored);
            if (verdict.kind === 'skip') {
              unresolved(node, verdict.reason, table);
              continue;
            }
            stats.recordCall(node, undefined);
            if (verdict.kind === 'ok') continue;
            context.report({
              node,
              messageId,
              data: {
                role: verdict.role,
                table,
                privileges: privilegesText(verdict.missing),
                grants: verdict.missing.join(', '),
              },
            });
          }
        }
      },
    };
  },
});
