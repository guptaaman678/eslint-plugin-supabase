import parser from '@typescript-eslint/parser';
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import {
  accessOf,
  bypassesRls,
  rlsReadable,
  rlsVerdict,
  rolesText,
  VIA_AUTO_RLS,
  type Access,
} from '../../src/rules/rls-readable.js';
import { ignoredNames } from '../../src/rules/realtime-table-published.js';
// The plugin entry loads the engine at top level (ADR-016).
import plugin from '../../src/index.js';
import { stats } from '../../src/stats.js';
import type { Subscription, TableCall } from '../../src/supabase/calls.js';
import { AT, fakeView, type FakeRelation } from '../harness/fake-snapshot.js';
import { schemaFixture, TS_FIXTURE_DIR } from '../harness/rule-tester.js';

const DO_AT = { file: 'supabase/migrations/0002_policies.sql', line: 4, column: 1 };
const ALL = ['select', 'insert', 'update', 'delete'];

const relations: Record<string, FakeRelation> = {
  // RLS on, no policy.
  'public.orders': { rls: true },
  // RLS off.
  'public.messages': {},
  'public.todo_titles': { kind: 'view' },
  // A select policy for PUBLIC; update and delete policies for authenticated.
  'public.todos': {
    rls: true,
    policies: [
      { command: 'select' },
      { command: 'update', roles: ['authenticated'] },
      { command: 'delete', roles: ['authenticated'] },
    ],
  },
  // ALL for anon.
  'public.scores': { rls: true, policies: [{ command: 'all', roles: ['anon'] }] },
  // Restrictive only, and `using (false)`.
  'app.scores': {
    rls: true,
    policies: [{ command: 'select', permissive: false }],
  },
  'app.audit_log': {
    rls: true,
    policies: [
      { command: 'select', using: 'false' },
      { command: 'update', using: 'false' },
    ],
  },
  // Update and delete policies, no select policy.
  'app.orders': {
    rls: true,
    policies: [{ command: 'update' }, { command: 'delete' }],
  },
  // RLS from the automatic RLS trigger, no policy.
  'public.audit_log': {
    rls: { enabled: true, forced: false, source: 'auto-rls', at: AT },
  },
  // A materialized view: RLS never applies.
  'public.score_totals': { kind: 'materialized view' },
  // Policies a `do` block changes (ADR-023): with RLS on (no known policy), and with RLS off.
  'public.messages_log': { rls: true, policiesUncertain: DO_AT },
  'app.messages': { policiesUncertain: DO_AT },
};

const view = fakeView({
  relations: {
    // Every privilege granted to PUBLIC, so only policies decide.
    ...Object.fromEntries(
      Object.entries(relations).map(([name, relation]) => [
        name,
        { ...relation, grants: { public: ALL } },
      ]),
    ),
    // Policies for everything; update and delete not granted, select only on some columns
    // (ADR-025 item 2).
    'app.todos': {
      rls: true,
      columnGrants: { anon: ['select'], authenticated: ['select'] },
      policies: [{ command: 'all' }],
    },
    // A select policy for anon only, and the select privilege for authenticated only.
    'app.scores_by_role': {
      rls: true,
      grants: { authenticated: ['select'] },
      policies: [{ command: 'select', roles: ['anon'] }],
    },
    // RLS on, no policy, no privilege.
    'app.orders_revoked': { rls: true },
  },
});

const table = (name: string, schema = 'public') => ({ schema, name });
const DEFAULT = ['anon', 'authenticated'] as const;
const NONE: ReadonlySet<string> = new Set();
const READ: Access = { kind: 'read', privileges: ['select'] };
const SUBSCRIPTION: Access = { kind: 'subscription' };
const write = (kind: 'update' | 'delete', filtered: boolean, returning = false): Access => ({
  kind,
  filtered,
  privileges: filtered || returning ? [kind, 'select'] : [kind],
});
const OK = { kind: 'ok' };
const report = (messageId: string, autoRls = false) => ({ kind: 'report', messageId, autoRls });

