import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_BUILDERS,
  findClass,
  isFilterMethod,
  isRefinementMethod,
  isPackageFile,
  isQueryReceiver,
  isRealtimeChannel,
  isSupabaseClient,
  isSupabaseFile,
  LAZY_BUILDERS,
  lazyBuilder,
  QUERY_BUILDERS,
  type SupabaseClass,
} from '../../src/supabase/types.js';
import { CLIENT, collect } from '../harness/analyze.js';

interface Probe {
  /** The matched class name, or null. */
  readonly cls: string | null;
  readonly kind?: string;
  /** How TypeScript sees the type: `union`, `intersection` or the symbol's own name. */
  readonly shape: string;
}

/** For every `const` in `code`, the class of `classes` its type matches. */
function probe(code: string, classes: readonly SupabaseClass[] = LAZY_BUILDERS) {
  const entries = collect<TSESTree.VariableDeclarator, [string, Probe]>(
    code,
    AST_NODE_TYPES.VariableDeclarator,
    (node, { services, checker }) => {
      if (node.id.type !== AST_NODE_TYPES.Identifier) return undefined;
      const type = services.getTypeAtLocation(node.id);
      const shape = type.isUnion()
        ? 'union'
        : type.isIntersection()
          ? 'intersection'
          : (type.getSymbol()?.getName() ?? '-');
      const cls = findClass(checker, type, classes)?.name ?? null;
      const builder = classes === LAZY_BUILDERS ? lazyBuilder(checker, type) : undefined;
      return [node.id.name, { cls, shape, ...(builder ? { kind: builder.kind } : {}) }];
    },
  );
  return Object.fromEntries(entries);
}

describe('lazy builders on supabase-js 2.117', () => {
  const found = probe(
    CLIENT +
      [
        "const fromOnly = supabase.from('todos');",
        "const select = supabase.from('todos').select();",
        "const single = supabase.from('todos').select().single();",
        "const returns = supabase.from('todos').select().returns<{ id: number }[]>();",
        "const rpc = supabase.rpc('add_score');",
        "const thrown = supabase.from('todos').select().throwOnError();",
        "const download = supabase.storage.from('avatars').download('a.png');",
        "const stream = supabase.storage.from('avatars').download('a.png').asStream();",
        "const upload = supabase.storage.from('avatars').upload('a.png', new Blob());",
        "const invoke = supabase.functions.invoke('hello');",
        'const user = supabase.auth.getUser();',
        "const channel = supabase.channel('room');",
        "const maybe = Math.random() > 0.5 ? supabase.from('todos').delete() : undefined;",
        "const sent = supabase.from('todos').select().then((r) => r.data);",
        'const n = 1;',
      ].join('\n'),
  );

  it('names the most derived lazy class, through base types', () => {
    expect(found.select).toEqual({
      cls: 'PostgrestFilterBuilder',
      kind: 'query',
      shape: 'PostgrestFilterBuilder',
    });
    expect(found.single).toMatchObject({ cls: 'PostgrestBuilder', kind: 'query' });
    expect(found.returns).toMatchObject({ cls: 'PostgrestTransformBuilder', kind: 'query' });
    expect(found.rpc).toMatchObject({ cls: 'PostgrestFilterBuilder', kind: 'query' });
    expect(found.thrown).toMatchObject({ cls: 'PostgrestFilterBuilder', kind: 'query' });
  });

  it('finds both storage download builders', () => {
    expect(found.download).toEqual({
      cls: 'BlobDownloadBuilder',
      kind: 'download',
      shape: 'BlobDownloadBuilder',
    });
    expect(found.stream).toMatchObject({ cls: 'StreamDownloadBuilder', kind: 'download' });
  });

  it('finds a builder inside a union', () => {
    expect(found.maybe).toEqual({ cls: 'PostgrestFilterBuilder', kind: 'query', shape: 'union' });
  });

  it('does not match eager calls, sent queries or non-builders', () => {
    for (const name of ['fromOnly', 'upload', 'invoke', 'user', 'channel', 'sent', 'n']) {
      expect(found[name], name).toMatchObject({ cls: null });
      expect(found[name], name).not.toHaveProperty('kind');
    }
  });

  it('matches RealtimeChannel, a default-export class whose symbol is named "default"', () => {
    const channel = probe(CLIENT + "const channel = supabase.channel('room');", [
      { pkg: 'realtime-js', name: 'RealtimeChannel' },
    ]);
    expect(channel.channel).toEqual({ cls: 'RealtimeChannel', shape: 'default' });
  });
});

