import parser from '@typescript-eslint/parser';
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { ignoredNames } from '../../src/rules/realtime-table-published.js';
import {
  grantVerdict,
  privilegesOf,
  privilegesText,
  tableGranted,
} from '../../src/rules/table-granted.js';
// The plugin entry loads the engine at top level (ADR-016).
import plugin from '../../src/index.js';
import type { Privilege } from '../../src/schema/view.js';
import { stats } from '../../src/stats.js';
import type { Subscription, TableCall, TableOperation } from '../../src/supabase/calls.js';
import { fakeView } from '../harness/fake-snapshot.js';
import { schemaFixture, TS_FIXTURE_DIR } from '../harness/rule-tester.js';

const view = fakeView({
  relations: {
    // No grant at all.
    'public.orders': {},
    // Everything through PUBLIC.
    'public.audit_log': { grants: { public: ['select', 'insert', 'update', 'delete'] } },
    // Select for anon; select and insert for authenticated; update on some columns.
    'public.scores': {
      grants: { anon: ['select'], authenticated: ['select', 'insert'] },
      columnGrants: { authenticated: ['update'] },
    },
    // Writes without select for authenticated.
    'public.messages': { grants: { authenticated: ['insert', 'update', 'delete'] } },
    // A view with a grant of its own.
    'public.todo_titles': { kind: 'view', grants: { anon: ['select'] } },
    'app.orders': { grants: { service_role: ['select', 'insert', 'update', 'delete'] } },
  },
});

const table = (name: string, schema = 'public') => ({ schema, name });
const DEFAULT = ['anon', 'authenticated'] as const;
const NONE: ReadonlySet<string> = new Set();
const OK = { kind: 'ok' };
const report = (role: string, missing: Privilege[]) => ({ kind: 'report', role, missing });

const call = (
  operation: TableOperation | undefined,
  shape: { filtered?: boolean; returning?: boolean; ignoreDuplicates?: boolean | undefined } = {},
): TableCall =>
  ({
    kind: 'table',
    operation,
    filtered: shape.filtered ?? false,
    returning: shape.returning ?? false,
    ignoreDuplicates: 'ignoreDuplicates' in shape ? shape.ignoreDuplicates : false,
  }) as TableCall;

describe('privilegesOf (postgrest-privileges.md §10.1, ADR-008)', () => {
  it('needs select for a read and for a subscription', () => {
    expect(privilegesOf(call('select'))).toEqual(['select']);
    expect(privilegesOf({ kind: 'realtime' } as Subscription)).toEqual(['select']);
  });

  it('needs insert, plus select when the insert returns rows', () => {
    expect(privilegesOf(call('insert'))).toEqual(['insert']);
    expect(privilegesOf(call('insert', { returning: true }))).toEqual(['insert', 'select']);
  });

  it('needs select for a filtered or returning update or delete only', () => {
    expect(privilegesOf(call('update'))).toEqual(['update']);
    expect(privilegesOf(call('delete'))).toEqual(['delete']);
    expect(privilegesOf(call('update', { filtered: true }))).toEqual(['update', 'select']);
    expect(privilegesOf(call('delete', { filtered: true }))).toEqual(['delete', 'select']);
    expect(privilegesOf(call('update', { returning: true }))).toEqual(['update', 'select']);
    expect(privilegesOf(call('delete', { filtered: true, returning: true }))).toEqual([
      'delete',
      'select',
    ]);
  });

  it('needs insert, update and select for a merge upsert, no update with ignoreDuplicates', () => {
    expect(privilegesOf(call('upsert'))).toEqual(['insert', 'update', 'select']);
    expect(privilegesOf(call('upsert', { ignoreDuplicates: true }))).toEqual(['insert', 'select']);
    expect(privilegesOf(call('upsert', { returning: true }))).toEqual([
      'insert',
      'update',
      'select',
    ]);
  });

  it('needs only what both upsert forms need when ignoreDuplicates is not a literal', () => {
    expect(privilegesOf(call('upsert', { ignoreDuplicates: undefined }))).toEqual([
      'insert',
      'select',
    ]);
  });

  it('needs nothing for a call without an operation', () => {
    expect(privilegesOf(call(undefined))).toEqual([]);
  });
});

