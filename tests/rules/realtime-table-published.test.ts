import type { InvalidTestCase, ValidTestCase } from '@typescript-eslint/rule-tester';
import {
  realtimeTablePublished,
  type MessageId,
  type Options,
} from '../../src/rules/realtime-table-published.js';
import { loadEngine } from '../../src/schema/engine.js';
import { createRuleTester, schemaFixture } from '../harness/rule-tester.js';

// The rule replays real migrations through the engine (ADR-016).
await loadEngine();

const HEADER = [
  "import { createClient } from '@supabase/supabase-js';",
  "const supabase = createClient('http://localhost:54321', 'sb_publishable_test');",
  '',
].join('\n');

const code = (body: string): string => HEADER + body;

/** A subscription to `postgres_changes` with these options (an object literal's body). */
const subscribe = (options: string): string =>
  code(
    `supabase\n  .channel('changes')\n  .on('postgres_changes', { ${options} }, (payload) => payload)\n  .subscribe((status) => status);`,
  );

/** A subscription to `schema.table`, all events. */
const on = (table: string, schema = 'public'): string =>
  subscribe(`event: '*', schema: '${schema}', table: '${table}'`);

const settings = (fixture: string) => ({ supabase: { projectDir: schemaFixture(fixture) } });

type Valid = ValidTestCase<[Options]>;
type Invalid = InvalidTestCase<MessageId, [Options]>;

/** Users pass some options; ESLint fills in the rest from `meta.defaultOptions`. */
const partial = (options: Partial<Options>): [Options] => [options as Options];

function valid(fixture: string, source: string, options?: Partial<Options>): Valid {
  return {
    code: source,
    settings: settings(fixture),
    ...(options === undefined ? {} : { options: partial(options) }),
  };
}

function notPublished(
  fixture: string,
  source: string,
  tables: string[],
  options?: Partial<Options>,
): Invalid {
  const publication = options?.publication ?? 'supabase_realtime';
  return {
    ...valid(fixture, source, options),
    errors: tables.map((table) => ({
      messageId: 'notPublished' as const,
      data: { table, publication },
    })),
  };
}

const WHY_UNKNOWN_TABLE = (table: string) =>
  `\`${table}\` is not created as a table in your migrations. Set \`reportUnknownTables\` to report it.`;

function unresolved(
  fixture: string | undefined,
  source: string,
  reason: string,
  options: Partial<Options> = {},
): Invalid {
  return {
    code: source,
    ...(fixture === undefined ? {} : { settings: settings(fixture) }),
    options: partial({ reportUnresolved: true, ...options }),
    errors: [{ messageId: 'unresolved', data: { publication: 'supabase_realtime', reason } }],
  };
}

const SEED_AT = 'supabase/migrations/20260102000000_seed_realtime.sql:2';

