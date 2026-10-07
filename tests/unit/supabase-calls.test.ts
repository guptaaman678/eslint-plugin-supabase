import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import { describe, expect, it } from 'vitest';
import { analyzeCall, readsRows, type SupabaseCall } from '../../src/supabase/calls.js';
import { CLIENT, collect } from '../harness/analyze.js';

/** Every Supabase call in `code`, as plain data: the call's text plus what was found. */
function calls(code: string): Record<string, unknown>[] {
  return collect<TSESTree.CallExpression, Record<string, unknown>>(
    code,
    AST_NODE_TYPES.CallExpression,
    (node, { services, text }) => {
      const call: SupabaseCall | undefined = analyzeCall(services, node);
      if (call === undefined) return undefined;
      // The ESTree node is replaced by its text, so results compare as plain data.
      const data: Record<string, unknown> = { ...call, text: text(node) };
      delete data.node;
      if (call.kind === 'table') {
        data.operationNode = call.operationNode && text(call.operationNode);
        data.reads = readsRows(call);
      }
      return data;
    },
  );
}

/** The single Supabase call in `CLIENT + line`. */
function one(line: string): Record<string, unknown> {
  const found = calls(CLIENT + line);
  expect(found, line).toHaveLength(1);
  return found[0]!;
}

describe('table operations', () => {
  it('reads: select with count and head options', () => {
    expect(
      one("void supabase.from('todos').select('id', { count: 'exact', head: true });"),
    ).toEqual({
      kind: 'table',
      text: "supabase.from('todos')",
      skip: undefined,
      schemas: ['public'],
      tables: ['todos'],
      operation: 'select',
      operationNode: "supabase.from('todos').select('id', { count: 'exact', head: true })",
      filtered: false,
      returning: false,
      ignoreDuplicates: false,
      reads: true,
    });
  });

  it('records filters after select too', () => {
    expect(one("void supabase.from('todos').select().eq('id', 1).order('id');")).toMatchObject({
      operation: 'select',
      filtered: true,
      returning: false,
      reads: true,
    });
  });

  it('insert, and insert(...).select() which is not a read', () => {
    expect(one("void supabase.from('orders').insert({ id: 1 });")).toMatchObject({
      operation: 'insert',
      filtered: false,
      returning: false,
      reads: false,
    });
    expect(one("void supabase.from('orders').insert({ id: 1 }).select();")).toMatchObject({
      operation: 'insert',
      returning: true,
      reads: false,
    });
  });

  it('update: unfiltered, filtered, and filtered with select (a read)', () => {
    expect(one("void supabase.from('orders').update({ a: 1 });")).toMatchObject({
      operation: 'update',
      filtered: false,
      returning: false,
      reads: false,
    });
    expect(one("void supabase.from('orders').update({ a: 1 }).eq('id', 1);")).toMatchObject({
      operation: 'update',
      filtered: true,
      returning: false,
      reads: false,
    });
    expect(
      one("void supabase.from('orders').update({ a: 1 }).match({ id: 1 }).select('id');"),
    ).toMatchObject({ operation: 'update', filtered: true, returning: true, reads: true });
    expect(one("void supabase.from('orders').update({ a: 1 }).select();")).toMatchObject({
      operation: 'update',
      filtered: false,
      returning: true,
      reads: true,
    });
  });

  it('delete: filters by every filter method, not by throwOnError or Object methods', () => {
    expect(one("void supabase.from('messages').delete();")).toMatchObject({
      operation: 'delete',
      filtered: false,
      reads: false,
    });
    for (const filter of [
      "in('id', [1])",
      "neq('id', 1)",
      "or('id.eq.1,id.eq.2')",
      "not('id', 'is', null)",
      "filter('id', 'eq', 1)",
      "textSearch('body', 'x')",
    ]) {
      expect(one(`void supabase.from('messages').delete().${filter};`), filter).toMatchObject({
        filtered: true,
      });
    }
    expect(one("void supabase.from('messages').delete().throwOnError().toString();")).toMatchObject(
      { operation: 'delete', filtered: false, returning: false },
    );
    expect(one("void supabase.from('messages').delete().in('id', [1]).select();")).toMatchObject({
      filtered: true,
      returning: true,
      reads: true,
    });
  });

  it('delete with an unknown method chained (a type error) is not a filter', () => {
    expect(one("void supabase.from('messages').delete().nope();")).toMatchObject({
      operation: 'delete',
      filtered: false,
    });
  });

  it('upsert: merge by default; ignoreDuplicates read from literals and const aliases', () => {
    const cases: [string, boolean | undefined][] = [
      ['', false],
      [', { onConflict: "id" }', false],
      [', { ignoreDuplicates: true }', true],
      [', { ignoreDuplicates: false }', false],
      [', IGNORE', true],
      [', { ignoreDuplicates: FLAG }', true],
      [', { ignoreDuplicates: flag }', undefined],
      [', options', undefined],
      [', { ...options }', undefined],
    ];
    for (const [args, expected] of cases) {
      const code =
        'const IGNORE = { ignoreDuplicates: true };\nconst FLAG = true;\n' +
        'declare const flag: boolean;\ndeclare const options: { ignoreDuplicates?: boolean };\n' +
        `void supabase.from('scores').upsert({ id: 1 }${args});`;
      expect(one(code), args).toMatchObject({ operation: 'upsert', ignoreDuplicates: expected });
    }
  });

  it('skips a .from() whose operation is not chained to it', () => {
    const found = calls(
      CLIENT +
        [
          "const query = supabase.from('todos');",
          'void query.select();',
          "const select = supabase.from('todos').select;",
          "void supabase.from('todos')['select']();",
          "void Array.of(supabase.from('todos').select);",
          "void Promise.resolve(supabase.from('todos'));",
          'declare const lookup: Record<string, number>;',
          '// @ts-expect-error: a query builder is not an index',
          "void lookup[supabase.from('todos')];",
        ].join('\n'),
    );
    expect(found).toHaveLength(6);
    for (const call of found) {
      expect(call).toMatchObject({
        kind: 'table',
        skip: 'unknown-operation',
        operation: undefined,
        operationNode: undefined,
        tables: ['todos'],
        reads: false,
      });
    }
  });
});

