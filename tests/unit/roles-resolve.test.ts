import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import { describe, expect, it } from 'vitest';
import { resolveClientRoles, type ClientRoles } from '../../src/roles/resolve.js';
import { parseSettings } from '../../src/settings.js';
import { analyzeCall } from '../../src/supabase/calls.js';
import { CLIENT, collect } from '../harness/analyze.js';

const PROJECT = fileURLToPath(new URL('../fixtures/ts', import.meta.url));
const URL_ARG = "'http://localhost:54321'";

/** The client text and resolved roles of every Supabase call in `code` (linted as file.ts). */
function resolveAll(
  code: string,
  raw: Record<string, unknown> = {},
  projectDir = PROJECT,
): (ClientRoles & { client: string })[] {
  const settings = parseSettings(raw, PROJECT);
  return collect<TSESTree.CallExpression, ClientRoles & { client: string }>(
    code,
    AST_NODE_TYPES.CallExpression,
    (node, { services, text }) => {
      const call = analyzeCall(services, node);
      if (call === undefined) return undefined;
      const client = text((node.callee as TSESTree.MemberExpression).object);
      return { client, ...resolveClientRoles(services, call, settings, projectDir) };
    },
  );
}

/** A result without its client text. */
function rolesOnly({ roles, source, skip }: ClientRoles): ClientRoles {
  return { roles, source, skip } as ClientRoles;
}

/** The roles of the single Supabase call in `code`. */
function only(code: string, raw?: Record<string, unknown>): ClientRoles {
  const found = resolveAll(code, raw);
  expect(found, code).toHaveLength(1);
  return rolesOnly(found[0]!);
}

/** A client made by `createClient(url, <key>)` after `prelude`, and one call on it. */
function keyed(key: string, prelude = ''): string {
  return (
    "import { createClient } from '@supabase/supabase-js';\n" +
    `${prelude}\n` +
    `const db = createClient(${URL_ARG}, ${key});\n` +
    "void db.from('todos').select();\n"
  );
}

const DEFAULT = ['anon', 'authenticated'];
const SERVICE = { roles: ['service_role'], source: 'service-role-key', skip: undefined };
const CLIENT_KEY = { roles: DEFAULT, source: 'client-key', skip: undefined };
const UNKNOWN = { roles: DEFAULT, source: 'unknown-key', skip: undefined };
const NO_CLIENT = { roles: [], source: undefined, skip: 'unknown-client' };
const mapped = (...roles: string[]) => ({ roles, source: 'settings', skip: undefined });

const DENO =
  'declare const Deno: { env: { get(name?: string): string; read(name: string): string } };';

