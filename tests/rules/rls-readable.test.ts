import type { InvalidTestCase, ValidTestCase } from '@typescript-eslint/rule-tester';
import {
  rlsReadable,
  VIA_AUTO_RLS,
  type MessageId,
  type Options,
} from '../../src/rules/rls-readable.js';
import { unresolvedReason } from '../../src/rules/unresolved.js';
import { loadEngine } from '../../src/schema/engine.js';
import type { StatsReason } from '../../src/stats.js';
import { createRuleTester, schemaFixture } from '../harness/rule-tester.js';

// The rule replays real migrations through the engine (ADR-016).
await loadEngine();

const HEADER = [
  "import { createClient } from '@supabase/supabase-js';",
  "const supabase = createClient('http://localhost:54321', 'sb_publishable_test');",
  '',
].join('\n');

const code = (body: string): string => HEADER + body;

/** `supabase.from(table)` with this chain, in `public` or through `.schema(schema)`. */
const from = (table: string, chain: string, schema?: string): string =>
  code(
    `export async function run() {\n  return supabase${schema === undefined ? '' : `.schema('${schema}')`}.from('${table}')${chain};\n}`,
  );

/** A `postgres_changes` subscription on `public.<table>` for `event`. */
const subscribe = (table: string, event = '*'): string =>
  code(
    `supabase\n  .channel('changes')\n  .on('postgres_changes', { event: '${event}', schema: 'public', table: '${table}' }, (payload) => payload)\n  .subscribe((status) => status);`,
  );

interface CaseSettings {
  readonly clients?: readonly { readonly callee?: string; readonly role: unknown }[];
  readonly unknownKey?: 'skip';
}

const settings = (fixture: string, extra: CaseSettings = {}) => ({
  supabase: { projectDir: schemaFixture(fixture), ...extra },
});

type Valid = ValidTestCase<[Options]>;
type Invalid = InvalidTestCase<MessageId, [Options]>;

/** Users pass some options; ESLint fills in the rest from `meta.defaultOptions`. */
const partial = (options: Partial<Options>): [Options] => [options as Options];

function valid(
  fixture: string,
  source: string,
  options?: Partial<Options>,
  extra?: CaseSettings,
): Valid {
  return {
    code: source,
    settings: settings(fixture, extra),
    ...(options === undefined ? {} : { options: partial(options) }),
  };
}

const ANON_OR_AUTHENTICATED = 'anon or authenticated';

function report(
  fixture: string,
  source: string,
  messageId: Exclude<MessageId, 'unresolved'>,
  tables: string[],
  more: {
    readonly roles?: string;
    readonly auto?: boolean;
    readonly options?: Partial<Options>;
    readonly extra?: CaseSettings;
  } = {},
): Invalid {
  return {
    ...valid(fixture, source, more.options, more.extra),
    errors: tables.map((table) => ({
      messageId,
      data: {
        table,
        roles: more.roles ?? ANON_OR_AUTHENTICATED,
        via: more.auto === true ? VIA_AUTO_RLS : '',
      },
    })),
  };
}

function unresolved(
  fixture: string | undefined,
  source: string,
  reason: StatsReason,
  table?: string,
  extra?: CaseSettings,
): Invalid {
  return {
    code: source,
    ...(fixture === undefined ? {} : { settings: settings(fixture, extra) }),
    options: partial({ reportUnresolved: true }),
    errors: [{ messageId: 'unresolved', data: { reason: unresolvedReason(reason, table) } }],
  };
}