describe('table names', () => {
  it('takes literals, template literals, const aliases and unions of at most five', () => {
    const code =
      CLIENT +
      [
        "import { tableName } from './clients';",
        "declare const pair: 'todos' | 'orders';",
        "declare const five: 'a' | 'b' | 'c' | 'd' | 'e';",
        "const aliased = 'scores';",
        'void supabase.from(`todos`).select();',
        'void supabase.from(pair).select();',
        'void supabase.from(five).select();',
        'void supabase.from(aliased).select();',
        'void supabase.from(tableName).select();',
      ].join('\n');
    expect(calls(code).map((call) => call.tables)).toEqual([
      ['todos'],
      ['todos', 'orders'],
      ['a', 'b', 'c', 'd', 'e'],
      ['scores'],
      ['scores'],
    ]);
  });

  it('skips dynamic names with reason dynamic-table', () => {
    const code =
      CLIENT +
      [
        "declare const six: 'a' | 'b' | 'c' | 'd' | 'e' | 'f';",
        'declare const name: string;',
        "declare const mixed: 'todos' | 1;",
        'void supabase.from(six).select();',
        'void supabase.from(name).select();',
        'void supabase.from(`${name}_v2`).select();',
        'void supabase.from(mixed).select();',
        '// @ts-expect-error: no argument',
        'void supabase.from().select();',
      ].join('\n');
    const found = calls(code);
    expect(found).toHaveLength(5);
    for (const call of found) {
      expect(call).toMatchObject({ skip: 'dynamic-table', tables: [], operation: 'select' });
    }
  });
});