describe('§6.5 steps 2 to 4: the key argument', () => {
  it.each([
    // Step 2: service-role and secret-key names and the secret prefix.
    ["'sb_secret_test'", '', SERVICE],
    ['`sb_secret_test`', '', SERVICE],
    ['process.env.SUPABASE_SERVICE_ROLE_KEY!', '', SERVICE],
    ['process.env.SUPABASE_SECRET_KEY as string', '', SERVICE],
    ["Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')", DENO, SERVICE],
    ['config.service_role', 'declare const config: { service_role: string };', SERVICE],
    ['secretKey', 'declare const secretKey: string;', SERVICE],
    ['(serviceRole satisfies string)', 'declare const serviceRole: string;', SERVICE],
    ['process.env.SUPABASE_SERVICE_KEY!', '', SERVICE],
    ['serviceKey', 'declare const serviceKey: string;', SERVICE],
    ['service_key', 'declare const service_key: string;', SERVICE],
    // A string literal first argument of any call counts as a name (ADR-022 item 4).
    ["keys.get('SUPABASE_SERVICE_ROLE_KEY')!", 'declare const keys: Map<string, string>;', SERVICE],
    ["Deno.env.read('SUPABASE_SERVICE_ROLE_KEY')", DENO, SERVICE],
    [
      "requireServerEnvironment('SUPABASE_SERVICE_ROLE_KEY')",
      'declare function requireServerEnvironment(name: string): string;',
      SERVICE,
    ],
    ['getEnv(`SUPABASE_SERVICE_KEY`)', 'declare function getEnv(name: string): string;', SERVICE],
    // Step 3: anon and publishable names and the publishable prefix.
    ["'sb_publishable_test'", '', CLIENT_KEY],
    ['import.meta.env.VITE_SUPABASE_ANON_KEY', '', CLIENT_KEY],
    ["process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']!", '', CLIENT_KEY],
    ["Deno.env.get('SUPABASE_ANON_KEY')", DENO, CLIENT_KEY],
    ['anonKey', 'declare const anonKey: string;', CLIENT_KEY],
    ['anon_key', 'declare const anon_key: string;', CLIENT_KEY],
    ["getEnv('SUPABASE_ANON_KEY')", 'declare function getEnv(name: string): string;', CLIENT_KEY],
    // Fallbacks: both sides count, and step 2 wins over step 3.
    ["process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''", '', SERVICE],
    ["'' || process.env.SUPABASE_ANON_KEY!", '', CLIENT_KEY],
    [
      'anonKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY!',
      'declare const anonKey: string;',
      SERVICE,
    ],
    // Step 4: nothing visible.
    ["process.env.SUPABASE_SERVICE_ROLE_KEY! && 'x'", '', UNKNOWN],
    ['process.env.SUPABASE_KEY!', '', UNKNOWN],
    ["'eyJ0ZXN0'", '', UNKNOWN],
    ["'sb_temp_test'", '', UNKNOWN],
    ['process.env[name]!', 'declare const name: string;', UNKNOWN],
    ['process.env[serviceRoleKey]!', 'declare const serviceRoleKey: string;', UNKNOWN],
    ['getKey()', 'declare function getKey(): string;', UNKNOWN],
    ["getEnv('SUPABASE_KEY')", 'declare function getEnv(name: string): string;', UNKNOWN],
    [
      "getEnv(name, 'SUPABASE_SERVICE_ROLE_KEY')",
      'declare function getEnv(a: string, b: string): string;\ndeclare const name: string;',
      UNKNOWN,
    ],
    ['Deno.env.get()', DENO, UNKNOWN],
    ['Deno.env.get(name)', `${DENO}\ndeclare const name: string;`, UNKNOWN],
    ['`${prefix}_key`', 'declare const prefix: string;', UNKNOWN],
  ])('createClient(url, %s)', (key, prelude, expected) => {
    expect(only(keyed(key, prelude))).toEqual(expected);
  });

  it('follows the key through const aliases and imports', () => {
    const chain =
      'const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;\nconst key = serviceKey;';
    expect(only(keyed('key', chain))).toEqual(SERVICE);
    // adminKey's own name says nothing; the env variable it is read from does.
    const imported = "import { adminKey as k } from './admin';";
    expect(only(keyed('k', imported))).toEqual(SERVICE);
  });

  it('follows nested fallbacks up to the depth limit', () => {
    const nested = (levels: number) =>
      'a ?? ('.repeat(levels) + 'process.env.SUPABASE_SERVICE_ROLE_KEY!' + ')'.repeat(levels);
    const prelude = 'declare const a: string | undefined;';
    expect(only(keyed(nested(15), prelude))).toEqual(SERVICE);
    expect(only(keyed(nested(16), prelude))).toEqual(UNKNOWN);
    // `x ?? a ?? a` groups to the left, so the key is the deepest left operand.
    const left = (levels: number) =>
      'process.env.SUPABASE_SERVICE_ROLE_KEY!' + ' ?? a'.repeat(levels);
    expect(only(keyed(left(15), prelude))).toEqual(SERVICE);
    expect(only(keyed(left(16), prelude))).toEqual(UNKNOWN);
  });

  it('stops on a const cycle', () => {
    expect(only(keyed('a', 'const a: string = b;\nconst b: string = a;'))).toEqual(UNKNOWN);
  });

  it('treats a missing key argument as unknown', () => {
    expect(only(keyed('undefined as never').replace(`, undefined as never`, ''))).toEqual(UNKNOWN);
  });

  it('skips an unknown key with unknownKey "skip", and still resolves visible keys', () => {
    const skip = { unknownKey: 'skip' };
    expect(only(keyed('process.env.SUPABASE_KEY!'), skip)).toEqual({
      roles: [],
      source: undefined,
      skip: 'unknown-key',
    });
    expect(only(keyed("'sb_publishable_test'"), skip)).toEqual(CLIENT_KEY);
    expect(only(keyed("'sb_secret_test'"), skip)).toEqual(SERVICE);
  });

  it('gives defaultRoles to client and unknown keys', () => {
    const settings = { defaultRoles: ['authenticated'] };
    expect(only(keyed("'sb_publishable_test'"), settings)).toEqual({
      ...CLIENT_KEY,
      roles: ['authenticated'],
    });
    expect(only(keyed('process.env.SUPABASE_KEY!'), settings)).toEqual({
      ...UNKNOWN,
      roles: ['authenticated'],
    });
  });

  it('reads the key of new SupabaseClient, the ssr factories and a namespace import', () => {
    expect(
      only(`${CLIENT}void new SupabaseClient(${URL_ARG}, 'sb_secret_test').from('t').select();`),
    ).toEqual(SERVICE);
    expect(only(`${CLIENT}const db = new SupabaseClient;\nvoid db.from('t').select();`)).toEqual(
      UNKNOWN,
    );
    const ssr =
      "import { createBrowserClient, createServerClient } from '@supabase/ssr';\n" +
      `const server = createServerClient(${URL_ARG}, process.env.SUPABASE_SECRET_KEY!, { cookies: { getAll: () => [], setAll: () => {} } });\n` +
      `const browser = createBrowserClient(${URL_ARG}, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);\n` +
      "void server.from('todos').select();\nvoid browser.from('todos').select();\n";
    expect(resolveAll(ssr)).toEqual([
      { client: 'server', ...SERVICE },
      { client: 'browser', ...CLIENT_KEY },
    ]);
    const namespace =
      "import * as sb from '@supabase/supabase-js';\n" +
      `const db = sb.createClient(${URL_ARG}, 'sb_secret_test');\nvoid db.from('todos').select();\n`;
    expect(only(namespace)).toEqual(SERVICE);
  });
});

