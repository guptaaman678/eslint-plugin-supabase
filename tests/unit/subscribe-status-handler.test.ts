import { parse } from '@typescript-eslint/parser';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import { describe, expect, it } from 'vitest';
import {
  functionNames,
  insideWrapper,
  lacksStatusCallback,
  type ParameterCount,
} from '../../src/rules/subscribe-status-handler.js';

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

/** Parses `code` and sets `parent` on every node, as ESLint does (`Program.parent` is null). */
function program(code: string): TSESTree.Program {
  const ast = parse(code, { range: true }) as TSESTree.Program;
  (ast as { parent?: TSESTree.Node | null }).parent = null;
  for (const node of nodes(ast)) {
    for (const child of children(node)) (child as { parent?: TSESTree.Node }).parent = node;
  }
  return ast;
}

/** Every `x.subscribe(...)` call in `code`, in source order. */
function subscribeCalls(code: string): TSESTree.CallExpression[] {
  return [...nodes(program(code))].filter(
    (node): node is TSESTree.CallExpression =>
      node.type === AST_NODE_TYPES.CallExpression &&
      node.callee.type === AST_NODE_TYPES.MemberExpression &&
      node.callee.property.type === AST_NODE_TYPES.Identifier &&
      node.callee.property.name === 'subscribe',
  );
}

function onlyCall(code: string): TSESTree.CallExpression {
  const [call] = subscribeCalls(code);
  if (call === undefined) throw new Error(`no subscribe call: ${code}`);
  return call;
}

/** The first function node in `code`. */
function firstFunction(code: string): TSESTree.Node {
  const found = [...nodes(program(code))].find(
    (node) =>
      node.type === AST_NODE_TYPES.FunctionDeclaration ||
      node.type === AST_NODE_TYPES.FunctionExpression ||
      node.type === AST_NODE_TYPES.ArrowFunctionExpression,
  );
  if (found === undefined) throw new Error(`no function: ${code}`);
  return found;
}

/** Fake types: `withStatus` declares one parameter, `noParams` none, `nothing` is undefined. */
const byName: ParameterCount = (expression) => {
  if (expression.type === AST_NODE_TYPES.ArrowFunctionExpression) return expression.params.length;
  if (expression.type !== AST_NODE_TYPES.Identifier) return undefined;
  return ({ withStatus: 1, noParams: 0, nothing: 0 } as Record<string, number>)[expression.name];
};

const NONE: ReadonlySet<string> = new Set();

describe('lacksStatusCallback', () => {
  it('reports a call with no callback', () => {
    expect(lacksStatusCallback(onlyCall('ch.subscribe();'), byName, NONE)).toBe(true);
  });

  it('reports a callback that declares no parameters, or is undefined', () => {
    expect(lacksStatusCallback(onlyCall('ch.subscribe(noParams);'), byName, NONE)).toBe(true);
    expect(lacksStatusCallback(onlyCall('ch.subscribe(() => 1, 500);'), byName, NONE)).toBe(true);
    expect(lacksStatusCallback(onlyCall('ch.subscribe(nothing, 500);'), byName, NONE)).toBe(true);
  });

  it('accepts a callback with a parameter', () => {
    expect(lacksStatusCallback(onlyCall('ch.subscribe(withStatus);'), byName, NONE)).toBe(false);
    expect(lacksStatusCallback(onlyCall('ch.subscribe((s) => s);'), byName, NONE)).toBe(false);
  });

  it('accepts what it cannot tell: an unknown type or a spread', () => {
    expect(lacksStatusCallback(onlyCall('ch.subscribe(other);'), byName, NONE)).toBe(false);
    expect(lacksStatusCallback(onlyCall('ch.subscribe(...args);'), () => 0, NONE)).toBe(false);
  });

  it('accepts a call inside a wrapper, and only there', () => {
    const [inside, outside] = subscribeCalls(
      'function joinSafely() { ch.subscribe(); }\nch.subscribe();',
    );
    const wrappers = new Set(['joinSafely']);
    expect(lacksStatusCallback(inside!, byName, wrappers)).toBe(false);
    expect(lacksStatusCallback(outside!, byName, wrappers)).toBe(true);
  });
});

describe('insideWrapper', () => {
  it('finds a wrapper at any depth', () => {
    const call = onlyCall(
      'const joinSafely = (ch) => new Promise((resolve) => { [1].forEach(() => resolve(ch.subscribe())); });',
    );
    expect(insideWrapper(call, new Set(['joinSafely']))).toBe(true);
    expect(insideWrapper(call, new Set(['resolve']))).toBe(false);
  });

  it('is false with no wrappers or at the top level', () => {
    expect(insideWrapper(onlyCall('function a() { ch.subscribe(); }'), NONE)).toBe(false);
    expect(insideWrapper(onlyCall('ch.subscribe();'), new Set(['a']))).toBe(false);
  });
});

describe('functionNames', () => {
  it.each([
    ['function join() {}', ['join']],
    ['export default function () {}', []],
    ['const join = () => 1;', ['join']],
    ['const join = function joinRoom() {};', ['joinRoom', 'join']],
    ['const { join } = function () {};', []],
    ['const o = { join() {} };', ['join']],
    ["const o = { 'join-room': () => 1 };", ['join-room']],
    ['const o = { 1: () => 1 };', []],
    ['const o = { [key]: () => 1 };', []],
    ['class A { join() {} }', ['join']],
    ['class A { #join() {} }', []],
    ['class A { join = () => 1; }', ['join']],
    ['class A { [key] = () => 1; }', []],
    ['join = () => 1;', ['join']],
    ['helpers.join = () => 1;', ['join']],
    ['class A { #join; static { new A().#join = () => 1; } }', []],
    ['helpers[key] = () => 1;', []],
    ['[() => 1];', []],
    ['run(() => 1);', []],
  ])('%s -> %j', (code, names) => {
    expect(functionNames(firstFunction(code))).toEqual(names);
  });

  it('is empty for a node that is not a function', () => {
    expect(functionNames(program('const join = 1;').body[0]!)).toEqual([]);
  });
});