describe('schemas', () => {
  function schemaOf(code: string): unknown {
    const found = calls(code);
    const last = found[found.length - 1]!;
    return last.skip === 'dynamic-schema' ? 'dynamic-schema' : last.schemas;
  }

  it('reads .schema(s) on the client, also through a const alias and across files', () => {
    expect(schemaOf(CLIENT + "void supabase.schema('audit').from('audit_log').select();")).toEqual([
      'audit',
    ]);
    expect(
      schemaOf(
        CLIENT + "const audit = supabase.schema('audit');\nvoid audit.from('audit_log').select();",
      ),
    ).toEqual(['audit']);
    expect(
      schemaOf("import { auditDb } from './clients';\nvoid auditDb.from('audit_log').select();"),
    ).toEqual(['audit']);
    expect(
      schemaOf(CLIENT + "declare const s: 'a' | 'b';\nvoid supabase.schema(s).from('t').select();"),
    ).toEqual(['a', 'b']);
  });

  it('skips a dynamic .schema(s) with reason dynamic-schema', () => {
    expect(
      schemaOf(CLIENT + 'declare const s: string;\nvoid supabase.schema(s).from("t").select();'),
    ).toBe('dynamic-schema');
    expect(
      schemaOf(
        CLIENT + '// @ts-expect-error: no argument\nvoid supabase.schema().from("t").select();',
      ),
    ).toBe('dynamic-schema');
  });

  it('reads db.schema at the createClient call, else public', () => {
    const client = (options: string) =>
      "import { createClient } from '@supabase/supabase-js';\n" +
      'declare const name: string;\ndeclare const dbOptions: { schema: "app" };\n' +
      "const base = { auth: { persistSession: false } };\nconst DB = { schema: 'app' } as const;\n" +
      `const db = createClient('http://localhost:54321', 'key'${options});\n` +
      "void db.from('todos').select();";
    const cases: [string, unknown][] = [
      ['', ['public']],
      [', { auth: { persistSession: false } }', ['public']],
      [', { db: {} }', ['public']],
      [", { db: { schema: 'app' } }", ['app']],
      [", { 'db': { schema: 'app' } }", ['app']],
      [', { db: DB }', ['app']],
      [', { db: { ...DB } }', 'dynamic-schema'],
      [", { ...base, db: { schema: 'app' } }", ['app']],
      [", { db: { schema: 'app' }, ...base }", 'dynamic-schema'],
      [', { db: { schema: name } }', 'dynamic-schema'],
      [', { db: dbOptions }', 'dynamic-schema'],
      [', base', ['public']],
      [', { db: { schema: "app" }, 1: true }', ['app']],
    ];
    for (const [options, expected] of cases) {
      expect(schemaOf(client(options)), options).toEqual(expected);
    }
  });

  it('reads db.schema of the ssr factories and new SupabaseClient', () => {
    const ssr =
      "import { createBrowserClient, createServerClient } from '@supabase/ssr';\n" +
      "const browser = createBrowserClient('http://localhost:54321', 'key', { db: { schema: 'app' } });\n" +
      "const server = createServerClient('http://localhost:54321', 'key', { cookies: { getAll: () => [] }, db: { schema: 'app' } });\n" +
      "void browser.from('todos').select();\nvoid server.from('todos').select();";
    expect(calls(ssr).map((call) => call.schemas)).toEqual([['app'], ['app']]);
    const constructed =
      "import { SupabaseClient } from '@supabase/supabase-js';\n" +
      "const db = new SupabaseClient('http://localhost:54321', 'key', { db: { schema: 'app' } });\n" +
      "void db.from('todos').select();\n" +
      '// @ts-expect-error: no arguments\nconst bare = new SupabaseClient;\n' +
      "void bare.from('todos').select();";
    expect(calls(constructed).map((call) => call.schemas)).toEqual([['app'], ['public']]);
  });

  it('follows imports and re-exports of clients and factories', () => {
    const code =
      "import { appDb, makeClient, type Db } from './clients';\n" +
      "const viaReexport = makeClient('http://localhost:54321', 'key', { db: { schema: 'reexported' } });\n" +
      'declare const typed: Db;\n' +
      "void appDb.from('todos').select();\n" +
      "void viaReexport.from('todos').select();\n" +
      "void typed.from('todos').select();";
    expect(calls(code).map((call) => call.schemas)).toEqual([['app'], ['reexported'], ['public']]);
  });

  it('uses public for clients it cannot trace to a supabase-js factory', () => {
    const code =
      CLIENT +
      [
        "function makeDb() { return createClient('u', 'k', { db: { schema: 'app' } }); }",
        'const own = makeDb();',
        "void own.from('todos').select();",
        'function param(client: SupabaseClient) { void client.from("todos").select(); }',
        'declare const holder: { get(): SupabaseClient };',
        "void holder.get().from('todos').select();",
        'const untyped: SupabaseClient = (globalThis as any).make();',
        "void untyped.from('todos').select();",
        'let later = supabase;',
        "void later.from('todos').select();",
        'const wrapped = (supabase as SupabaseClient)!;',
        "void (wrapped satisfies SupabaseClient).from('todos').select();",
        'class MyClient extends SupabaseClient {}',
        'declare const mine: MyClient;',
        "void mine.from('todos').select();",
      ].join('\n');
    const found = calls(code);
    expect(found).toHaveLength(7);
    for (const call of found) expect(call).toMatchObject({ schemas: ['public'], skip: undefined });
  });

  it('stops at a const cycle (broken code) and uses public', () => {
    const code =
      CLIENT +
      [
        '// @ts-expect-error: used before its declaration',
        'const first: SupabaseClient = second;',
        'const second: SupabaseClient = first;',
        "void first.from('todos').select();",
      ].join('\n');
    expect(calls(code)).toMatchObject([{ schemas: ['public'], skip: undefined }]);
  });
});