describe('rlsVerdict', () => {
  it('passes tables without RLS, and a materialized view', () => {
    expect(rlsVerdict(view, table('messages'), DEFAULT, READ, NONE)).toEqual(OK);
    expect(rlsVerdict(view, table('messages'), DEFAULT, write('update', true), NONE)).toEqual(OK);
    expect(rlsVerdict(view, table('score_totals'), DEFAULT, READ, NONE)).toEqual(OK);
  });

  it('skips views and relations the migrations never create', () => {
    expect(rlsVerdict(view, table('todo_titles'), DEFAULT, READ, NONE)).toEqual({
      kind: 'skip',
      reason: 'view',
    });
    expect(rlsVerdict(view, table('not_created'), DEFAULT, READ, NONE)).toEqual({
      kind: 'skip',
      reason: 'unknown-relation',
    });
  });

  it('skips a table with RLS on whose policies a do block changes, with its location', () => {
    const skip = { kind: 'skip', reason: 'policy-uncertain', at: DO_AT };
    expect(rlsVerdict(view, table('messages_log'), DEFAULT, READ, NONE)).toEqual(skip);
    expect(rlsVerdict(view, table('messages_log'), DEFAULT, SUBSCRIPTION, NONE)).toEqual(skip);
    expect(rlsVerdict(view, table('messages_log'), DEFAULT, write('delete', true), NONE)).toEqual(
      skip,
    );
    // RLS off decides first, and `ignoreTables` still wins.
    expect(rlsVerdict(view, table('messages', 'app'), DEFAULT, READ, NONE)).toEqual(OK);
    expect(
      rlsVerdict(view, table('messages_log'), DEFAULT, READ, new Set(['public.messages_log'])),
    ).toEqual(OK);
  });

  it('reports a read or subscription with no select policy', () => {
    expect(rlsVerdict(view, table('orders'), DEFAULT, READ, NONE)).toEqual(
      report('noSelectPolicy'),
    );
    expect(rlsVerdict(view, table('orders'), DEFAULT, SUBSCRIPTION, NONE)).toEqual(
      report('subscriptionNoEvents'),
    );
  });

  it('counts a PUBLIC policy and an ALL policy, and one role of the set is enough', () => {
    expect(rlsVerdict(view, table('todos'), ['anon'], READ, NONE)).toEqual(OK);
    expect(rlsVerdict(view, table('todos'), ['anon'], SUBSCRIPTION, NONE)).toEqual(OK);
    expect(rlsVerdict(view, table('scores'), DEFAULT, READ, NONE)).toEqual(OK);
    expect(rlsVerdict(view, table('scores'), DEFAULT, SUBSCRIPTION, NONE)).toEqual(OK);
    expect(rlsVerdict(view, table('scores'), DEFAULT, write('delete', true), NONE)).toEqual(OK);
    // The ALL policy is for anon only.
    expect(rlsVerdict(view, table('scores'), ['authenticated'], READ, NONE)).toEqual(
      report('noSelectPolicy'),
    );
  });

  it('does not count restrictive policies or `using (false)`', () => {
    expect(rlsVerdict(view, table('scores', 'app'), DEFAULT, READ, NONE)).toEqual(
      report('noSelectPolicy'),
    );
    expect(rlsVerdict(view, table('audit_log', 'app'), DEFAULT, READ, NONE)).toEqual(
      report('noSelectPolicy'),
    );
    expect(
      rlsVerdict(view, table('audit_log', 'app'), DEFAULT, write('update', false), NONE),
    ).toEqual(report('updatesNoRows'));
  });

  it('needs the write policy and, for a filtered write, a select policy', () => {
    // Both policies.
    expect(rlsVerdict(view, table('todos'), DEFAULT, write('update', true), NONE)).toEqual(OK);
    expect(rlsVerdict(view, table('todos'), DEFAULT, write('delete', true), NONE)).toEqual(OK);
    // The select policy is PUBLIC, the write policies are authenticated's.
    expect(rlsVerdict(view, table('todos'), ['anon'], write('update', true), NONE)).toEqual(
      report('updatesNoRows'),
    );
    // A write policy without a select policy: only an unfiltered write passes.
    expect(rlsVerdict(view, table('orders', 'app'), DEFAULT, write('update', true), NONE)).toEqual(
      report('updatesNoRows'),
    );
    expect(rlsVerdict(view, table('orders', 'app'), DEFAULT, write('delete', true), NONE)).toEqual(
      report('deletesNoRows'),
    );
    expect(rlsVerdict(view, table('orders', 'app'), DEFAULT, write('update', false), NONE)).toEqual(
      OK,
    );
    expect(rlsVerdict(view, table('orders', 'app'), DEFAULT, write('delete', false), NONE)).toEqual(
      OK,
    );
    // No write policy at all.
    expect(rlsVerdict(view, table('orders'), DEFAULT, write('delete', false), NONE)).toEqual(
      report('deletesNoRows'),
    );
  });

  it('marks RLS from the automatic RLS trigger (ADR-010)', () => {
    expect(rlsVerdict(view, table('audit_log'), DEFAULT, READ, NONE)).toEqual(
      report('noSelectPolicy', true),
    );
  });

  it('considers only the roles that hold the privileges a read or write needs (ADR-025)', () => {
    // No role holds update or delete: the call fails with 42501, table-granted reports it.
    expect(rlsVerdict(view, table('todos', 'app'), DEFAULT, write('update', false), NONE)).toEqual(
      OK,
    );
    expect(rlsVerdict(view, table('todos', 'app'), DEFAULT, write('delete', true), NONE)).toEqual(
      OK,
    );
    expect(rlsVerdict(view, table('orders_revoked', 'app'), DEFAULT, READ, NONE)).toEqual(OK);
    // A column grant is enough, and the policy decides.
    expect(rlsVerdict(view, table('todos', 'app'), DEFAULT, READ, NONE)).toEqual(OK);
    // anon has the policy but not the privilege; authenticated the privilege but no policy.
    expect(rlsVerdict(view, table('scores_by_role', 'app'), DEFAULT, READ, NONE)).toEqual(
      report('noSelectPolicy'),
    );
    expect(rlsVerdict(view, table('scores_by_role', 'app'), ['anon'], READ, NONE)).toEqual(OK);
    // Subscriptions are unchanged (ADR-025 item 2).
    expect(rlsVerdict(view, table('orders_revoked', 'app'), DEFAULT, SUBSCRIPTION, NONE)).toEqual(
      report('subscriptionNoEvents'),
    );
    expect(rlsVerdict(view, table('scores_by_role', 'app'), DEFAULT, SUBSCRIPTION, NONE)).toEqual(
      OK,
    );
  });

  it('passes ignored tables before anything else', () => {
    const ignored = ignoredNames([
      { table: 'orders', reason: 'r' },
      { table: 'app.orders', reason: 'r' },
      { table: 'not_created', reason: 'r' },
    ]);
    expect(rlsVerdict(view, table('orders'), DEFAULT, READ, ignored)).toEqual(OK);
    expect(
      rlsVerdict(view, table('orders', 'app'), DEFAULT, write('update', true), ignored),
    ).toEqual(OK);
    expect(rlsVerdict(view, table('not_created'), DEFAULT, READ, ignored)).toEqual(OK);
    expect(rlsVerdict(view, table('scores', 'app'), DEFAULT, READ, ignored)).toEqual(
      report('noSelectPolicy'),
    );
  });
});