describe('grantVerdict', () => {
  it('passes when one role of the set holds every privilege', () => {
    expect(grantVerdict(view, table('scores'), DEFAULT, ['select'], NONE)).toEqual(OK);
    expect(grantVerdict(view, table('scores'), DEFAULT, ['insert', 'select'], NONE)).toEqual(OK);
    expect(grantVerdict(view, table('scores'), ['anon'], ['select'], NONE)).toEqual(OK);
  });

  it('counts PUBLIC grants and column grants as held', () => {
    expect(
      grantVerdict(view, table('audit_log'), DEFAULT, ['insert', 'update', 'select'], NONE),
    ).toEqual(OK);
    expect(grantVerdict(view, table('scores'), DEFAULT, ['update', 'select'], NONE)).toEqual(OK);
  });

  it('reports when no role holds every privilege, even if each is held by some role', () => {
    expect(grantVerdict(view, table('orders'), DEFAULT, ['select'], NONE)).toEqual(
      report('authenticated', ['select']),
    );
    // authenticated holds insert, anon select; neither holds both plus update.
    expect(
      grantVerdict(view, table('messages'), DEFAULT, ['insert', 'update', 'select'], NONE),
    ).toEqual(report('authenticated', ['select']));
    expect(grantVerdict(view, table('scores'), ['anon'], ['insert', 'select'], NONE)).toEqual(
      report('anon', ['insert']),
    );
  });

  it('names the role that misses the fewest privileges, the last one on a tie', () => {
    // anon misses insert; authenticated misses insert and select.
    expect(grantVerdict(view, table('todo_titles'), DEFAULT, ['insert', 'select'], NONE)).toEqual(
      report('anon', ['insert']),
    );
    expect(
      grantVerdict(
        view,
        table('todo_titles'),
        ['authenticated', 'anon'],
        ['insert', 'select'],
        NONE,
      ),
    ).toEqual(report('anon', ['insert']));
    // Both miss the same: the last role of the set.
    expect(grantVerdict(view, table('orders'), DEFAULT, ['insert'], NONE)).toEqual(
      report('authenticated', ['insert']),
    );
    expect(
      grantVerdict(view, table('orders'), ['authenticated', 'anon'], ['insert'], NONE),
    ).toEqual(report('anon', ['insert']));
  });

  it('checks the service role like any other role', () => {
    expect(grantVerdict(view, table('orders'), ['service_role'], ['insert'], NONE)).toEqual(
      report('service_role', ['insert']),
    );
    expect(grantVerdict(view, table('orders', 'app'), ['service_role'], ['insert'], NONE)).toEqual(
      OK,
    );
  });

  it('checks views by their own grants', () => {
    expect(grantVerdict(view, table('todo_titles'), DEFAULT, ['select'], NONE)).toEqual(OK);
  });

  it('skips relations the migrations never create', () => {
    expect(grantVerdict(view, table('not_created'), DEFAULT, ['select'], NONE)).toEqual({
      kind: 'skip',
      reason: 'unknown-relation',
    });
  });

  it('passes ignored tables, and calls that need nothing or have no role', () => {
    const ignored = ignoredNames([{ table: 'orders', reason: 'Granted by hand' }]);
    expect(grantVerdict(view, table('orders'), DEFAULT, ['select'], ignored)).toEqual(OK);
    expect(grantVerdict(view, table('not_created'), DEFAULT, ['select'], ignored)).toEqual({
      kind: 'skip',
      reason: 'unknown-relation',
    });
    expect(grantVerdict(view, table('orders'), DEFAULT, [], NONE)).toEqual(OK);
    expect(grantVerdict(view, table('orders'), [], ['select'], NONE)).toEqual(OK);
  });
});