const F = 'rls-readable';
/** Policies created in `do` blocks (ADR-023): on `todos` (RLS on) and `scores` (RLS off). */
const DO_BLOCK = 'rls-policy-do-block';
const DO_BLOCK_AT = 'supabase/migrations/20260101000000_tables.sql:13';
const SERVICE_ROLE_CLIENT = [
  "import { createClient } from '@supabase/supabase-js';",
  "const admin = createClient('http://localhost:54321', process.env.SUPABASE_SERVICE_ROLE_KEY!);",
  "export const rows = admin.from('orders').select();",
].join('\n');
const AS_AUTHENTICATED: CaseSettings = {
  clients: [{ callee: 'createClient', role: 'authenticated' }],
};
const UNTRACEABLE_CLIENT = [
  "import type { SupabaseClient } from '@supabase/supabase-js';",
  'export async function list(client: SupabaseClient) {',
  "  return client.from('orders').select();",
  '}',
].join('\n');
const UNKNOWN_KEY_CLIENT = [
  "import { createClient } from '@supabase/supabase-js';",
  'declare const key: string;',
  "const client = createClient('http://localhost:54321', key);",
  "export const rows = client.from('orders').select();",
].join('\n');
const DYNAMIC_EVENT = code(
  "declare const event: string;\nsupabase.channel('c').on('postgres_changes', { event, schema: 'public', table: 'orders' }, (p) => p).subscribe((s) => s);",
);

