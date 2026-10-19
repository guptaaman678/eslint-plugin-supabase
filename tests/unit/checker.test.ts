import path from 'node:path';
import parser from '@typescript-eslint/parser';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import { Linter } from 'eslint';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import plugin from '../../src/index.js';
import { analyzeCall } from '../../src/supabase/calls.js';
import { checkerTypeAt } from '../../src/supabase/checker.js';
import { CLIENT, collect } from '../harness/analyze.js';
import { TS_FIXTURE_DIR } from '../harness/rule-tester.js';

/**
 * What TypeScript 6.0.3 throws from `getTypeAtLocation` when its module-specifier code runs with
 * no current directory (`normalizeSlashes` < `getNormalizedAbsolutePath` <
 * `getLocalModuleSpecifier`), as the corpus job saw on ubuntu.
 */
const CRASH = "Cannot read properties of undefined (reading 'includes')";

/** Makes `checker.getTypeAtLocation` throw for the nodes whose text is in `texts`. */
function crashOn(checker: ts.TypeChecker, texts: readonly string[]): () => void {
  const original = checker.getTypeAtLocation.bind(checker);
  checker.getTypeAtLocation = (node) => {
    if (texts.includes(node.getText())) throw new TypeError(CRASH);
    return original(node);
  };
  return () => {
    checker.getTypeAtLocation = original;
  };
}

const FILE = path.join(TS_FIXTURE_DIR, 'file.ts');

/** A program over the typed fixture project in which `file.ts` reads `code`. */
function programWith(code: string): ts.Program {
  const config = ts.readConfigFile(path.join(TS_FIXTURE_DIR, 'tsconfig.json'), (name) =>
    ts.sys.readFile(name),
  );
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, TS_FIXTURE_DIR);
  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  host.readFile = (name) => (path.resolve(name) === FILE ? code : readFile(name));
  return ts.createProgram([FILE], options, host);
}

/** Lints `code` with one rule of the plugin while the checker throws for `texts`. */
function lint(rule: string, code: string, texts: readonly string[]): Linter.LintMessage[] {
  const program = programWith(code);
  crashOn(program.getTypeChecker(), texts);
  return new Linter({ configType: 'flat' }).verify(
    code,
    [
      {
        files: ['**/*.ts'],
        languageOptions: { parser, parserOptions: { programs: [program] } },
        plugins: { supabase: plugin },
        rules: { [`supabase/${rule}`]: 'error' },
      },
    ],
    FILE,
  );
}

const ids = (messages: Linter.LintMessage[]): unknown[] =>
  messages.map((message) =>
    message.fatal === true ? message.message : [message.line, message.messageId],
  );

describe('checkerTypeAt', () => {
  it("returns the checker's type", () => {
    const program = programWith('export const x = 1;\n');
    const checker = program.getTypeChecker();
    const node = program.getSourceFile(FILE)!.statements[0]!;
    expect(checkerTypeAt(checker, node)).toBe(checker.getTypeAtLocation(node));
  });

  it('returns undefined when the checker throws', () => {
    const program = programWith('export const x = 1;\n');
    const checker = program.getTypeChecker();
    crashOn(checker, ['export const x = 1;']);
    expect(checkerTypeAt(checker, program.getSourceFile(FILE)!.statements[0]!)).toBeUndefined();
  });
});

describe('a checker crash on one expression skips that expression, not the file', () => {
  it('no-unsent-query reports the other builders', () => {
    const code = `${CLIENT}supabase.from('todos').select();\nsupabase.from('orders').select();\n`;
    expect(ids(lint('no-unsent-query', code, []))).toEqual([
      [3, 'floatingBuilder'],
      [4, 'floatingBuilder'],
    ]);
    expect(ids(lint('no-unsent-query', code, ["supabase.from('orders').select()"]))).toEqual([
      [3, 'floatingBuilder'],
    ]);
  });

  it('no-unsent-query: a refinement of a variable it cannot type is not reported', () => {
    const code = `${CLIENT}const q = supabase.from('todos').select();\nq.eq('id', 1);\nsupabase.from('orders').select().eq('id', 1);\n`;
    expect(ids(lint('no-unsent-query', code, []))).toEqual([[5, 'floatingBuilder']]);
    expect(ids(lint('no-unsent-query', code, ['q']))).toEqual([[5, 'floatingBuilder']]);
  });

  it('subscribe-status-handler skips a channel it cannot type', () => {
    const code = `${CLIENT}supabase.channel('a').subscribe();\nsupabase.channel('b').subscribe();\n`;
    expect(ids(lint('subscribe-status-handler', code, []))).toEqual([
      [3, 'noStatusCallback'],
      [4, 'noStatusCallback'],
    ]);
    expect(ids(lint('subscribe-status-handler', code, ["supabase.channel('b')"]))).toEqual([
      [3, 'noStatusCallback'],
    ]);
  });

  it('subscribe-status-handler skips a callback it cannot type', () => {
    const code = `${CLIENT}const cb = () => {};\nsupabase.channel('a').subscribe(cb);\n`;
    expect(ids(lint('subscribe-status-handler', code, []))).toEqual([[4, 'noStatusCallback']]);
    expect(ids(lint('subscribe-status-handler', code, ['cb']))).toEqual([]);
  });

  /** `analyzeCall` on every call of `code` while the checker throws for `texts`. */
  function analyzed(code: string, texts: readonly string[]): unknown[] {
    return collect<TSESTree.CallExpression, unknown>(
      code,
      AST_NODE_TYPES.CallExpression,
      (node, { services, checker, text }) => {
        const restore = crashOn(checker, texts);
        try {
          const call = analyzeCall(services, node);
          return (
            call && {
              text: text(node),
              skip: call.skip,
              tables: call.kind === 'table' ? call.tables : undefined,
            }
          );
        } finally {
          restore();
        }
      },
    );
  }

  it('analyzeCall skips a receiver it cannot type', () => {
    const code = `${CLIENT}void supabase.from('todos').select();\n`;
    expect(analyzed(code, [])).toEqual([
      { text: "supabase.from('todos')", skip: undefined, tables: ['todos'] },
    ]);
    expect(analyzed(code, ['supabase'])).toEqual([]);
  });

  it('analyzeCall counts a table name it cannot type as dynamic', () => {
    const code = `${CLIENT}declare const t: 'todos' | 'orders';\nvoid supabase.from(t).select();\n`;
    expect(analyzed(code, [])).toEqual([
      { text: 'supabase.from(t)', skip: undefined, tables: ['todos', 'orders'] },
    ]);
    expect(analyzed(code, ['t'])).toEqual([
      { text: 'supabase.from(t)', skip: 'dynamic-table', tables: [] },
    ]);
  });
});