createRuleTester().run('realtime-table-published', realtimeTablePublished, {
  valid: [
    // Added by `alter publication supabase_realtime add table`.
    valid('realtime', on('messages')),
    valid('realtime', subscribe("event: 'DELETE', schema: 'public', table: 'messages'")),
    // Another publication, by table and by schema.
    valid('realtime', on('orders'), { publication: 'orders_feed' }),
    valid('realtime', on('audit_log', 'app'), { publication: 'app_feed' }),
    // ADR-009 item 3: a `db pull` baseline's `ALTER PUBLICATION ... ADD TABLE ONLY "public"."messages"`.
    valid('db-pull', on('messages')),
    // A `do` block followed by a full redefinition: membership is known again.
    valid('realtime-redefined', on('messages')),
    // ADR-009 item 5: the 2.117 filter builder object and the `select` option still parse.
    valid(
      'realtime',
      "import { postgresChangesFilter } from '@supabase/realtime-js';\n" +
        subscribe(
          "event: 'UPDATE', schema: 'public', table: 'messages', filter: postgresChangesFilter().eq('id', 1), select: ['id', 'body']",
        ),
    ),
    valid(
      'realtime',
      subscribe("event: 'INSERT', schema: 'public', table: 'messages', filter: 'id=eq.1'"),
    ),
    // `ignoreTables`, qualified or a bare name in `public`.
    valid('realtime', on('todos'), {
      ignoreTables: [{ table: 'public.todos', reason: 'Published from the dashboard on purpose' }],
    }),
    valid('realtime', on('todos'), { ignoreTables: [{ table: 'todos', reason: 'Demo table' }] }),
    valid('realtime', on('audit_log', 'app'), {
      ignoreTables: [{ table: 'app.audit_log', reason: 'Read through a server' }],
    }),
    // Skipped: a table no migration creates, and a view (only tables can be published).
    valid('realtime', on('not_created')),
    valid('realtime', on('todo_titles')),
    // ADR-015: a `do` seed makes membership unknown: skipped as `publication-uncertain`.
    valid('realtime-do-seed', on('todos')),
    valid('realtime-do-seed', on('messages')),
    // A table explicitly added after the block is a known member.
    valid('realtime-do-seed', on('orders')),
    // Not resolvable: skipped and counted, never guessed.
    valid(
      'realtime',
      code(
        "declare const table: string;\nsupabase.channel('c').on('postgres_changes', { event: '*', schema: 'public', table }, (p) => p).subscribe((s) => s);",
      ),
    ),
    valid(
      'realtime',
      code(
        "declare const schema: string;\nsupabase.channel('c').on('postgres_changes', { event: '*', schema, table: 'todos' }, (p) => p).subscribe((s) => s);",
      ),
    ),
    valid('realtime', subscribe("event: '*', schema: 'public'")),
    valid('realtime', subscribe("event: '*', schema: '*', table: 'todos'")),
    // No project (no `supabase/migrations` above the file), and a replay that fails.
    on('todos'),
    valid('bad-config', on('todos')),
    // Not `postgres_changes`, or not a Supabase channel.
    valid(
      'realtime',
      code(
        "supabase.channel('room').on('broadcast', { event: 'todos' }, (p) => p).subscribe((s) => s);",
      ),
    ),
    valid(
      'realtime',
      code(
        "supabase.channel('room').on('presence', { event: 'sync' }, () => 1).subscribe((s) => s);",
      ),
    ),
    valid(
      'realtime',
      "class Emitter {\n  on(_event: string, _options: object) {\n    return this;\n  }\n}\nnew Emitter().on('postgres_changes', { event: '*', schema: 'public', table: 'todos' });",
    ),
    valid('realtime', code("void supabase.from('todos').select();")),
  ],
  invalid: [
    // Never added.
    notPublished('realtime', on('todos'), ['public.todos']),
    notPublished('realtime', on('scores'), ['public.scores']),
    // Added, then dropped.
    notPublished('realtime', on('orders'), ['public.orders']),
    // Another schema; another publication (option `publication`).
    notPublished('realtime', on('audit_log', 'app'), ['app.audit_log']),
    notPublished('realtime', on('messages'), ['public.messages'], { publication: 'orders_feed' }),
    notPublished('realtime', on('todos'), ['public.todos'], { publication: 'app_feed' }),
    // Every event needs the publication.
    notPublished('realtime', subscribe("event: 'DELETE', schema: 'public', table: 'todos'"), [
      'public.todos',
    ]),
    // ADR-009 item 3: tables the `db pull` baseline did not publish, and a table created after it.
    notPublished('db-pull', on('todos'), ['public.todos']),
    notPublished('db-pull', on('scores'), ['public.scores']),
    // ADR-015: a table explicitly dropped after the `do` block is a known non-member.
    notPublished('realtime-do-seed', on('scores'), ['public.scores']),
    // A `do` block before a full redefinition no longer counts.
    notPublished('realtime-redefined', on('todos'), ['public.todos']),
    // ADR-009 item 5: the 2.117 filter builder object and `select`, on an unpublished table.
    notPublished(
      'realtime',
      "import { postgresChangesFilter } from '@supabase/realtime-js';\n" +
        subscribe(
          "event: 'UPDATE', schema: 'public', table: 'todos', filter: postgresChangesFilter().eq('id', 1), select: ['id', 'title']",
        ),
      ['public.todos'],
    ),
    // A union names each member that fails.
    notPublished(
      'realtime',
      code(
        "declare const table: 'todos' | 'messages' | 'scores';\nsupabase.channel('c').on('postgres_changes', { event: '*', schema: 'public', table }, (p) => p).subscribe((s) => s);",
      ),
      ['public.todos', 'public.scores'],
    ),
    // A channel held in a variable, several `.on()` calls, inside a `forEach` body.
    notPublished(
      'realtime',
      code(
        "const channel = supabase.channel('todos');\nchannel\n  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => p)\n  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'todos' }, (p) => p);\nchannel.subscribe((status) => status);",
      ),
      ['public.todos'],
    ),
    notPublished(
      'realtime',
      code(
        "const tables = ['todos'] as const;\ntables.forEach((t) => {\n  supabase.channel(t).on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, (p) => p).subscribe((s) => s);\n});",
      ),
      ['public.scores'],
    ),
    // supabase-js 2.58.0.
    notPublished(
      'realtime',
      "import { createClient } from 'supabase-js-2-58';\nconst old = createClient('http://localhost:54321', 'sb_publishable_test');\nold.channel('c').on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, (p) => p).subscribe((s) => s);",
      ['public.todos'],
    ),
    // `ignoreTables` naming another table does not hide this one.
    notPublished('realtime', on('todos'), ['public.todos'], {
      ignoreTables: [{ table: 'public.scores', reason: 'Published from the dashboard' }],
    }),
    // `reportUnknownTables`: a table no migration creates, and a view.
    {
      ...valid('realtime', on('not_created'), { reportUnknownTables: true }),
      errors: [
        {
          messageId: 'unknownTable',
          data: { table: 'public.not_created', publication: 'supabase_realtime' },
        },
      ],
    },
    {
      ...valid('realtime', on('todo_titles'), { reportUnknownTables: true }),
      errors: [
        {
          messageId: 'unknownTable',
          data: { table: 'public.todo_titles', publication: 'supabase_realtime' },
        },
      ],
    },
    // `reportUnresolved` on a `do` seed (ADR-015) names the migration file and line.
    {
      ...valid('realtime-do-seed', on('todos'), { reportUnresolved: true }),
      errors: [
        {
          messageId: 'publicationUncertain',
          data: { table: 'public.todos', publication: 'supabase_realtime', location: SEED_AT },
        },
      ],
    },
    {
      ...valid('realtime-do-seed', on('not_created'), {
        reportUnresolved: true,
        reportUnknownTables: true,
      }),
      errors: [
        {
          messageId: 'publicationUncertain',
          data: {
            table: 'public.not_created',
            publication: 'supabase_realtime',
            location: SEED_AT,
          },
        },
      ],
    },
    // `reportUnresolved` on every other skip reason.
    unresolved('realtime', on('not_created'), WHY_UNKNOWN_TABLE('public.not_created')),
    unresolved('realtime', on('todo_titles'), WHY_UNKNOWN_TABLE('public.todo_titles')),
    unresolved(
      'realtime',
      code(
        "declare const table: string;\nsupabase.channel('c').on('postgres_changes', { event: '*', schema: 'public', table }, (p) => p).subscribe((s) => s);",
      ),
      'its `table` is not a string literal or a union of at most five. Use a literal table name.',
    ),
    unresolved(
      'realtime',
      code(
        "declare const schema: string;\nsupabase.channel('c').on('postgres_changes', { event: '*', schema, table: 'todos' }, (p) => p).subscribe((s) => s);",
      ),
      'its `schema` is not a string literal. Use a literal schema name.',
    ),
    unresolved(
      'realtime',
      code(
        "// @ts-expect-error: options are required\nsupabase.channel('c').on('postgres_changes');",
      ),
      'its `schema` is not a string literal. Use a literal schema name.',
    ),
    unresolved(
      'realtime',
      subscribe("event: '*', schema: 'public'"),
      'it listens to every table of a schema. Subscribe to each table by name to have it checked.',
    ),
    unresolved(
      undefined,
      on('todos'),
      'no `supabase/migrations` folder was found above this file. Set `settings.supabase.projectDir`.',
    ),
    unresolved(
      'bad-config',
      on('todos'),
      'replaying your migrations failed. Run `npx supabase-grants-lint check` to see why.',
    ),
  ],
});