describe('§6.5: tracing the client to its origin', () => {
  it('follows const aliases, wrappers and imports across files', () => {
    const code =
      `${CLIENT}const db = supabase;\nconst db2 = (db as SupabaseClient)!;\n` +
      "void db2.from('todos').select();\n" +
      "import { adminDb, adminKey } from './admin';\n" +
      "import { appDb, auditDb } from './clients';\n" +
      "void appDb.from('todos').select();\nvoid auditDb.from('scores').select();\n" +
      "void adminDb.rpc('fn');\n" +
      `void createClient(${URL_ARG}, adminKey).from('todos').select();\n`;
    expect(resolveAll(code)).toEqual([
      { client: 'db2', ...CLIENT_KEY },
      { client: 'appDb', ...CLIENT_KEY },
      { client: 'auditDb', ...CLIENT_KEY },
      { client: 'adminDb', ...SERVICE },
      { client: `createClient(${URL_ARG}, adminKey)`, ...SERVICE },
    ]);
  });

  it('steps through supabase-js methods: schema, channel and chained on', () => {
    const code =
      "import { adminDb } from './admin';\n" +
      "void adminDb.schema('audit').from('audit_log').select();\n" +
      "const channel = adminDb.channel('c');\n" +
      "channel.on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => {})" +
      ".on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {});\n";
    expect(resolveAll(code)).toEqual([
      { client: "adminDb.schema('audit')", ...SERVICE },
      {
        client:
          "channel.on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => {})",
        ...SERVICE,
      },
      { client: 'channel', ...SERVICE },
    ]);
  });

  it('reads the clients a project factory or method returns, across files', () => {
    const code =
      "import { createAdminClient, createServerDb, Repo } from './admin';\n" +
      "void createAdminClient().from('todos').select();\n" +
      "async function list() {\n  const db = await createServerDb();\n  return db.from('todos').select();\n}\n" +
      "void new Repo().client().from('todos').select();\n" +
      'void list;\n';
    // createServerDb returns Promise.resolve(...), which is not a client origin.
    expect(resolveAll(code)).toEqual([
      { client: 'createAdminClient()', ...SERVICE },
      { client: 'db', ...UNKNOWN },
      { client: 'new Repo().client()', ...CLIENT_KEY },
    ]);
  });

  it('step 5: skips a parameter, a let, a property and a computed method', () => {
    const code =
      `${CLIENT}function list(db: SupabaseClient) {\n  return db.from('todos').select();\n}\n` +
      "let mutable = supabase;\nvoid mutable.from('todos').select();\n" +
      "const ctx = { db: supabase };\nvoid ctx.db.from('todos').select();\n" +
      "void supabase['schema']('audit').from('scores').select();\n" +
      'void list;\n';
    // A settings entry for this very file does not apply without an origin.
    expect(resolveAll(code, { clients: [{ module: 'file.ts', role: 'anon' }] })).toEqual([
      { client: 'db', ...NO_CLIENT },
      { client: 'mutable', ...NO_CLIENT },
      { client: 'ctx.db', ...NO_CLIENT },
      { client: "supabase['schema']('audit')", ...NO_CLIENT },
    ]);
  });

  it('step 5: stops on a chain too long to follow', () => {
    const chain = (length: number) => Array.from({ length }, () => ".schema('app')").join('');
    expect(only(`${CLIENT}void supabase${chain(17)}.from('scores').select();`)).toEqual(NO_CLIENT);
    expect(only(`${CLIENT}void supabase${chain(16)}.from('scores').select();`)).toEqual(NO_CLIENT);
    expect(only(`${CLIENT}void supabase${chain(15)}.from('scores').select();`)).toEqual(CLIENT_KEY);
  });

  it('does not read the key argument of a project factory', () => {
    const code =
      "import { createClient } from '@supabase/supabase-js';\n" +
      'function makeDb(url: string, key: string) {\n  return createClient(url, key);\n}\n' +
      "void makeDb('http://localhost', process.env.SUPABASE_SERVICE_ROLE_KEY!).from('todos').select();\n";
    expect(only(code)).toEqual(UNKNOWN);
  });

  it('step 5: skips new of a class outside supabase-js, such as a Proxy', () => {
    const code =
      "import * as sb from '@supabase/supabase-js';\n" +
      `${CLIENT}declare function getAdmin(): SupabaseClient;\n` +
      'const admin = new Proxy({} as SupabaseClient, { get: (_, p) => Reflect.get(getAdmin(), p) });\n' +
      "void admin.from('todos').select();\n" +
      `void new sb.SupabaseClient(${URL_ARG}, 'sb_secret_test').from('todos').select();\n`;
    expect(resolveAll(code)).toEqual([
      { client: 'admin', ...NO_CLIENT },
      { client: `new sb.SupabaseClient(${URL_ARG}, 'sb_secret_test')`, ...SERVICE },
    ]);
  });
});

