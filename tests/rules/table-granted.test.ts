import type { InvalidTestCase, ValidTestCase } from '@typescript-eslint/rule-tester';
import { tableGranted, type MessageId, type Options } from '../../src/rules/table-granted.js';
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

interface Missing {
  readonly table: string;
  /** The role the message names. */
  readonly role?: string;
  /** The privileges it misses, in message order. */
  readonly privileges: readonly string[];
}

function report(
  fixture: string,
  source: string,
  missing: readonly Missing[],
  more: { readonly options?: Partial<Options>; readonly extra?: CaseSettings } = {},
): Invalid {
  return {
    ...valid(fixture, source, more.options, more.extra),
    errors: missing.map(({ table, role = 'authenticated', privileges }) => ({
      messageId: 'noPrivilege',
      data: {
        role,
        table,
        privileges:
          privileges.length < 2
            ? privileges.join('')
            : `${privileges.slice(0, -1).join(', ')} or ${privileges.at(-1)}`,
        grants: privileges.join(', '),
      },
    })),
  };
}

function subscriptionReport(
  fixture: string,
  source: string,
  table: string,
  role = 'authenticated',
  extra?: CaseSettings,
): Invalid {
  return {
    ...valid(fixture, source, undefined, extra),
    errors: [{ messageId: 'subscriptionNoPrivilege', data: { role, table } }],
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

const F = 'table-granted';
const serviceRole = (body: string): string =>
  [
    "import { createClient } from '@supabase/supabase-js';",
    "const admin = createClient('http://localhost:54321', process.env.SUPABASE_SERVICE_ROLE_KEY!);",
    body,
  ].join('\n');
const AS_AUTHENTICATED: CaseSettings = {
  clients: [{ callee: 'createClient', role: 'authenticated' }],
};
const AS_ANON: CaseSettings = { clients: [{ callee: 'createClient', role: 'anon' }] };
const UNTRACEABLE_CLIENT = [
  "import type { SupabaseClient } from '@supabase/supabase-js';",
  'export async function list(client: SupabaseClient) {',
  "  return client.from('orders').select();",
  '}',
].join('\n');
// A factory with a test seam: its client is untraceable, but a `clients` entry can map it.
const UNTRACEABLE_FACTORY = [
  "import { createClient, type SupabaseClient } from '@supabase/supabase-js';",
  'let testClient: SupabaseClient | undefined;',
  'export function setTestClient(client: SupabaseClient) {',
  '  testClient = client;',
  '}',
  'function db() {',
  "  return (testClient ??= createClient('http://localhost:54321', 'sb_publishable_x'));",
  '}',
  "export const rows = db().from('orders').select();",
].join('\n');
const FACTORY_UNRESOLVED = unresolvedReason('unknown-client', undefined, true);
const UNKNOWN_KEY_CLIENT = [
  "import { createClient } from '@supabase/supabase-js';",
  'declare const key: string;',
  "const client = createClient('http://localhost:54321', key);",
  "export const rows = client.from('orders').select();",
].join('\n');

createRuleTester().run('table-granted', tableGranted, {
  valid: [
    // Created before the opt-in: the replayed default privileges grant everything.
    valid(F, from('todos', '.select()')),
    valid(F, from('todos', '.insert({ title: "x" }).select()')),
    valid(F, from('todos', '.upsert({ id: 1, title: "x" })')),
    valid(F, from('todos', ".update({ title: 'x' }).eq('id', 1)")),
    valid(F, from('todos', ".delete().eq('id', 1)")),
    valid(F, from('todo_titles', '.select()')),
    valid(F, subscribe('todos')),
    valid('basic', from('todos', '.insert({ title: "x" })')),
    // Insert, insert with `.select()`, and both upsert forms that need no update.
    valid(F, from('scores', '.insert({ points: 1 })')),
    valid(F, from('scores', '.insert({ points: 1 }).select()')),
    valid(F, from('scores', '.upsert({ id: 1, points: 1 }, { ignoreDuplicates: true })')),
    valid(F, from('scores', '.upsert({ id: 1, points: 1 }, { ignoreDuplicates: true }).select()')),
    // `ignoreDuplicates` not a literal: only what both forms need (insert and select).
    valid(
      F,
      code(
        "declare const skip: boolean;\nexport const run = () => supabase.from('scores').upsert({ id: 1, points: 1 }, { ignoreDuplicates: skip });",
      ),
    ),
    // Writes without select: an unfiltered update or delete, and an insert, need none.
    valid(F, from('messages', '.insert({ body: "x" })')),
    valid(F, from('messages', ".update({ body: 'x' })")),
    valid(F, from('messages', '.delete()')),
    // Privileges through PUBLIC.
    valid(F, from('audit_log', '.select()')),
    valid(F, from('audit_log', '.upsert({ id: 1, entry: "x" })')),
    valid(F, from('audit_log', ".delete().eq('id', 1).select()")),
    // Column grants count as held.
    valid(F, from('notes', '.select()')),
    valid(F, from('notes', ".update({ body: 'x' }).eq('id', 1)")),
    // A role set where one role passes: anon may select from feeds, authenticated may not.
    valid(F, from('feeds', '.select()')),
    valid(F, subscribe('feeds')),
    // A subscription with a select grant, for any event.
    valid(F, subscribe('scores', 'DELETE')),
    // A service role client, with the grants it needs.
    valid(
      F,
      serviceRole("export const run = () => admin.from('scores').upsert({ id: 1, points: 1 });"),
    ),
    // Another schema, through `.schema()`.
    valid(F, from('orders', '.select()', 'app')),
    // `ignoreTables`, qualified or a bare name in `public`.
    valid(F, from('orders', '.insert({ total: 1 })'), {
      ignoreTables: [{ table: 'public.orders', reason: 'Granted outside the migrations' }],
    }),
    valid(F, from('orders', '.select()'), {
      ignoreTables: [{ table: 'orders', reason: 'Granted outside the migrations' }],
    }),
    valid(F, from('orders', '.insert({ total: 1 })', 'app'), {
      ignoreTables: [{ table: 'app.orders', reason: 'Written by a function' }],
    }),
    // Real migrations: a migration opt-in with a column grant, a config `since` opt-in.
    valid('opt-in', from('scores', ".update({ points: 1 }).eq('id', 1)")),
    valid('opt-in', from('audit_log', '.insert({ entry: "x" })')),
    valid('opt-in-dashboard', from('scores', '.select()')),
    valid('opt-in-dashboard', subscribe('scores')),
    // Not resolvable: skipped and counted, never guessed.
    valid(
      F,
      code('declare const table: string;\nexport const rows = supabase.from(table).select();'),
    ),
    valid(F, code("export const query = supabase.from('orders');")),
    valid(F, UNTRACEABLE_CLIENT),
    valid(F, UNKNOWN_KEY_CLIENT, undefined, { unknownKey: 'skip' }),
    valid(F, from('not_created', '.select()')),
    from('orders', '.select()'),
    valid('bad-config', from('todos', '.select()')),
    // Not a table call: RPC (not checked in v0.1), broadcast, a local class.
    valid(F, code("export const done = supabase.rpc('archive_orders');")),
    valid(
      F,
      code(
        "supabase.channel('room').on('broadcast', { event: 'orders' }, (p) => p).subscribe((s) => s);",
      ),
    ),
    valid(
      F,
      "class Store {\n  from(_table: string) {\n    return { insert: () => [] };\n  }\n}\nexport const rows = new Store().from('orders').insert();",
    ),
  ],
  invalid: [
    // No grant at all: each operation names what it needs.
    report(F, from('orders', '.select()'), [{ table: 'public.orders', privileges: ['select'] }]),
    report(F, from('orders', ".select('*', { count: 'exact', head: true })"), [
      { table: 'public.orders', privileges: ['select'] },
    ]),
    report(F, from('orders', '.insert({ total: 1 })'), [
      { table: 'public.orders', privileges: ['insert'] },
    ]),
    report(F, from('orders', '.upsert({ id: 1, total: 1 })'), [
      { table: 'public.orders', privileges: ['insert', 'update', 'select'] },
    ]),
    report(F, from('orders', ".delete().eq('id', 1)"), [
      { table: 'public.orders', privileges: ['delete', 'select'] },
    ]),
    // A write that returns rows, or whose filter reads rows, needs select too.
    report(F, from('messages', '.insert({ body: "x" }).select()'), [
      { table: 'public.messages', privileges: ['select'] },
    ]),
    report(F, from('messages', ".update({ body: 'x' }).eq('id', 1)"), [
      { table: 'public.messages', privileges: ['select'] },
    ]),
    report(F, from('messages', ".delete().in('id', [1, 2])"), [
      { table: 'public.messages', privileges: ['select'] },
    ]),
    report(F, from('messages', ".update({ body: 'x' }).select()"), [
      { table: 'public.messages', privileges: ['select'] },
    ]),
    // Upsert: merge needs update; ignoreDuplicates needs select.
    report(F, from('scores', '.upsert({ id: 1, points: 1 })'), [
      { table: 'public.scores', privileges: ['update'] },
    ]),
    report(F, from('scores', '.upsert({ id: 1, points: 1 }, { ignoreDuplicates: false })'), [
      { table: 'public.scores', privileges: ['update'] },
    ]),
    report(F, from('messages', '.upsert({ id: 1, body: "x" }, { ignoreDuplicates: true })'), [
      { table: 'public.messages', privileges: ['select'] },
    ]),
    // A filtered update with a column grant for update but none for select.
    report(F, from('scores', ".update({ points: 1 }).eq('id', 1)"), [
      { table: 'public.scores', privileges: ['update'] },
    ]),
    // Granted, then revoked.
    report(F, from('drafts', '.insert({ body: "x" })'), [
      { table: 'public.drafts', privileges: ['insert'] },
    ]),
    // A view checks its own grants.
    report(F, from('order_totals', '.select()'), [
      { table: 'public.order_totals', privileges: ['select'] },
    ]),
    // The closest role is named: anon misses insert only, authenticated insert and select.
    report(F, from('feeds', '.insert({ title: "x" }).select()'), [
      { table: 'public.feeds', role: 'anon', privileges: ['insert'] },
    ]),
    // A one-role set from settings: the role that would pass for the default set is not in it.
    report(F, from('feeds', '.select()'), [{ table: 'public.feeds', privileges: ['select'] }], {
      extra: AS_AUTHENTICATED,
    }),
    report(
      F,
      from('scores', '.select()'),
      [{ table: 'public.scores', role: 'anon', privileges: ['select'] }],
      { extra: AS_ANON },
    ),
    // A service role client still needs grants.
    report(F, serviceRole("export const run = () => admin.from('orders').insert({ total: 1 });"), [
      { table: 'public.orders', role: 'service_role', privileges: ['insert'] },
    ]),
    report(
      F,
      from('orders', '.insert({ total: 1 })'),
      [{ table: 'public.orders', role: 'service_role', privileges: ['insert'] }],
      { extra: { clients: [{ callee: 'createClient', role: 'service_role' }] } },
    ),
    // Another schema, through `.schema()` and through `db.schema`.
    report(F, from('orders', '.insert({ total: 1 })', 'app'), [
      { table: 'app.orders', privileges: ['insert'] },
    ]),
    report(
      F,
      "import { createClient } from '@supabase/supabase-js';\nconst app = createClient('http://localhost:54321', 'sb_publishable_test', { db: { schema: 'app' } });\nexport const run = () => app.from('orders').delete().eq('id', 1);",
      [{ table: 'app.orders', privileges: ['delete'] }],
    ),
    // Subscriptions need select.
    subscriptionReport(F, subscribe('orders'), 'public.orders'),
    subscriptionReport(F, subscribe('messages', 'INSERT'), 'public.messages'),
    subscriptionReport(
      F,
      subscribe('feeds', 'UPDATE'),
      'public.feeds',
      'authenticated',
      AS_AUTHENTICATED,
    ),
    subscriptionReport(
      F,
      code(
        "supabase\n  .channel('changes')\n  .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'orders', filter: 'id=eq.1' }, (p) => p)\n  .subscribe((s) => s);",
      ),
      'public.orders',
    ),
    // Real migrations: a migration opt-in and a config `since` opt-in.
    report('opt-in', from('scores', '.insert({ points: 1 })'), [
      { table: 'public.scores', privileges: ['insert'] },
    ]),
    report('opt-in', from('scores', ".delete().eq('id', 1)"), [
      { table: 'public.scores', privileges: ['delete'] },
    ]),
    report('opt-in-dashboard', from('scores', '.insert({ points: 1 })'), [
      { table: 'public.scores', privileges: ['insert'] },
    ]),
    subscriptionReport('opt-in-dashboard', subscribe('scores'), 'public.scores', 'anon', AS_ANON),
    // A union names each member that fails.
    report(
      F,
      code(
        "declare const table: 'orders' | 'audit_log' | 'drafts';\nexport const run = () => supabase.from(table).insert({});",
      ),
      [
        { table: 'public.orders', privileges: ['insert'] },
        { table: 'public.drafts', privileges: ['insert'] },
      ],
    ),
    // A query held in a variable, inside a `forEach` body.
    report(
      F,
      code(
        "const query = supabase.from('orders').select('id');\nexport const run = async () => await query;",
      ),
      [{ table: 'public.orders', privileges: ['select'] }],
    ),
    report(
      F,
      code(
        "[1, 2].forEach((id) => {\n  void supabase.from('orders').delete().eq('id', id).then();\n});",
      ),
      [{ table: 'public.orders', privileges: ['delete', 'select'] }],
    ),
    // `ignoreTables` naming another table does not hide this one.
    report(F, from('orders', '.select()'), [{ table: 'public.orders', privileges: ['select'] }], {
      options: { ignoreTables: [{ table: 'public.scores', reason: 'Granted by hand' }] },
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
    unresolved(F, UNTRACEABLE_CLIENT, 'unknown-client'),
    {
      ...unresolved(F, UNTRACEABLE_FACTORY, 'unknown-client'),
      errors: [{ messageId: 'unresolved', data: { reason: FACTORY_UNRESOLVED } }],
    },
    unresolved(F, UNKNOWN_KEY_CLIENT, 'unknown-key', undefined, { unknownKey: 'skip' }),
    unresolved(undefined, from('orders', '.select()'), 'no-project'),
    unresolved('bad-config', from('todos', '.select()'), 'engine-error'),
    unresolved(F, from('not_created', '.select()'), 'unknown-relation', 'public.not_created'),
    unresolved(F, subscribe('not_created'), 'unknown-relation', 'public.not_created'),
  ],
});
