import type { InvalidTestCase } from '@typescript-eslint/rule-tester';
import { noUnsentQuery, type MessageId } from '../../src/rules/no-unsent-query.js';
import { createRuleTester } from '../harness/rule-tester.js';

const HEADER = [
  "import { createClient } from '@supabase/supabase-js';",
  "const supabase = createClient('http://localhost:54321', 'sb_publishable_test');",
  '',
].join('\n');

const code = (body: string): string => HEADER + body;

interface Expected {
  readonly messageId: 'voidBuilder' | 'floatingBuilder';
  readonly what?: 'query' | 'storage download';
  /** The text the suggestions replace, and its replacement by each suggestion. */
  readonly target: string;
  readonly then: string;
  /** Only inside an async function. */
  readonly await?: string;
}

function invalid(body: string, expected: Expected): InvalidTestCase<MessageId, []> {
  const output = (replacement: string): string => code(body.replace(expected.target, replacement));
  return {
    code: code(body),
    errors: [
      {
        messageId: expected.messageId,
        data: { what: expected.what ?? 'query' },
        suggestions: [
          ...(expected.await === undefined
            ? []
            : [{ messageId: 'suggestAwait' as const, output: output(expected.await) }]),
          { messageId: 'suggestThen', output: output(expected.then) },
        ],
      },
    ],
  };
}

const insert = "supabase.from('todos').insert({ title: 'a' })";
const rpc = "supabase.rpc('add_score', { points: 1 })";
const download = "supabase.storage.from('avatars').download('a.png')";
const union = "flag ? supabase.from('todos').select() : supabase.from('orders').select()";