describe('privilegesText', () => {
  it('lists the privileges with "or"', () => {
    expect(privilegesText([])).toBe('');
    expect(privilegesText(['insert'])).toBe('insert');
    expect(privilegesText(['insert', 'select'])).toBe('insert or select');
    expect(privilegesText(['insert', 'update', 'select'])).toBe('insert, update or select');
  });
});

const fill = (template: string, role: string, table: string, privileges: Privilege[]) =>
  template
    .replaceAll('{{role}}', role)
    .replaceAll('{{table}}', table)
    .replaceAll('{{privileges}}', privilegesText(privileges))
    .replaceAll('{{grants}}', privileges.join(', '));

describe('messages (§6.6)', () => {
  const messages = tableGranted.meta.messages;

  it('formats noPrivilege and subscriptionNoPrivilege as the spec words them', () => {
    expect(fill(messages.noPrivilege, 'authenticated', 'public.orders', ['insert'])).toBe(
      'authenticated has no insert privilege on `public.orders` in your migrations, so this call fails with 42501 (permission denied). Fix in a migration: `grant insert on public.orders to authenticated;`',
    );
    expect(fill(messages.subscriptionNoPrivilege, 'anon', 'public.todos', ['select'])).toBe(
      'anon has no select privilege on `public.todos` in your migrations, so this subscription receives no data (events arrive with an Unauthorized error, or a filtered subscription is rejected after SUBSCRIBED). Fix in a migration: `grant select on public.todos to anon;`',
    );
  });

  it('names every missing privilege in one grant', () => {
    expect(
      fill(messages.noPrivilege, 'authenticated', 'public.orders', ['insert', 'update', 'select']),
    ).toBe(
      'authenticated has no insert, update or select privilege on `public.orders` in your migrations, so this call fails with 42501 (permission denied). Fix in a migration: `grant insert, update, select on public.orders to authenticated;`',
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
          'supabase/table-granted': options === undefined ? 'error' : ['error', options],
        },
        settings,
      },
    ],
    `${TS_FIXTURE_DIR}/file.ts`,
  );
}

const INSERT = (name: string, key = 'sb_publishable_test') =>
  [
    "import { createClient } from '@supabase/supabase-js';",
    `const supabase = createClient('http://localhost:54321', '${key}');`,
    `export const run = () => supabase.from('${name}').insert({});`,
  ].join('\n');

describe('table-granted in ESLint', () => {
  const project = { supabase: { projectDir: schemaFixture('table-granted') } };

  it('counts skips per reason, and checked calls without a reason', () => {
    const before = stats.snapshot();
    expect(lint(INSERT('not_created'), project)).toEqual([]);
    expect(lint(INSERT('orders'), project).map((m) => m.messageId)).toEqual(['noPrivilege']);
    // A service role call is checked too.
    expect(lint(INSERT('orders', 'sb_secret_test'), project).map((m) => m.messageId)).toEqual([
      'noPrivilege',
    ]);
    expect(lint(INSERT('scores'), project)).toEqual([]);
    expect(stats.snapshot().calls - before.calls).toBe(4);
    expect(stats.snapshot().skips).toEqual({
      ...before.skips,
      'unknown-relation': (before.skips['unknown-relation'] ?? 0) + 1,
    });
  });

  it('fails on a settings error even in a file without a Supabase call', () => {
    expect(() => lint('export const x = 1;', { supabase: { projectdir: '.' } })).toThrow(
      /projectdir.*Did you mean "projectDir"/s,
    );
  });

  it('rejects an ignoreTables entry without a reason', () => {
    expect(() => lint(INSERT('orders'), project, { ignoreTables: [{ table: 'orders' }] })).toThrow(
      /reason/,
    );
  });
});
