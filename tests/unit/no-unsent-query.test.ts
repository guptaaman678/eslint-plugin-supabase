import { parse } from '@typescript-eslint/parser';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import { describe, expect, it } from 'vitest';
import { findUnsentBuilder, insideAsyncFunction } from '../../src/rules/no-unsent-query.js';
import type { BuilderKind } from '../../src/supabase/types.js';

/** The nodes directly below `node`. */
function children(node: TSESTree.Node): TSESTree.Node[] {
  return Object.entries(node)
    .filter(([key]) => key !== 'parent')
    .flatMap(([, value]: [string, unknown]): unknown[] => (Array.isArray(value) ? value : [value]))
    .filter(
      (child): child is TSESTree.Node =>
        typeof child === 'object' && child !== null && 'type' in child,
    );
}

/** `node` and every node below it, in source order. */
function* nodes(node: TSESTree.Node): Generator<TSESTree.Node> {
  yield node;
  for (const child of children(node)) yield* nodes(child);
}

/** Parses `code` and sets `parent` on every node, as ESLint does. */
function program(code: string): TSESTree.Program {
  const ast = parse(code, { range: true }) as TSESTree.Program;
  for (const node of nodes(ast)) {
    for (const child of children(node)) (child as { parent?: TSESTree.Node }).parent = node;
  }
  return ast;
}

function statement(code: string): TSESTree.ExpressionStatement {
  const [first] = program(code).body;
  if (first?.type !== AST_NODE_TYPES.ExpressionStatement)
    throw new Error(`not a statement: ${code}`);
  return first;
}

function unary(code: string): TSESTree.UnaryExpression {
  const { expression } = statement(code);
  if (expression.type !== AST_NODE_TYPES.UnaryExpression) throw new Error(`not unary: ${code}`);
  return expression;
}

/** Fake types: `q` is a query builder, `d` a storage download, anything else is not lazy. */
function byName(expression: TSESTree.Expression): BuilderKind | undefined {
  if (expression.type !== AST_NODE_TYPES.Identifier) return undefined;
  return ({ q: 'query', d: 'download' } as Record<string, BuilderKind>)[expression.name];
}

/** Fake types: every expression is a query builder. */
const everything = (): BuilderKind => 'query';

describe('findUnsentBuilder', () => {
  it('reports `void` on a builder, with what it sends', () => {
    const node = unary('void q;');
    expect(findUnsentBuilder(node, byName)).toEqual({
      messageId: 'voidBuilder',
      kind: 'query',
      target: node,
      builder: node.argument,
    });
    expect(findUnsentBuilder(unary('void d;'), byName)?.kind).toBe('download');
  });

  it('leaves `void` on anything else, and other unary operators, alone', () => {
    expect(findUnsentBuilder(unary('void other;'), byName)).toBeUndefined();
    expect(findUnsentBuilder(unary('-q;'), everything)).toBeUndefined();
    expect(findUnsentBuilder(unary('typeof q;'), everything)).toBeUndefined();
  });

  it('reports a builder in statement position', () => {
    const node = statement('q;');
    expect(findUnsentBuilder(node, byName)).toEqual({
      messageId: 'floatingBuilder',
      kind: 'query',
      target: node.expression,
      builder: node.expression,
    });
    expect(findUnsentBuilder(statement('d;'), byName)?.kind).toBe('download');
  });

  it('leaves statements that are not builders alone', () => {
    expect(findUnsentBuilder(statement('other;'), byName)).toBeUndefined();
  });

  it('never reports a `void` statement twice, nor an assignment, whatever the types say', () => {
    expect(findUnsentBuilder(statement('void q;'), everything)).toBeUndefined();
    expect(findUnsentBuilder(statement('x = q;'), everything)).toBeUndefined();
    expect(findUnsentBuilder(statement('x ??= q;'), everything)).toBeUndefined();
  });
});

describe('insideAsyncFunction', () => {
  /** The first identifier `a` in `code`. */
  function a(code: string): TSESTree.Node {
    for (const node of nodes(program(code))) {
      if (node.type === AST_NODE_TYPES.Identifier && node.name === 'a') return node;
    }
    throw new Error(`no identifier a: ${code}`);
  }

  it.each([
    ['async function f() { a; }', true],
    ['const f = async () => { a; };', true],
    ['const f = async function () { a; };', true],
    ['async function* g() { a; }', true],
    ['a;', false],
    ['function f() { a; }', false],
    ['async function f() { return () => { a; }; }', false],
    ['async function f() { class C { static { a; } } }', false],
    ['async function f() { class C { x = a; } }', false],
    ['async function f() { class C { async m() { a; } } }', true],
  ])('%s -> %s', (code, expected) => {
    expect(insideAsyncFunction(a(code))).toBe(expected);
  });
});
