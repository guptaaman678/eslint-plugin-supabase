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

export type MessageId =
  'noSelectPolicy' | 'updatesNoRows' | 'deletesNoRows' | 'subscriptionNoEvents' | 'unresolved';

/**
 * Why this rule skips a call or a table: a subscription whose event is not a literal, a relation
 * the migrations never create, a view (RLS applies to the tables it reads, ADR-007).
 */
export type RlsSkipReason = 'dynamic-event' | 'unknown-relation' | 'view';

export interface Options {
  readonly ignoreTables: readonly IgnoredTable[];
  readonly reportUnresolved: boolean;
}

/** What a call needs from the policies of its table (§6.6, ADR-007). */
export type Access =
  | { readonly kind: 'read' }
  | { readonly kind: 'update' | 'delete'; readonly filtered: boolean }
  | { readonly kind: 'subscription' };

/** What the rule decides for one (schema, table) of a call. */
export type Verdict =
  | { readonly kind: 'ok' }
  | {
      readonly kind: 'report';
      readonly messageId: Exclude<MessageId, 'unresolved'>;
      /** RLS came from the automatic RLS trigger (ADR-010). */
      readonly autoRls: boolean;
    }
  | { readonly kind: 'skip'; readonly reason: 'unknown-relation' | 'view' };

const OK: Verdict = { kind: 'ok' };

/** Subscription events that RLS silences; DELETE events still arrive (ADR-007 item 4). */
const SILENCED_EVENTS: readonly string[] = ['INSERT', 'UPDATE', '*'];

/**
 * What a call needs, `undefined` for a call this rule does not check (`insert` and every
 * `upsert` fail loudly with 42501; a DELETE-only subscription still gets its events), or
 * `dynamic-event` for a subscription whose event is not a literal.
 */
export function accessOf(call: TableCall | Subscription): Access | 'dynamic-event' | undefined {
  if (call.kind === 'realtime') {
    if (call.events === undefined) return 'dynamic-event';
    return call.events.some((event) => SILENCED_EVENTS.includes(event))
      ? { kind: 'subscription' }
      : undefined;
  }
  switch (call.operation) {
    case 'select':
      return { kind: 'read' };
    case 'update':
    case 'delete':
      return { kind: call.operation, filtered: call.filtered };
    default:
      return undefined;
  }
}

/** `service_role` bypasses RLS, so a role set that includes it is never reported (§6.5). */
export function bypassesRls(roles: readonly Role[]): boolean {
  return roles.includes('service_role');
}

/**
 * The decision of the rule for a call by `roles` (without `service_role`) on `table` (§6.6,
 * ADR-007): with RLS on, report when no role in the set has a permissive policy for the command
 * (or `all`) whose `using` is not literally `false`. A filtered update or delete also needs a
 * select policy, because its filter reads rows. Views and relations the migrations never create
 * are skipped.
 */
export function rlsVerdict(
  view: SchemaView,
  table: SnapshotName,
  roles: readonly Role[],
  access: Access,
  ignored: ReadonlySet<string>,
): Verdict {
  if (ignored.has(qualified(table))) return OK;
  const relation = view.relation(table.schema, table.name);
  if (relation === undefined) return { kind: 'skip', reason: 'unknown-relation' };
  if (relation.kind === 'view') return { kind: 'skip', reason: 'view' };
  if (!relation.rls.enabled) return OK;
  const allows = (command: Privilege) =>
    roles.some((role) =>
      view
        .policies(role, table.schema, table.name, command)
        .some((policy) => policy.using !== 'false'),
    );
  const autoRls = relation.rls.source === 'auto-rls';
  switch (access.kind) {
    case 'read':
      return allows('select') ? OK : { kind: 'report', messageId: 'noSelectPolicy', autoRls };
    case 'subscription':
      return allows('select') ? OK : { kind: 'report', messageId: 'subscriptionNoEvents', autoRls };
    default: {
      const passes = allows(access.kind) && (!access.filtered || allows('select'));
      if (passes) return OK;
      const messageId = access.kind === 'update' ? 'updatesNoRows' : 'deletesNoRows';
      return { kind: 'report', messageId, autoRls };
    }
  }
}

/** Inserted after "has row level security on" when RLS came from the trigger (ADR-010 item 5). */
export const VIA_AUTO_RLS = ' (RLS is on via the `ensure_rls` trigger)';

/** The role set as the messages name it: `anon or authenticated`. */
export function rolesText(roles: readonly Role[]): string {
  return roles.join(' or ');
}

export const rlsReadable = createRule<[Options], MessageId>({
  name: 'rls-readable',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a row level security policy for client reads, filtered writes and subscriptions',
      recommended: true,
      requiresTypeChecking: true,
    },
    messages: {
      noSelectPolicy:
        '`{{table}}` has row level security on{{via}} and no select policy for {{roles}} in your migrations, so this read returns no rows and no error. Add a select policy, or read it through a function or a server-side client.',
      updatesNoRows:
        '`{{table}}` has row level security on{{via}} and no update policy (or no select policy, which updates need to find rows) for {{roles}} in your migrations, so this update changes no rows and returns no error. Add an update policy and a select policy, or run it through a function or a server-side client.',
      deletesNoRows:
        '`{{table}}` has row level security on{{via}} and no delete policy (or no select policy, which deletes need to find rows) for {{roles}} in your migrations, so this delete removes no rows and returns no error. Add a delete policy and a select policy, or run it through a function or a server-side client.',
      subscriptionNoEvents:
        '`{{table}}` has row level security on{{via}} and no select policy for {{roles}} in your migrations, so this subscription receives no insert or update events, and delete events arrive with only the primary key. Add a select policy.',
      unresolved:
        'This call is not checked against your row level security policies, so a missing policy would go unnoticed: {{reason}}',
    },
    schema: [
      {
        type: 'object',
        properties: {
          ignoreTables: {
            type: 'array',
            description:
              'Tables not to check, each with the reason (for example, read only through a server-side client).',
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
              'Report calls the rule cannot check (dynamic names, untraceable clients, no project, views), instead of skipping them.',
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
        const access = accessOf(call);
        if (access === undefined) {
          stats.recordCall(node, undefined);
          return;
        }
        if (access === 'dynamic-event') {
          unresolved(node, access);
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
        if (bypassesRls(client.roles)) {
          stats.recordCall(node, undefined);
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
        const roles = rolesText(client.roles);
        for (const schema of call.schemas) {
          for (const name of call.tables) {
            const table = qualified({ schema, name });
            const verdict = rlsVerdict(view, { schema, name }, client.roles, access, ignored);
            if (verdict.kind === 'skip') {
              unresolved(node, verdict.reason, table);
              continue;
            }
            stats.recordCall(node, undefined);
            if (verdict.kind === 'ok') continue;
            context.report({
              node,
              messageId: verdict.messageId,
              data: { table, roles, via: verdict.autoRls ? VIA_AUTO_RLS : '' },
            });
          }
        }
      },
    };
  },
});
