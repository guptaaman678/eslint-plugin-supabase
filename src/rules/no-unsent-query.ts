import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import type { RuleFix, RuleFixer } from '@typescript-eslint/utils/ts-eslint';
import { stats } from '../stats.js';
import { lazyBuilder, type BuilderKind } from '../supabase/types.js';
import { createRule } from '../util/create-rule.js';

export type MessageId = 'voidBuilder' | 'floatingBuilder' | 'suggestAwait' | 'suggestThen';

/** A lazy builder that is never sent (§6.6, ADR-006). */
export interface UnsentBuilder {
  readonly messageId: 'voidBuilder' | 'floatingBuilder';
  readonly kind: BuilderKind;
  /** The node the suggestions replace: the `void` expression, or the statement's expression. */
  readonly target: TSESTree.Expression;
  /** The builder expression itself. */
  readonly builder: TSESTree.Expression;
}

/**
 * The decision of the rule, given what a node's type is (`builderKind`, undefined when the
 * type is not one of the five lazy classes, §6.2): `void <builder>`, or a builder in statement
 * position. Every other position (`await`, `return`, assignment, argument, array or object
 * member, `.then()` and `.catch()` chains) sends the request or hands the builder on.
 */
export function findUnsentBuilder(
  node: TSESTree.UnaryExpression | TSESTree.ExpressionStatement,
  builderKind: (expression: TSESTree.Expression) => BuilderKind | undefined,
): UnsentBuilder | undefined {
  if (node.type === AST_NODE_TYPES.UnaryExpression) {
    if (node.operator !== 'void') return undefined;
    const kind = builderKind(node.argument);
    if (kind === undefined) return undefined;
    return { messageId: 'voidBuilder', kind, target: node, builder: node.argument };
  }
  const expression = node.expression;
  // `void x;` is reported as `void`; `x = builder;` hands the builder on.
  if (isVoid(expression) || expression.type === AST_NODE_TYPES.AssignmentExpression) {
    return undefined;
  }
  const kind = builderKind(expression);
  if (kind === undefined) return undefined;
  return { messageId: 'floatingBuilder', kind, target: expression, builder: expression };
}

function isVoid(expression: TSESTree.Expression): boolean {
  return expression.type === AST_NODE_TYPES.UnaryExpression && expression.operator === 'void';
}

/**
 * Whether `await` is allowed at `node`: the nearest enclosing function is async. A class
 * static block or field initializer starts a body where `await` is not allowed.
 */
export function insideAsyncFunction(node: TSESTree.Node): boolean {
  // ESLint sets `Program.parent` to null, not undefined.
  for (let current = node.parent; current != null; current = current.parent) {
    switch (current.type) {
      case AST_NODE_TYPES.FunctionDeclaration:
      case AST_NODE_TYPES.FunctionExpression:
      case AST_NODE_TYPES.ArrowFunctionExpression:
        return current.async;
      case AST_NODE_TYPES.StaticBlock:
      case AST_NODE_TYPES.PropertyDefinition:
        return false;
    }
  }
  return false;
}

/** Expressions that need no parentheses as the operand of `await` or before `.then()`. */
const TIGHT: ReadonlySet<AST_NODE_TYPES> = new Set([
  AST_NODE_TYPES.Identifier,
  AST_NODE_TYPES.MemberExpression,
  AST_NODE_TYPES.CallExpression,
  AST_NODE_TYPES.ChainExpression,
  AST_NODE_TYPES.TSNonNullExpression,
]);

const WHAT: Record<BuilderKind, string> = { query: 'query', download: 'storage download' };

export const noUnsentQuery = createRule<[], MessageId>({
  name: 'no-unsent-query',
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow `void` and unsent Supabase query builders',
      recommended: true,
      requiresTypeChecking: true,
    },
    hasSuggestions: true,
    messages: {
      voidBuilder:
        'This Supabase {{what}} is lazy, so `void` discards it before it is sent and the request never happens. Use `await`, or call `.then()` to send it without waiting.',
      floatingBuilder:
        'This Supabase {{what}} is lazy and is never awaited or `.then()`-ed, so the request is never sent. Use `await`, or call `.then()` to send it without waiting.',
      suggestAwait: 'Send it and wait for the result with `await`.',
      suggestThen: 'Send it without waiting with `.then()`.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();
    const sourceCode = context.sourceCode;
    stats.recordFile(context.filename);

    const builderKind = (expression: TSESTree.Expression): BuilderKind | undefined =>
      lazyBuilder(checker, services.getTypeAtLocation(expression))?.kind;

    function operand(builder: TSESTree.Expression): string {
      const text = sourceCode.getText(builder);
      return TIGHT.has(builder.type) ? text : `(${text})`;
    }

    function check(node: TSESTree.UnaryExpression | TSESTree.ExpressionStatement): void {
      const found = findUnsentBuilder(node, builderKind);
      if (found === undefined) return;
      const { target, builder } = found;
      const thenFix = (fixer: RuleFixer): RuleFix =>
        fixer.replaceText(target, `void ${operand(builder)}.then()`);
      const awaitFix = (fixer: RuleFixer): RuleFix =>
        fixer.replaceText(target, `await ${operand(builder)}`);
      context.report({
        node: target,
        messageId: found.messageId,
        data: { what: WHAT[found.kind] },
        suggest: [
          ...(insideAsyncFunction(target)
            ? [{ messageId: 'suggestAwait' as const, fix: awaitFix }]
            : []),
          { messageId: 'suggestThen', fix: thenFix },
        ],
      });
    }

    return { UnaryExpression: check, ExpressionStatement: check };
  },
});