describe('lazy builders on supabase-js 2.58.0 (pre-2.88 declaration layout)', () => {
  const found = probe(
    [
      "import { createClient } from 'supabase-js-2-58';",
      "const old = createClient('http://localhost:54321', 'key');",
      "const select = old.from('todos').select();",
      "const thrown = old.from('todos').select().throwOnError();",
      "const download = old.storage.from('avatars').download('a.png');",
      "const upload = old.storage.from('avatars').upload('a.png', new Blob());",
    ].join('\n'),
  );

  it('matches default-export classes by their declaration name', () => {
    expect(found.select).toEqual({
      cls: 'PostgrestFilterBuilder',
      kind: 'query',
      shape: 'default',
    });
    expect(found.download).toEqual({
      cls: 'BlobDownloadBuilder',
      kind: 'download',
      shape: 'default',
    });
    expect(found.upload).toMatchObject({ cls: null });
  });

  it('walks the intersection that .throwOnError() returns', () => {
    expect(found.thrown).toEqual({
      cls: 'PostgrestFilterBuilder',
      kind: 'query',
      shape: 'intersection',
    });
  });

  it('does not take the aliased package for supabase-js itself', () => {
    // The alias directory is not node_modules/@supabase/supabase-js, so the path rule rejects it.
    const old = probe(
      "import { createClient } from 'supabase-js-2-58';\nconst old = createClient('u', 'k');",
      [{ pkg: 'supabase-js', name: 'SupabaseClient' }],
    );
    expect(old.old).toEqual({ cls: null, shape: 'default' });
  });
});

describe('classes declared outside @supabase packages', () => {
  it('ignores a local class, interface or object type with a Supabase class name', () => {
    const found = probe(
      [
        'class PostgrestBuilder {}',
        'interface PostgrestFilterBuilder { then(): void }',
        'declare const iface: PostgrestFilterBuilder;',
        'const local = new PostgrestBuilder();',
        'const object = { then() {} };',
        'class Base {}',
        'class Derived extends Base {}',
        'const derived = new Derived();',
        'declare const both: { a: 1 } & { b: 2 };',
      ].join('\n'),
    );
    expect(found).toMatchObject({
      iface: { cls: null },
      local: { cls: null },
      object: { cls: null },
      derived: { cls: null },
      both: { cls: null, shape: 'intersection' },
    });
  });
});

describe('client, receiver and channel predicates', () => {
  const found = collect<TSESTree.VariableDeclarator, [string, boolean[]]>(
    CLIENT +
      [
        'class MyClient extends SupabaseClient {}',
        "const mine = new MyClient('http://localhost:54321', 'key');",
        'const client = supabase;',
        "const scoped = supabase.schema('audit');",
        "const channel = supabase.channel('room');",
        "const builder = supabase.from('todos').select();",
      ].join('\n'),
    AST_NODE_TYPES.VariableDeclarator,
    (node, { services, checker }) => {
      if (node.id.type !== AST_NODE_TYPES.Identifier) return undefined;
      const type = services.getTypeAtLocation(node.id);
      return [
        node.id.name,
        [
          isSupabaseClient(checker, type),
          isQueryReceiver(checker, type),
          isRealtimeChannel(checker, type),
        ],
      ];
    },
  );
  const byName = Object.fromEntries(found);

  it('tells clients, PostgrestClient receivers, channels and builders apart', () => {
    expect(byName).toEqual({
      supabase: [true, true, false],
      mine: [true, true, false],
      client: [true, true, false],
      scoped: [false, true, false],
      channel: [false, false, true],
      builder: [false, false, false],
    });
  });
});