describe('ADR-022: following a project factory to the clients it returns', () => {
  const head = "import { createClient } from '@supabase/supabase-js';\n";
  const call = (factory: string) => `void ${factory}().from('todos').select();\n`;
  const secret = `createClient(${URL_ARG}, process.env.SUPABASE_SERVICE_ROLE_KEY!)`;
  const anon = `createClient(${URL_ARG}, process.env.SUPABASE_ANON_KEY!)`;

  it.each([
    ['a function declaration', `function admin() {\n  return ${secret};\n}\n`, SERVICE],
    ['an arrow with an expression body', `const admin = () => ${anon};\n`, CLIENT_KEY],
    [
      'a const alias of the returned client',
      `function admin() {\n  const db = ${secret};\n  return db;\n}\n`,
      SERVICE,
    ],
    [
      'a null return for a missing URL',
      `function admin() {\n  if (!process.env.URL) return null;\n  if (!process.env.KEY) return undefined;\n  return ${secret};\n}\n`,
      SERVICE,
    ],
    [
      'two returns of the same class',
      `function admin(x: boolean) {\n  if (x) return ${secret};\n  return createClient(${URL_ARG}, 'sb_secret_test');\n}\n`,
      SERVICE,
    ],
    [
      'returns of nested functions, which are ignored',
      `function admin() {\n  const other = () => { return ${anon}; };\n  void other;\n  return ${secret};\n}\n`,
      SERVICE,
    ],
    [
      'a lazy singleton in a module-level let',
      `let cached: ReturnType<typeof createClient> | null = null;\nfunction admin() {\n  if (cached) return cached;\n  cached = ${secret};\n  return cached;\n}\n`,
      SERVICE,
    ],
    [
      'a lazy singleton assigned with ??=',
      `let cached: ReturnType<typeof createClient> | undefined;\nfunction admin() {\n  return (cached ??= ${anon});\n}\n`,
      CLIENT_KEY,
    ],
    [
      'three factories deep',
      `function a() { return ${secret}; }\nfunction b() { return a(); }\nfunction admin() { return b(); }\n`,
      SERVICE,
    ],
  ])('decides by %s', (_, factory, expected) => {
    expect(only(head + factory + call('admin'))).toEqual(expected);
  });

  it.each([
    ['a conditional return', `function admin(x: boolean) {\n  return x ? null : ${secret};\n}\n`],
    [
      'returns of different classes',
      `function admin(x: boolean) {\n  if (x) return ${anon};\n  return ${secret};\n}\n`,
    ],
    [
      'an unclassified key',
      `function admin() {\n  return createClient(${URL_ARG}, process.env.KEY!);\n}\n`,
    ],
    [
      'an untraceable return',
      `function admin(db: ReturnType<typeof createClient>) {\n  return db;\n}\n`,
    ],
    [
      'only null returns',
      `function admin(): ReturnType<typeof createClient> {\n  return null!;\n}\n`,
    ],
    [
      'four factories deep',
      `function a() { return ${secret}; }\nfunction b() { return a(); }\nfunction c() { return b(); }\nfunction admin() { return c(); }\n`,
    ],
    [
      'recursion',
      `function admin(n: number): ReturnType<typeof createClient> {\n  if (n > 0) return admin(n - 1);\n  return ${secret};\n}\n`,
    ],
    [
      'a function-scoped let',
      `function admin() {\n  let db = ${anon};\n  db = ${secret};\n  return db;\n}\n`,
    ],
    [
      'a singleton with an unclassified assignment',
      `let cached = ${secret};\nfunction admin() {\n  cached = createClient(${URL_ARG}, process.env.KEY!);\n  return cached;\n}\n`,
    ],
    ['a declared function', 'declare function admin(): ReturnType<typeof createClient>;\n'],
  ])('falls back to step 4 on %s', (_, factory) => {
    expect(only(head + factory + call('admin'))).toEqual(UNKNOWN);
  });

  it('ignores a bare return and assignments to other targets', () => {
    const code =
      `${head}let cached: ReturnType<typeof createClient> | undefined;\n` +
      'let other = 0;\nconst box = { n: 0 };\nother = 1;\nbox.n = 2;\n' +
      `function admin() {\n  if (!process.env.URL) return;\n  return (cached ||= ${secret});\n}\n` +
      "void admin()!.from('todos').select();\n";
    expect(only(code)).toEqual(SERVICE);
  });

  it('step 5: skips new of an undeclared class', () => {
    const code = `${CLIENT}void (new Undeclared() as SupabaseClient).from('todos').select();\n`;
    expect(only(code)).toEqual(NO_CLIENT);
  });

  it('follows an awaited async factory that awaits its client', () => {
    const code =
      `${head}const admin = async () => await ${secret};\n` +
      "async function list() {\n  const db = await admin();\n  return db.from('todos').select();\n}\nvoid list;\n";
    expect(only(code)).toEqual(SERVICE);
  });

  it('caches per factory and still lets settings win', () => {
    const code = `${head}function admin() {\n  return ${secret};\n}\n${call('admin')}${call('admin')}`;
    expect(resolveAll(code).map(rolesOnly)).toEqual([SERVICE, SERVICE]);
    const settings = { clients: [{ callee: 'admin', role: 'anon' }] };
    expect(resolveAll(code, settings).map(rolesOnly)).toEqual([mapped('anon'), mapped('anon')]);
  });
});