const tableCall = (fields: Partial<TableCall>): TableCall =>
  ({ kind: 'table', filtered: false, returning: false, ...fields }) as TableCall;
const subscription = (events: readonly string[] | undefined): Subscription =>
  ({ kind: 'realtime', events }) as Subscription;

describe('accessOf', () => {
  it('reads selects, and updates and deletes with their filter', () => {
    expect(accessOf(tableCall({ operation: 'select' }))).toEqual(READ);
    expect(accessOf(tableCall({ operation: 'update', filtered: true }))).toEqual(
      write('update', true),
    );
    expect(accessOf(tableCall({ operation: 'delete', returning: true }))).toEqual(
      write('delete', false, true),
    );
    expect(accessOf(tableCall({ operation: 'update' }))).toEqual(write('update', false));
  });

  it('does not check inserts and upserts (ADR-007 item 1)', () => {
    expect(accessOf(tableCall({ operation: 'insert', returning: true }))).toBeUndefined();
    expect(accessOf(tableCall({ operation: 'upsert' }))).toBeUndefined();
  });

  it('checks subscriptions that can receive insert or update events', () => {
    expect(accessOf(subscription(['*']))).toEqual(SUBSCRIPTION);
    expect(accessOf(subscription(['INSERT']))).toEqual(SUBSCRIPTION);
    expect(accessOf(subscription(['DELETE', 'UPDATE']))).toEqual(SUBSCRIPTION);
    expect(accessOf(subscription(['DELETE']))).toBeUndefined();
    expect(accessOf(subscription(undefined))).toBe('dynamic-event');
  });
});