createRuleTester().run('no-unsent-query', noUnsentQuery, {
  valid: [
    // `.then()` sends the request (spec §6.6, ADR-002 item 5).
    code("void supabase.from('todos').select().then();"),
    code(`void ${download}.then((result) => result);`),
    code("supabase.from('todos').select().then(undefined, () => undefined);"),
    code(`${insert}.then(() => undefined).catch(() => undefined);`),
    // Sent, or handed on.
    code("async function load() {\n  await supabase.from('todos').select();\n}"),
    code("export function load() {\n  return supabase.from('todos').select();\n}"),
    code("export const query = supabase.from('todos').select();"),
    code("let query;\nquery = supabase.from('todos').select();\nexport { query };"),
    code("console.log(supabase.from('todos').select());"),
    code("export const queries = [supabase.from('todos').select()];"),
    code("export const byName = { todos: supabase.from('todos').select() };"),
    code("export const loads = [1].map(() => supabase.from('todos').select());"),
    // Eager promises: every other storage method, functions, auth (ADR-002 item 3).
    code("void supabase.storage.from('avatars').upload('a.png', new Blob(['a']));"),
    code("void supabase.storage.from('avatars').remove(['a.png']);"),
    code("void supabase.functions.invoke('send-welcome');"),
    code('void supabase.auth.getUser();'),
    code("supabase.functions.invoke('send-welcome');"),
    // Not Supabase, or not a builder.
    'void Promise.resolve(1);',
    "'use strict';\nexport const n = -1;",
    'class PostgrestBuilder {\n  then() {}\n}\nnew PostgrestBuilder();\nvoid new PostgrestBuilder();',
    code("typeof supabase.from('todos').select();"),
    // ADR-022 item 5: filters and transforms refine a builder variable in place; it is sent later.
    code(
      "export async function list(done: boolean) {\n  const q = supabase.from('todos').select();\n  if (done) q.eq('done', true);\n  q.order('id').limit(10);\n  await q;\n}",
    ),
    code(
      "import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';\n" +
        "export function narrow(q: PostgrestFilterBuilder<any, any, any, any, any, any, any>) {\n  q.in('id', [1, 2]).range(0, 9);\n  return q;\n}",
    ),
  ],
  invalid: [
    // ADR-022 item 5: still reported: the variable alone, a chain from the client, and a chain
    // ending in a method that returns another builder.
    invalid("const q = supabase.from('todos').select();\nq;", {
      messageId: 'floatingBuilder',
      target: 'q;',
      then: 'void q.then();',
    }),
    invalid("supabase.from('todos').update({ done: true }).eq('id', 1);", {
      messageId: 'floatingBuilder',
      target: "supabase.from('todos').update({ done: true }).eq('id', 1)",
      then: "void supabase.from('todos').update({ done: true }).eq('id', 1).then()",
    }),
    invalid("const q = supabase.from('todos').select();\nq.eq('id', 1).csv();", {
      messageId: 'floatingBuilder',
      target: "q.eq('id', 1).csv()",
      then: "void q.eq('id', 1).csv().then()",
    }),
    invalid("const q = supabase.from('todos').select();\nq['eq']('id', 1);", {
      messageId: 'floatingBuilder',
      target: "q['eq']('id', 1)",
      then: "void q['eq']('id', 1).then()",
    }),
    invalid(
      "const q = supabase.from('todos').select();\nconst same = <T>(value: T): T => value;\nsame(q);",
      { messageId: 'floatingBuilder', target: 'same(q)', then: 'void same(q).then()' },
    ),
    invalid("const t = supabase.from('todos');\nt.select().eq('id', 1);", {
      messageId: 'floatingBuilder',
      target: "t.select().eq('id', 1)",
      then: "void t.select().eq('id', 1).then()",
    }),
    // ADR-006 item 4: bare from().insert(), rpc(), storage download, and inside a forEach body.
    invalid(`${insert};`, {
      messageId: 'floatingBuilder',
      target: insert,
      then: `void ${insert}.then()`,
    }),
    invalid(`void ${insert};`, {
      messageId: 'voidBuilder',
      target: `void ${insert}`,
      then: `void ${insert}.then()`,
    }),
    invalid(`${rpc};`, { messageId: 'floatingBuilder', target: rpc, then: `void ${rpc}.then()` }),
    invalid(`void ${rpc};`, {
      messageId: 'voidBuilder',
      target: `void ${rpc}`,
      then: `void ${rpc}.then()`,
    }),
    // ADR-002 item 5: one case per storage download builder.
    invalid(`void ${download};`, {
      messageId: 'voidBuilder',
      what: 'storage download',
      target: `void ${download}`,
      then: `void ${download}.then()`,
    }),
    invalid(`${download}.asStream();`, {
      messageId: 'floatingBuilder',
      what: 'storage download',
      target: `${download}.asStream()`,
      then: `void ${download}.asStream().then()`,
    }),
    invalid(`void ${download}.asStream();`, {
      messageId: 'voidBuilder',
      what: 'storage download',
      target: `void ${download}.asStream()`,
      then: `void ${download}.asStream().then()`,
    }),
    invalid(
      "const rows = [{ title: 'a' }];\nrows.forEach((row) => {\n  supabase.from('todos').insert(row);\n});",
      {
        messageId: 'floatingBuilder',
        target: "supabase.from('todos').insert(row)",
        then: "void supabase.from('todos').insert(row).then()",
      },
    ),
    // A builder held in a variable.
    invalid("const query = supabase.from('orders').select('id').eq('id', 1);\nvoid query;", {
      messageId: 'voidBuilder',
      target: 'void query',
      then: 'void query.then()',
    }),
    invalid("const query = supabase.from('orders').select('id');\nquery;", {
      messageId: 'floatingBuilder',
      target: '\nquery;',
      then: '\nvoid query.then();',
    }),
    // A union of builders, which needs parentheses.
    invalid(`declare const flag: boolean;\nvoid (${union});`, {
      messageId: 'voidBuilder',
      target: `void (${union})`,
      then: `void (${union}).then()`,
    }),
    // Filters and `.select()` after a write keep it lazy.
    invalid("supabase.from('orders').update({ paid: true }).eq('id', 1).select();", {
      messageId: 'floatingBuilder',
      target: "supabase.from('orders').update({ paid: true }).eq('id', 1).select()",
      then: "void supabase.from('orders').update({ paid: true }).eq('id', 1).select().then()",
    }),
    // An optional chain gives `builder | undefined`.
    invalid("declare const maybe: typeof supabase | undefined;\nmaybe?.from('todos').select();", {
      messageId: 'floatingBuilder',
      target: "maybe?.from('todos').select()",
      then: "void maybe?.from('todos').select().then()",
    }),
    // A sequence ends in a builder.
    invalid("(console.log('saving'), supabase.from('todos').select());", {
      messageId: 'floatingBuilder',
      target: "console.log('saving'), supabase.from('todos').select()",
      then: "void (console.log('saving'), supabase.from('todos').select()).then()",
    }),
    // Inside an async function both suggestions are offered.
    invalid(`async function save() {\n  void ${insert};\n}`, {
      messageId: 'voidBuilder',
      target: `void ${insert}`,
      then: `void ${insert}.then()`,
      await: `await ${insert}`,
    }),
    invalid("const remove = async () => {\n  supabase.from('todos').delete().eq('id', 1);\n};", {
      messageId: 'floatingBuilder',
      target: "supabase.from('todos').delete().eq('id', 1)",
      then: "void supabase.from('todos').delete().eq('id', 1).then()",
      await: "await supabase.from('todos').delete().eq('id', 1)",
    }),
    invalid(`export const pick = async function (flag: boolean) {\n  void (${union});\n};`, {
      messageId: 'voidBuilder',
      target: `void (${union})`,
      then: `void (${union}).then()`,
      await: `await (${union})`,
    }),
    // ...but not where `await` is not allowed, even inside an async function.
    invalid(
      "async function setup() {\n  class Queue {\n    static {\n      supabase.from('todos').select();\n    }\n  }\n  return Queue;\n}",
      {
        messageId: 'floatingBuilder',
        target: "supabase.from('todos').select()",
        then: "void supabase.from('todos').select().then()",
      },
    ),
    invalid(
      "async function setup() {\n  class Queue {\n    pending = void supabase.from('todos').select();\n  }\n  return Queue;\n}",
      {
        messageId: 'voidBuilder',
        target: "void supabase.from('todos').select()",
        then: "void supabase.from('todos').select().then()",
      },
    ),
    invalid(
      "async function setup() {\n  return function () {\n    supabase.from('todos').select();\n  };\n}",
      {
        messageId: 'floatingBuilder',
        target: "supabase.from('todos').select()",
        then: "void supabase.from('todos').select().then()",
      },
    ),
    // supabase-js 2.58.0: `.throwOnError()` returns an intersection with the builder (ADR-003).
    {
      code: "import { createClient } from 'supabase-js-2-58';\nconst old = createClient('http://localhost:54321', 'sb_publishable_test');\nvoid old.from('todos').select().throwOnError();",
      errors: [
        {
          messageId: 'voidBuilder',
          data: { what: 'query' },
          line: 3,
          suggestions: [
            {
              messageId: 'suggestThen',
              output:
                "import { createClient } from 'supabase-js-2-58';\nconst old = createClient('http://localhost:54321', 'sb_publishable_test');\nvoid old.from('todos').select().throwOnError().then();",
            },
          ],
        },
      ],
    },
  ],
});