describe('isPackageFile and isSupabaseFile', () => {
  it('matches npm, pnpm and Windows layouts', () => {
    const npm = '/app/node_modules/@supabase/postgrest-js/dist/index.d.mts';
    const pnpm =
      '/app/node_modules/.pnpm/@supabase+postgrest-js@2.117.2/node_modules/@supabase/postgrest-js/dist/index.d.mts';
    const windows = 'C:\\app\\node_modules\\@supabase\\postgrest-js\\dist\\index.d.cts';
    for (const file of [npm, pnpm, windows]) {
      expect(isPackageFile(file, 'postgrest-js'), file).toBe(true);
      expect(isSupabaseFile(file), file).toBe(true);
    }
  });

  it('rejects other packages, look-alike names and files outside node_modules', () => {
    expect(isPackageFile('/app/node_modules/@supabase/postgrest-js/x.d.ts', 'storage-js')).toBe(
      false,
    );
    expect(
      isPackageFile('/app/node_modules/@supabase/postgrest-js-fork/x.d.ts', 'postgrest-js'),
    ).toBe(false);
    expect(isPackageFile('/app/src/@supabase/postgrest-js/x.d.ts', 'postgrest-js')).toBe(false);
    expect(isSupabaseFile('/app/node_modules/supabase-js-2-58/dist/index.d.ts')).toBe(false);
  });
});

describe('the lazy class list', () => {
  it('is the five classes of spec §6.2, query builders first', () => {
    expect(LAZY_BUILDERS.map((cls) => `${cls.pkg}:${cls.name}`)).toEqual([
      'postgrest-js:PostgrestFilterBuilder',
      'postgrest-js:PostgrestTransformBuilder',
      'postgrest-js:PostgrestBuilder',
      'storage-js:BlobDownloadBuilder',
      'storage-js:StreamDownloadBuilder',
    ]);
    expect(LAZY_BUILDERS).toEqual([...QUERY_BUILDERS, ...DOWNLOAD_BUILDERS]);
  });
});

describe('isFilterMethod', () => {
  it('is false for a missing symbol, throwOnError and a symbol without declarations', () => {
    expect(isFilterMethod(undefined)).toBe(false);
    const bare = { name: 'eq', declarations: undefined } as unknown as ts.Symbol;
    expect(isFilterMethod(bare)).toBe(false);
    const thrown = { name: 'throwOnError', declarations: [] } as unknown as ts.Symbol;
    expect(isFilterMethod(thrown)).toBe(false);
  });
});

describe('isRefinementMethod', () => {
  it('is false for a missing symbol, a retyping method and a symbol without declarations', () => {
    expect(isRefinementMethod(undefined)).toBe(false);
    const bare = { name: 'eq', declarations: undefined } as unknown as ts.Symbol;
    expect(isRefinementMethod(bare)).toBe(false);
    const csv = { name: 'csv', declarations: [] } as unknown as ts.Symbol;
    expect(isRefinementMethod(csv)).toBe(false);
  });

  it('is true only for the methods the two PostgREST builder classes declare', () => {
    const found = collect<TSESTree.MemberExpression, [string, boolean[]]>(
      CLIENT +
        [
          "const q = supabase.from('todos').select();",
          "void q.eq('id', 1).order('id').single();",
          'class Local {\n  eq() {\n    return this;\n  }\n}',
          'void new Local().eq();',
          'const literal = { eq: () => 1 };',
          'void literal.eq();',
        ].join('\n'),
      AST_NODE_TYPES.MemberExpression,
      (node, { checker, text, tsNode }) => {
        if (node.property.type !== AST_NODE_TYPES.Identifier) return undefined;
        const symbol = checker.getSymbolAtLocation(tsNode(node.property));
        return [text(node), [isRefinementMethod(symbol), isFilterMethod(symbol)]];
      },
    );
    expect(Object.fromEntries(found)).toEqual({
      "supabase.from('todos').select": [false, false],
      'supabase.from': [false, false],
      "q.eq('id', 1).order('id').single": [false, false],
      "q.eq('id', 1).order": [true, false],
      'q.eq': [true, true],
      'new Local().eq': [false, false],
      'literal.eq': [false, false],
    });
  });
});
