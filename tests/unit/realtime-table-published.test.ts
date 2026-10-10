import parser from '@typescript-eslint/parser';
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import {
  ignoredNames,
  locationText,
  publicationVerdict,
  qualified,
  realtimeTablePublished,
  unresolvedReason,
} from '../../src/rules/realtime-table-published.js';
// The plugin entry loads the engine at top level (ADR-016).
import plugin from '../../src/index.js';
import { createSchemaView } from '../../src/schema/view.js';
import { stats } from '../../src/stats.js';
import { AT, fakeSnapshot, fakeView } from '../harness/fake-snapshot.js';
import { schemaFixture, TS_FIXTURE_DIR } from '../harness/rule-tester.js';

const view = fakeView({
  relations: {
    'public.todos': {},
    'public.messages': {},
    'public.orders': {},
    'public.scores': {},
    'public.todo_titles': { kind: 'view' },
    'app.audit_log': {},
  },
  publications: {
    supabase_realtime: { tables: ['public.messages'] },
    seeded: { tables: ['public.orders'], uncertain: true, excluded: ['public.scores'] },
    by_schema: { schemas: ['app'] },
    everything: { allTables: true },
  },
});

const table = (name: string, schema = 'public') => ({ schema, name });
const NONE: ReadonlySet<string> = new Set();
const options = (
  publication = 'supabase_realtime',
  reportUnknownTables = false,
  ignored = NONE,
) => ({
  publication,
  reportUnknownTables,
  ignored,
});

describe('publicationVerdict', () => {
  it('passes a member by table, by schema and by all tables', () => {
    expect(publicationVerdict(view, table('messages'), options())).toEqual({ kind: 'ok' });
    expect(publicationVerdict(view, table('audit_log', 'app'), options('by_schema'))).toEqual({
      kind: 'ok',
    });
    expect(publicationVerdict(view, table('todos'), options('everything'))).toEqual({ kind: 'ok' });
  });

  it('reports a table that is not a member', () => {
    const report = { kind: 'report', messageId: 'notPublished' };
    expect(publicationVerdict(view, table('todos'), options())).toEqual(report);
    expect(publicationVerdict(view, table('audit_log', 'app'), options())).toEqual(report);
    expect(publicationVerdict(view, table('todos'), options('by_schema'))).toEqual(report);
    // A publication the migrations never create has no members.
    expect(publicationVerdict(view, table('todos'), options('missing'))).toEqual(report);
  });

  it('skips a table the migrations never create, and a view, unless reportUnknownTables', () => {
    const skip = { kind: 'skip', reason: 'unknown-table' };
    expect(publicationVerdict(view, table('not_created'), options())).toEqual(skip);
    expect(publicationVerdict(view, table('todo_titles'), options())).toEqual(skip);
    expect(publicationVerdict(view, table('todos', 'app'), options())).toEqual(skip);
    const report = { kind: 'report', messageId: 'unknownTable' };
    expect(publicationVerdict(view, table('not_created'), options(undefined, true))).toEqual(
      report,
    );
    expect(publicationVerdict(view, table('todo_titles'), options(undefined, true))).toEqual(
      report,
    );
    // `FOR ALL TABLES` covers a table the snapshot never saw, but not a view (ADR-017 §3).
    expect(publicationVerdict(view, table('not_created'), options('everything', true))).toEqual({
      kind: 'ok',
    });
    expect(publicationVerdict(view, table('todo_titles'), options('everything', true))).toEqual(
      report,
    );
  });

  it('skips as publication-uncertain after a do block, with the location (ADR-015)', () => {
    expect(publicationVerdict(view, table('todos'), options('seeded'))).toEqual({
      kind: 'skip',
      reason: 'publication-uncertain',
      at: AT,
    });
    expect(publicationVerdict(view, table('not_created'), options('seeded', true))).toEqual({
      kind: 'skip',
      reason: 'publication-uncertain',
      at: AT,
    });
    // Explicitly added before or after the block, or explicitly dropped after it: known.
    expect(publicationVerdict(view, table('orders'), options('seeded'))).toEqual({ kind: 'ok' });
    expect(publicationVerdict(view, table('scores'), options('seeded'))).toEqual({
      kind: 'report',
      messageId: 'notPublished',
    });
  });

  it('gives a null location when the membership is unknown without a mark', () => {
    const snapshot = fakeSnapshot({ relations: { todos: {} } });
    const unknown = createSchemaView(snapshot, () => 'unknown');
    expect(publicationVerdict(unknown, table('todos'), options())).toEqual({
      kind: 'skip',
      reason: 'publication-uncertain',
      at: null,
    });
    expect(publicationVerdict(unknown, table('todos'), options('missing'))).toEqual({
      kind: 'skip',
      reason: 'publication-uncertain',
      at: null,
    });
  });

  it('passes ignored tables before anything else', () => {
    const ignored = ignoredNames([
      { table: 'todos', reason: 'r' },
      { table: 'app.audit_log', reason: 'r' },
      { table: 'public.not_created', reason: 'r' },
    ]);
    for (const t of [table('todos'), table('audit_log', 'app'), table('not_created')]) {
      expect(publicationVerdict(view, t, options(undefined, true, ignored))).toEqual({
        kind: 'ok',
      });
    }
    // An ignored table is not checked even when its membership is unknown.
    expect(publicationVerdict(view, table('todos'), options('seeded', false, ignored))).toEqual({
      kind: 'ok',
    });
    expect(publicationVerdict(view, table('scores'), options(undefined, false, ignored))).toEqual({
      kind: 'report',
      messageId: 'notPublished',
    });
  });
});