describe('roles', () => {
  it('lets the service role bypass RLS', () => {
    expect(bypassesRls(['service_role'])).toBe(true);
    expect(bypassesRls(['anon', 'service_role'])).toBe(true);
    expect(bypassesRls(DEFAULT)).toBe(false);
  });

  it('names the role set', () => {
    expect(rolesText(DEFAULT)).toBe('anon or authenticated');
    expect(rolesText(['authenticated'])).toBe('authenticated');
  });
});

const fill = (template: string, via = '') =>
  template
    .replaceAll('{{table}}', 'public.orders')
    .replaceAll('{{roles}}', 'anon or authenticated')
    .replaceAll('{{via}}', via);

describe('messages (§6.6)', () => {
  const messages = rlsReadable.meta.messages;

  it('formats noSelectPolicy, updatesNoRows and subscriptionNoEvents as the spec words them', () => {
    expect(fill(messages.noSelectPolicy)).toBe(
      '`public.orders` has row level security on and no select policy for anon or authenticated in your migrations, so this read returns no rows and no error. Add a select policy, or read it through a function or a server-side client.',
    );
    expect(fill(messages.updatesNoRows)).toBe(
      '`public.orders` has row level security on and no update policy (or no select policy, which updates need to find rows) for anon or authenticated in your migrations, so this update changes no rows and returns no error. Add an update policy and a select policy, or run it through a function or a server-side client.',
    );
    expect(fill(messages.subscriptionNoEvents)).toBe(
      '`public.orders` has row level security on and no select policy for anon or authenticated in your migrations, so this subscription receives no insert or update events, and delete events arrive with only the primary key. Add a select policy.',
    );
  });

  it('words deletes like updates', () => {
    expect(fill(messages.deletesNoRows)).toBe(
      '`public.orders` has row level security on and no delete policy (or no select policy, which deletes need to find rows) for anon or authenticated in your migrations, so this delete removes no rows and returns no error. Add a delete policy and a select policy, or run it through a function or a server-side client.',
    );
  });

  it('says when RLS is on via the ensure_rls trigger (ADR-010 item 5)', () => {
    expect(fill(messages.noSelectPolicy, VIA_AUTO_RLS)).toContain(
      '`public.orders` has row level security on (RLS is on via the `ensure_rls` trigger) and no select policy',
    );
  });
});