describe('§6.5 step 1: settings.supabase.clients', () => {
  const factory =
    "import { createAdminClient } from './admin';\nvoid createAdminClient().from('todos').select();\n";

  it('maps by callee, as called or as declared, and by method name', () => {
    const byCallee = { clients: [{ callee: 'createAdminClient', role: 'service_role' }] };
    expect(only(factory, byCallee)).toEqual(mapped('service_role'));
    const renamed =
      "import { createAdminClient as admin } from './admin';\nvoid admin().from('todos').select();\n";
    expect(only(renamed, byCallee)).toEqual(mapped('service_role'));
    const method =
      "import { Repo } from './admin';\nvoid new Repo().client().from('todos').select();\n";
    expect(only(method, { clients: [{ callee: 'client', role: 'authenticated' }] })).toEqual(
      mapped('authenticated'),
    );
    // makeClient re-exports supabase-js's createClient; settings win over the key.
    const reexport =
      "import { makeClient } from './clients';\n" +
      `void makeClient(${URL_ARG}, 'sb_secret_test').from('todos').select();\n`;
    expect(only(reexport, { clients: [{ callee: 'createClient', role: 'anon' }] })).toEqual(
      mapped('anon'),
    );
  });

  it('maps by the module that declares the factory or the client', () => {
    const admin = { clients: [{ module: './admin.ts', role: 'service_role' }] };
    expect(only(factory, admin)).toEqual(mapped('service_role'));
    const server =
      "import { createServerDb } from './admin';\n" +
      "async function list() {\n  const db = await createServerDb();\n  return db.from('todos').select();\n}\nvoid list;\n";
    expect(only(server, admin)).toEqual(mapped('service_role'));
    const here = { clients: [{ module: '*.ts', role: ['anon'] }] };
    expect(only(`${CLIENT}void supabase.from('todos').select();`, here)).toEqual(mapped('anon'));
    // adminDb is declared in admin.ts, so a mapping of file.ts does not apply to it.
    const imported = "import { adminDb } from './admin';\nvoid adminDb.from('todos').select();\n";
    expect(only(imported, { clients: [{ module: 'file.ts', role: 'anon' }] })).toEqual(SERVICE);
  });

  it('never matches the declarations in node_modules', () => {
    const vendor = { clients: [{ module: 'node_modules/**', role: 'service_role' }] };
    expect(only(`${CLIENT}void supabase.from('todos').select();`, vendor)).toEqual(CLIENT_KEY);
    const outside = { clients: [{ module: '../**', role: 'service_role' }] };
    expect(only(`${CLIENT}void supabase.from('todos').select();`, outside)).toEqual(CLIENT_KEY);
    // With the directory that holds node_modules as the project, supabase-js's declarations are
    // inside it (realpath: a test sandbox may link node_modules from elsewhere).
    const root = path.dirname(
      realpathSync(fileURLToPath(new URL('../../node_modules', import.meta.url))),
    );
    const found = resolveAll(`${CLIENT}void supabase.from('todos').select();`, vendor, root);
    expect(found.map(rolesOnly)).toEqual([CLIENT_KEY]);
  });

  it('takes the first matching entry', () => {
    const clients = [
      { callee: 'other', role: 'anon' },
      { callee: 'createAdminClient', role: ['anon', 'authenticated'] },
      { module: 'admin.ts', role: 'service_role' },
    ];
    expect(only(factory, { clients })).toEqual(mapped('anon', 'authenticated'));
  });

  it('falls through to the key when no entry matches untyped or unnamed factories', () => {
    const clients = { clients: [{ callee: 'nothing', role: 'service_role' }] };
    const code =
      `${CLIENT}declare const make: unknown;\n` +
      'declare const factories: (() => SupabaseClient)[];\n' +
      "void ((make as any)() as SupabaseClient).from('todos').select();\n" +
      "void factories[0]!().from('todos').select();\n" +
      "void (undeclaredFactory() as SupabaseClient).from('todos').select();\n";
    expect(resolveAll(code, clients).map(rolesOnly)).toEqual([UNKNOWN, UNKNOWN, UNKNOWN]);
    const undeclared = { clients: [{ callee: 'undeclaredFactory', role: 'anon' }] };
    expect(resolveAll(code, undeclared).map(rolesOnly)).toEqual([UNKNOWN, UNKNOWN, mapped('anon')]);
  });
});