createRuleTester().run('rls-readable', rlsReadable, {
  valid: [
    // A role set where one role passes: authenticated has a select policy, anon has none.
    valid(F, from('todos', '.select()')),
    // A PUBLIC policy for ALL commands admits reads, filtered writes and subscriptions.
    valid(F, from('messages', '.select()')),
    valid(F, from('messages', ".update({ body: 'x' }).eq('id', 1).select()")),
    valid(F, from('messages', ".delete().eq('id', 1)")),
    valid(F, subscribe('messages')),
    // Filtered writes with both the write policy and a select policy.
    valid(F, from('todos', ".update({ title: 'x' }).eq('id', 1)")),
    valid(F, from('todos', ".delete().eq('id', 1).select()")),
    // An unfiltered update or delete needs only the update or delete policy.
    valid(F, from('orders', '.update({ total: 1 })', 'app')),
    valid(F, from('orders', '.delete()', 'app')),
    // RLS off.
    valid(F, from('messages', '.select()', 'app')),
    valid('rls', from('orders', '.select()')),
    valid('rls', from('messages', '.select()')),
    // Views are skipped (RLS applies to the tables they read).
    valid(F, from('todo_titles', '.select()')),
    // `insert(...).select()`, `insert` and every `upsert` fail loudly, so they are not checked.
    valid(F, from('orders', '.insert({ total: 1 }).select()')),
    valid(F, from('orders', '.insert({ total: 1 })')),
    valid(F, from('orders', '.upsert({ id: 1, total: 1 })')),
    valid(F, from('orders', '.upsert({ id: 1, total: 1 }, { ignoreDuplicates: true }).select()')),
    valid(F, from('audit_log', '.insert({ entry: "x" })', 'app')),
    // A DELETE-only subscription still receives its events (with the primary key only).
    valid(F, subscribe('orders', 'DELETE')),
    // A service role client bypasses RLS, from its key name or from settings.
    valid(F, SERVICE_ROLE_CLIENT),
    valid(F, from('orders', '.select()'), undefined, {
      clients: [{ callee: 'createClient', role: 'service_role' }],
    }),
    // `ignoreTables`, qualified or a bare name in `public`.
    valid(F, from('orders', '.select()'), {
      ignoreTables: [{ table: 'public.orders', reason: 'Read through a server-side client' }],
    }),
    valid(F, from('orders', '.select()'), {
      ignoreTables: [{ table: 'orders', reason: 'Read through a server-side client' }],
    }),
    valid(F, from('orders', ".update({ total: 1 }).eq('id', 1)", 'app'), {
      ignoreTables: [{ table: 'app.orders', reason: 'Updated by a function' }],
    }),
    // A select policy for anon passes the default role set.
    valid(F, from('scores', '.select()', 'app')),
    // No role holds update or delete: the write fails with 42501, which table-granted reports
    // (ADR-025 item 2).
    valid(F, from('orders_archive', ".update({ total: 1 }).eq('id', 1)")),
    valid(F, from('orders_archive', '.delete()')),
    // Real migrations: an altered policy, a `db pull` baseline, the auto-RLS trigger.
    valid('policies', from('todos', '.select()')),
    valid('db-pull', from('todos', '.select()')),
    // The baseline's own tables keep their dumped RLS state (ADR-019): `messages` has RLS off.
    valid('db-pull', subscribe('messages')),
    valid('rls-auto-trigger', from('messages', '.select()')),
    valid('rls-auto-trigger', from('scores', '.select()')),
    // Not resolvable: skipped and counted, never guessed.
    valid(
      F,
      code('declare const table: string;\nexport const rows = supabase.from(table).select();'),
    ),
    valid(F, code("export const query = supabase.from('orders');")),
    valid(F, UNTRACEABLE_CLIENT),
    valid(F, UNKNOWN_KEY_CLIENT, undefined, { unknownKey: 'skip' }),
    valid(F, from('not_created', '.select()')),
    valid(F, DYNAMIC_EVENT),
    from('orders', '.select()'),
    valid('bad-config', from('todos', '.select()')),
    // A `do` block creates the policy (ADR-023): skipped, not reported; RLS off decides first.
    valid(DO_BLOCK, from('todos', '.select()')),
    valid(DO_BLOCK, from('todos', ".update({ title: 'x' }).eq('id', 1)")),
    valid(DO_BLOCK, from('scores', '.select()'), { reportUnresolved: true }),
    // Not a table call: RPC, broadcast, a local class.
    valid(F, code("export const done = supabase.rpc('archive_orders');")),
    valid(
      F,
      code(
        "supabase.channel('room').on('broadcast', { event: 'orders' }, (p) => p).subscribe((s) => s);",
      ),
    ),
    valid(
      F,
      "class Store {\n  from(_table: string) {\n    return { select: () => [] };\n  }\n}\nexport const rows = new Store().from('orders').select();",
    ),
  ],
  invalid: [
    // Reads: no policy at all, `count`/`head`, restrictive-only, `using (false)`.
    report(F, from('orders', '.select()'), 'noSelectPolicy', ['public.orders']),
    report(F, from('orders', ".select('*', { count: 'exact', head: true })"), 'noSelectPolicy', [
      'public.orders',
    ]),
    report(F, from('scores', '.select()'), 'noSelectPolicy', ['public.scores']),
    report(F, from('audit_log', '.select()'), 'noSelectPolicy', ['public.audit_log']),
    // A role set where no role passes: settings map the client to authenticated only.
    report(F, from('scores', '.select()', 'app'), 'noSelectPolicy', ['app.scores'], {
      roles: 'authenticated',
      extra: AS_AUTHENTICATED,
    }),
    // Update or delete with `.select()`, and without.
    report(F, from('orders', ".update({ total: 1 }).eq('id', 1).select()"), 'updatesNoRows', [
      'public.orders',
    ]),
    report(F, from('orders', ".delete().eq('id', 1).select()"), 'deletesNoRows', ['public.orders']),
    report(F, from('orders', ".update({ total: 1 }).eq('id', 1)"), 'updatesNoRows', [
      'public.orders',
    ]),
    // A filtered update or delete with its write policy but no select policy.
    report(F, from('orders', ".update({ total: 1 }).eq('id', 1)", 'app'), 'updatesNoRows', [
      'app.orders',
    ]),
    report(F, from('orders', ".delete().in('id', [1, 2])", 'app'), 'deletesNoRows', ['app.orders']),
    // An unfiltered update or delete without its write policy.
    report(F, from('orders', '.delete()'), 'deletesNoRows', ['public.orders']),
    report(F, from('audit_log', ".update({ entry: 'x' })"), 'updatesNoRows', ['public.audit_log']),
    // Select is still granted on a table with writes revoked, so its reads are checked.
    report(F, from('orders_archive', '.select()'), 'noSelectPolicy', ['public.orders_archive']),
    // Subscriptions: INSERT, UPDATE and `*` events are silenced by RLS.
    report(F, subscribe('orders'), 'subscriptionNoEvents', ['public.orders']),
    report(F, subscribe('orders', 'INSERT'), 'subscriptionNoEvents', ['public.orders']),
    report(F, subscribe('audit_log', 'UPDATE'), 'subscriptionNoEvents', ['public.audit_log']),
    // RLS from the `ensure_rls` trigger (ADR-010), in a migration and after a `db pull` baseline.
    report('rls-auto-trigger', from('todos', '.select()'), 'noSelectPolicy', ['public.todos'], {
      auto: true,
    }),
    report('db-pull', from('scores', '.select()'), 'noSelectPolicy', ['public.scores'], {
      auto: true,
    }),
    // RLS on (and forced) with no policy, in another fixture.
    report('rls', from('todos', '.select()'), 'noSelectPolicy', ['public.todos']),
    report('rls', from('audit_log', '.select()'), 'noSelectPolicy', ['public.audit_log']),
    // A union names each member that fails.
    report(
      F,
      code(
        "declare const table: 'orders' | 'messages' | 'scores';\nexport const rows = supabase.from(table).select();",
      ),
      'noSelectPolicy',
      ['public.orders', 'public.scores'],
    ),
    // A query held in a variable, inside a `forEach` body, through `db.schema`.
    report(
      F,
      code(
        "const query = supabase.from('orders').select('id');\nexport const run = async () => await query;",
      ),
      'noSelectPolicy',
      ['public.orders'],
    ),
    report(
      F,
      code(
        "[1, 2].forEach((id) => {\n  void supabase.from('orders').delete().eq('id', id).then();\n});",
      ),
      'deletesNoRows',
      ['public.orders'],
    ),
    report(
      F,
      "import { createClient } from '@supabase/supabase-js';\nconst app = createClient('http://localhost:54321', 'sb_publishable_test', { db: { schema: 'app' } });\nexport const rows = app.from('orders').select();",
      'noSelectPolicy',
      ['app.orders'],
    ),
    // `ignoreTables` naming another table does not hide this one.
    report(F, from('orders', '.select()'), 'noSelectPolicy', ['public.orders'], {
      options: { ignoreTables: [{ table: 'public.scores', reason: 'Read by a function' }] },
    }),
    // `reportUnresolved` on every skip reason.
    unresolved(
      F,
      code('declare const table: string;\nexport const rows = supabase.from(table).select();'),
      'dynamic-table',
    ),
    unresolved(
      F,
      code(
        "declare const schema: string;\nexport const rows = supabase.schema(schema).from('orders').select();",
      ),
      'dynamic-schema',
    ),
    unresolved(F, code("export const query = supabase.from('orders');"), 'unknown-operation'),
    unresolved(
      F,
      code(
        "supabase.channel('c').on('postgres_changes', { event: '*', schema: 'public' }, (p) => p).subscribe((s) => s);",
      ),
      'realtime-all-tables',
    ),
    unresolved(F, DYNAMIC_EVENT, 'dynamic-event'),
    unresolved(F, UNTRACEABLE_CLIENT, 'unknown-client'),
    unresolved(F, UNKNOWN_KEY_CLIENT, 'unknown-key', undefined, { unknownKey: 'skip' }),
    unresolved(undefined, from('orders', '.select()'), 'no-project'),
    unresolved('bad-config', from('todos', '.select()'), 'engine-error'),
    unresolved(F, from('not_created', '.select()'), 'unknown-relation', 'public.not_created'),
    unresolved(F, from('todo_titles', '.select()'), 'view', 'public.todo_titles'),
    // A table whose policies a `do` block changes, with the block's location (ADR-023).
    {
      ...valid(DO_BLOCK, from('todos', '.select()'), { reportUnresolved: true }),
      errors: [
        {
          messageId: 'policiesUncertain',
          data: { table: 'public.todos', location: DO_BLOCK_AT },
        },
      ],
    },
    // The mark covers only the table the block names: `orders` is still checked.
    report(DO_BLOCK, from('orders', '.select()'), 'noSelectPolicy', ['public.orders']),
  ],
});