describe('ignoredNames', () => {
  it('qualifies bare names with public', () => {
    expect([...ignoredNames([])]).toEqual([]);
    expect([
      ...ignoredNames([
        { table: 'todos', reason: 'a' },
        { table: 'app.audit_log', reason: 'b' },
      ]),
    ]).toEqual(['public.todos', 'app.audit_log']);
  });
});

describe('message helpers', () => {
  it('writes qualified names and locations', () => {
    expect(qualified(table('todos'))).toBe('public.todos');
    expect(locationText(AT)).toBe('supabase/migrations/0001_init.sql:1');
    expect(locationText(null)).toBe('an earlier migration');
  });

  it('explains every skip reason', () => {
    expect(unresolvedReason('unknown-table', 'public.x')).toContain('`public.x` is not created');
    expect(unresolvedReason('dynamic-schema')).toContain('`schema`');
    expect(unresolvedReason('dynamic-table')).toContain('`table`');
    expect(unresolvedReason('realtime-all-tables')).toContain('every table');
    expect(unresolvedReason('no-project')).toContain('settings.supabase.projectDir');
    expect(unresolvedReason('engine-error')).toContain('supabase-grants-lint check');
  });
});

describe('messages (§6.6)', () => {
  it('formats notPublished as the spec words it', () => {
    const template = realtimeTablePublished.meta.messages.notPublished;
    const text = template
      .replaceAll('{{table}}', 'public.todos')
      .replaceAll('{{publication}}', 'supabase_realtime');
    expect(text).toBe(
      '`public.todos` is not in the `supabase_realtime` publication in your migrations, so this subscription connects and never receives an event. Add it in a migration: `alter publication supabase_realtime add table public.todos;`',
    );
  });

  it('says what to do about a do block (ADR-015)', () => {
    const text = realtimeTablePublished.meta.messages.publicationUncertain;
    expect(text).toContain('at {{location}}');
    expect(text).toContain('Replace that block with plain statements');
    expect(text).toContain('`alter publication {{publication}} add table {{table}};`');
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
          'supabase/realtime-table-published': options === undefined ? 'error' : ['error', options],
        },
        settings,
      },
    ],
    `${TS_FIXTURE_DIR}/file.ts`,
  );
}

const SUBSCRIBE = (name: string) =>
  [
    "import { createClient } from '@supabase/supabase-js';",
    "const supabase = createClient('http://localhost:54321', 'sb_publishable_test');",
    `supabase.channel('c').on('postgres_changes', { event: '*', schema: 'public', table: '${name}' }, (p) => p).subscribe((s) => s);`,
  ].join('\n');

describe('realtime-table-published in ESLint', () => {
  it('counts skips per reason, and checked calls without a reason', () => {
    const before = stats.snapshot();
    const count = (reason: 'publication-uncertain' | 'unknown-table') =>
      (stats.snapshot().skips[reason] ?? 0) - (before.skips[reason] ?? 0);
    const seeded = { supabase: { projectDir: schemaFixture('realtime-do-seed') } };
    expect(lint(SUBSCRIBE('todos'), seeded)).toEqual([]);
    expect(count('publication-uncertain')).toBe(1);
    expect(
      lint(SUBSCRIBE('not_created'), { supabase: { projectDir: schemaFixture('realtime') } }),
    ).toEqual([]);
    expect(count('unknown-table')).toBe(1);
    expect(lint(SUBSCRIBE('scores'), seeded).map((m) => m.messageId)).toEqual(['notPublished']);
    expect(stats.snapshot().calls - before.calls).toBe(3);
    // A published table is looked at too.
    expect(
      lint(SUBSCRIBE('messages'), { supabase: { projectDir: schemaFixture('realtime') } }),
    ).toEqual([]);
    expect(stats.snapshot().calls - before.calls).toBe(4);
    // ... and passes even when unresolved calls are reported.
    expect(
      lint(
        SUBSCRIBE('messages'),
        { supabase: { projectDir: schemaFixture('realtime') } },
        { reportUnresolved: true },
      ),
    ).toEqual([]);
  });

  it('fails on a settings error even in a file without a subscription', () => {
    expect(() => lint('export const x = 1;', { supabase: { projectdir: '.' } })).toThrow(
      /projectdir.*Did you mean "projectDir"/s,
    );
  });

  it('rejects an ignoreTables entry without a reason', () => {
    expect(() =>
      lint(SUBSCRIBE('todos'), {}, { ignoreTables: [{ table: 'public.todos' }] }),
    ).toThrow(/reason/);
  });
});
