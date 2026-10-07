import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  findProperty,
  MAX_LITERAL_UNION,
  resolveExpression,
  resolveObject,
  stringValues,
} from '../../src/supabase/literals.js';
import { collect } from '../harness/analyze.js';

/** For every `const probe_<name> = <init>`, what `inspect` makes of the initializer's TS node. */
function probes<T>(
  code: string,
  inspect: (init: ts.Expression, checker: ts.TypeChecker) => T,
): Record<string, T> {
  const entries = collect<TSESTree.VariableDeclarator, [string, T]>(
    code,
    AST_NODE_TYPES.VariableDeclarator,
    (node, { checker, tsNode }) => {
      if (node.id.type !== AST_NODE_TYPES.Identifier || !node.id.name.startsWith('probe_')) {
        return undefined;
      }
      const declaration = tsNode(node) as ts.VariableDeclaration;
      return [node.id.name.slice('probe_'.length), inspect(declaration.initializer!, checker)];
    },
  );
  return Object.fromEntries(entries);
}

describe('stringValues', () => {
  it('reads literals, template literals and literal types; at most five union members', () => {
    expect(MAX_LITERAL_UNION).toBe(5);
    const found = probes(
      [
        "declare const one: 'todos';",
        "declare const five: 'a' | 'b' | 'c' | 'd' | 'e';",
        "declare const six: 'a' | 'b' | 'c' | 'd' | 'e' | 'f';",
        'declare const text: string;',
        "declare const mixed: 'a' | 1;",
        "const probe_literal = 'todos';",
        'const probe_template = `orders`;',
        'const probe_interpolated = `${text}s`;',
        'const probe_one = one;',
        'const probe_five = five;',
        'const probe_six = six;',
        'const probe_string = text;',
        'const probe_mixed = mixed;',
      ].join('\n'),
      (init, checker) => stringValues(checker, init) ?? null,
    );
    expect(found).toEqual({
      literal: ['todos'],
      template: ['orders'],
      interpolated: null,
      one: ['todos'],
      five: ['a', 'b', 'c', 'd', 'e'],
      six: null,
      string: null,
      mixed: null,
    });
  });
});

describe('resolveExpression', () => {
  it('strips wrappers and follows const declarations and imports', () => {
    const found = probes(
      [
        "import { tableName } from './clients';",
        "const base = 'x';",
        'const alias = base;',
        'let mutable = 1;',
        'declare const declared: number;',
        'function f(param: number) { const probe_param = param; return probe_param; }',
        'const probe_wrapped = ((alias as string)! satisfies string);',
        'const probe_imported = tableName;',
        'const probe_mutable = mutable;',
        'const probe_declared = declared;',
        '// @ts-expect-error: not declared',
        'const probe_missing = missing;',
        'const probe_undefined = undefined;',
        'const probe_call = f(1);',
      ].join('\n'),
      (init, checker) => resolveExpression(checker, init).getText(),
    );
    expect(found).toEqual({
      param: 'param',
      wrapped: "'x'",
      imported: "'scores'",
      mutable: 'mutable',
      declared: 'declared',
      missing: 'missing',
      undefined: 'undefined',
      call: 'f(1)',
    });
  });

  it('gives up on a const cycle', () => {
    const found = probes(
      [
        '// @ts-expect-error: used before its declaration',
        'const a: number = b;',
        'const b: number = a;',
        'const probe_cycle = a;',
      ].join('\n'),
      (init, checker) => ts.isIdentifier(resolveExpression(checker, init)),
    );
    expect(found).toEqual({ cycle: true });
  });
});

describe('findProperty and resolveObject', () => {
  it('finds the last assignment and treats spreads, computed keys and methods as unknown', () => {
    const found = probes(
      [
        'declare const rest: object;',
        'declare const key: string;',
        'const db = 1;',
        'const OBJECT = { db: 2 };',
        'const probe_plain = { db: 1 };',
        "const probe_quoted = { 'db': 1 };",
        'const probe_shorthand = { db };',
        'const probe_absent = { other: 1, 2: 3 };',
        'const probe_spreadBefore = { ...rest, db: 1 };',
        'const probe_spreadAfter = { db: 1, ...rest };',
        'const probe_computed = { [key]: 1 };',
        'const probe_method = { db() { return 1; } };',
        'const probe_getter = { get db() { return 1; } };',
        'const probe_twice = { db: 1, other: 0, db2: 0, ...{}, db: 2 } as object;',
        'const probe_aliased = OBJECT;',
        'const probe_notObject = rest;',
      ].join('\n'),
      (init, checker) => {
        const object = resolveObject(checker, init);
        if (object === undefined) return 'not an object';
        const lookup = findProperty(object, 'db');
        if ('found' in lookup) return lookup.found.getText();
        return 'absent' in lookup ? 'absent' : 'unknown';
      },
    );
    expect(found).toEqual({
      plain: '1',
      quoted: '1',
      shorthand: 'db',
      absent: 'absent',
      spreadBefore: '1',
      spreadAfter: 'unknown',
      computed: 'unknown',
      method: 'unknown',
      getter: 'unknown',
      twice: '2',
      aliased: '2',
      notObject: 'not an object',
    });
  });
});