function lint(code: string, settings: Record<string, unknown>, options?: object) {
  return new Linter({ configType: 'flat' }).verify(
    code,
    [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser,
          parserOptions: { projectService: true, tsconfigRootDir: TS_FIXTURE_DIR },
        },
        plugins: { supabase: plugin },
        rules: {
          'supabase/rls-readable': options === undefined ? 'error' : ['error', options],
        },
        settings,
      },
    ],
    `${TS_FIXTURE_DIR}/file.ts`,
  );
}

const SELECT = (name: string, key = 'sb_publishable_test') =>
  [
    "import { createClient } from '@supabase/supabase-js';",
    `const supabase = createClient('http://localhost:54321', '${key}');`,
    `export const rows = supabase.from('${name}').select();`,
  ].join('\n');

describe('rls-readable in ESLint', () => {
  const project = { supabase: { projectDir: schemaFixture('rls-readable') } };

  it('counts skips per reason, and checked calls without a reason', () => {
    const before = stats.snapshot();
    const count = (reason: 'view' | 'unknown-relation') =>
      (stats.snapshot().skips[reason] ?? 0) - (before.skips[reason] ?? 0);
    expect(lint(SELECT('todo_titles'), project)).toEqual([]);
    expect(count('view')).toBe(1);
    expect(lint(SELECT('not_created'), project)).toEqual([]);
    expect(count('unknown-relation')).toBe(1);
    expect(lint(SELECT('orders'), project).map((m) => m.messageId)).toEqual(['noSelectPolicy']);
    // A service role call is looked at, not skipped, and passes.
    expect(lint(SELECT('orders', 'sb_secret_test'), project)).toEqual([]);
    expect(stats.snapshot().calls - before.calls).toBe(4);
    // An insert is looked at and needs no policy check here.
    expect(lint(SELECT('orders').replace('.select()', '.insert({})'), project)).toEqual([]);
    expect(stats.snapshot().calls - before.calls).toBe(5);
    // An rpc is not a table call: this rule does not look at it.
    expect(lint(SELECT('orders').replace("from('orders').select()", "rpc('f')"), project)).toEqual(
      [],
    );
    expect(stats.snapshot().calls - before.calls).toBe(5);
    expect(stats.snapshot().skips).toEqual({
      ...before.skips,
      view: (before.skips.view ?? 0) + 1,
      'unknown-relation': (before.skips['unknown-relation'] ?? 0) + 1,
    });
  });

  it('counts a table whose policies a do block changes, and names the block when asked', () => {
    const doBlock = { supabase: { projectDir: schemaFixture('rls-policy-do-block') } };
    const before = stats.snapshot().skips['policy-uncertain'] ?? 0;
    expect(lint(SELECT('todos'), doBlock)).toEqual([]);
    expect((stats.snapshot().skips['policy-uncertain'] ?? 0) - before).toBe(1);
    const [message] = lint(SELECT('todos'), doBlock, { reportUnresolved: true });
    expect(message?.messageId).toBe('policiesUncertain');
    expect(message?.message).toContain(
      'policies of `public.todos` at supabase/migrations/20260101000000_tables.sql:13 ',
    );
  });

  it('skips a file outside any project before mapping clients by module', () => {
    const settings = { supabase: { clients: [{ module: '**', role: 'anon' }] } };
    expect(
      lint(SELECT('orders'), settings, { reportUnresolved: true }).map((m) => m.messageId),
    ).toEqual(['unresolved']);
  });

  it('fails on a settings error even in a file without a Supabase call', () => {
    expect(() => lint('export const x = 1;', { supabase: { projectdir: '.' } })).toThrow(
      /projectdir.*Did you mean "projectDir"/s,
    );
  });

  it('rejects an ignoreTables entry without a reason', () => {
    expect(() => lint(SELECT('orders'), project, { ignoreTables: [{ table: 'orders' }] })).toThrow(
      /reason/,
    );
  });
});