describe('rpc', () => {
  it('recognises rpc on the client and on a .schema() PostgrestClient', () => {
    const code =
      CLIENT +
      [
        'declare const fn: string;',
        'declare const s: string;',
        "void supabase.rpc('add_score', { n: 1 });",
        "void supabase.schema('audit').rpc('log_event');",
        'void supabase.rpc(fn);',
        "void supabase.schema(s).rpc('log_event');",
      ].join('\n');
    expect(calls(code)).toEqual([
      {
        kind: 'rpc',
        text: "supabase.rpc('add_score', { n: 1 })",
        skip: undefined,
        schemas: ['public'],
        functions: ['add_score'],
      },
      {
        kind: 'rpc',
        text: "supabase.schema('audit').rpc('log_event')",
        skip: undefined,
        schemas: ['audit'],
        functions: ['log_event'],
      },
      {
        kind: 'rpc',
        text: 'supabase.rpc(fn)',
        skip: undefined,
        schemas: ['public'],
        functions: undefined,
      },
      {
        kind: 'rpc',
        text: "supabase.schema(s).rpc('log_event')",
        skip: 'dynamic-schema',
        schemas: [],
        functions: ['log_event'],
      },
    ]);
  });
});

describe('realtime postgres_changes subscriptions', () => {
  const channel =
    CLIENT +
    "import { postgresChangesFilter } from '@supabase/realtime-js';\n" +
    "declare const name: string;\ndeclare const event: '*' | 'INSERT';\n" +
    "const channel = supabase.channel('room');\nconst cb = () => {};\n";

  function subscription(options: string): Record<string, unknown> {
    const found = calls(channel + `channel.on('postgres_changes', ${options}, cb);`);
    expect(found, options).toHaveLength(1);
    return found[0]!;
  }

  it('reads event, schema and table', () => {
    expect(subscription("{ event: 'INSERT', schema: 'public', table: 'todos' }")).toEqual({
      kind: 'realtime',
      text: "channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'todos' }, cb)",
      skip: undefined,
      schemas: ['public'],
      tables: ['todos'],
      events: ['INSERT'],
    });
    expect(subscription("{ event, schema: 'app', table: 'messages' }")).toMatchObject({
      skip: undefined,
      schemas: ['app'],
      tables: ['messages'],
      events: ['*', 'INSERT'],
    });
  });

  it('parses the 2.117 filter builder object and the select option', () => {
    expect(
      subscription(
        "{ event: 'UPDATE', schema: 'public', table: 'orders', filter: postgresChangesFilter().eq('id', 1), select: ['id', 'status'] }",
      ),
    ).toMatchObject({
      skip: undefined,
      schemas: ['public'],
      tables: ['orders'],
      events: ['UPDATE'],
    });
    expect(
      subscription("{ event: '*', schema: 'public', table: 'orders', filter: 'id=eq.1' }"),
    ).toMatchObject({ skip: undefined, tables: ['orders'] });
  });

  it('skips a missing or dynamic schema (no default schema, ADR-009)', () => {
    expect(subscription("{ event: '*', table: 'todos' } as never")).toMatchObject({
      skip: 'dynamic-schema',
      schemas: [],
      tables: ['todos'],
    });
    expect(subscription("{ event: '*', schema: name, table: 'todos' }")).toMatchObject({
      skip: 'dynamic-schema',
    });
    const options = 'declare const opts: { event: "*"; schema: string };\n';
    expect(calls(channel + options + "channel.on('postgres_changes', opts, cb);")).toMatchObject([
      { skip: 'dynamic-schema', events: undefined },
    ]);
    expect(
      calls(channel + "// @ts-expect-error: no options\nchannel.on('postgres_changes');"),
    ).toMatchObject([{ skip: 'dynamic-schema', schemas: [], tables: [], events: undefined }]);
  });

  it('skips every table of a schema, and schema *, with reason realtime-all-tables', () => {
    expect(subscription("{ event: '*', schema: 'public' }")).toMatchObject({
      skip: 'realtime-all-tables',
      schemas: ['public'],
      tables: [],
    });
    expect(subscription("{ event: '*', schema: '*', table: 'todos' }")).toMatchObject({
      skip: 'realtime-all-tables',
    });
  });

  it('skips a dynamic table with reason dynamic-table', () => {
    expect(subscription("{ event: '*', schema: 'public', table: name }")).toMatchObject({
      skip: 'dynamic-table',
      tables: [],
    });
  });

  it('reads options from a const alias and the events of a chained .on()', () => {
    const code =
      channel +
      "const OPTIONS = { event: 'DELETE', schema: 'public', table: 'todos' } as const;\n" +
      "channel.on('postgres_changes', OPTIONS, cb).on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, cb);";
    // ESLint visits the outer (last) call first.
    expect(calls(code)).toMatchObject([
      { tables: ['orders'], events: ['*'], skip: undefined },
      { tables: ['todos'], events: ['DELETE'], skip: undefined },
    ]);
  });

  it('ignores other listeners and .on() on other receivers', () => {
    const code =
      channel +
      [
        'declare const kind: string;',
        'declare const emitter: { on(e: string, o: object, cb: () => void): void };',
        "channel.on('broadcast', { event: 'x' }, cb);",
        "channel.on(kind as never, { event: 'x' }, cb);",
        "emitter.on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, cb);",
      ].join('\n');
    expect(calls(code)).toEqual([]);
  });
});

describe('calls that are not Supabase calls', () => {
  it('ignores storage.from, Array.from, computed and plain calls, and an aliased 2.58 client', () => {
    const code =
      CLIENT +
      [
        "import { createClient as createOld } from 'supabase-js-2-58';",
        "const old = createOld('http://localhost:54321', 'key');",
        "void supabase.storage.from('avatars').download('a.png');",
        'void Array.from([1]);',
        "void supabase['from']('todos').select();",
        'void Math.max(1, 2);',
        'void String(1);',
        "void old.from('todos').select();",
        'class Box { #from(t: string) { return t; } run() { return this.#from("x"); } }',
        'void Box;',
      ].join('\n');
    expect(calls(code)).toEqual([]);
  });
});
