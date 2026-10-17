import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import ts from 'typescript';
import { stats } from '../stats.js';
import { typeAt } from '../supabase/checker.js';
import { isRealtimeChannel } from '../supabase/types.js';
import { createRule } from '../util/create-rule.js';

export type MessageId = 'noStatusCallback';

export interface Options {
  readonly allowWrappers: readonly string[];
}

/**
 * The most parameters any call signature of an expression's type declares (a rest parameter
 * counts as one); 0 for `undefined` and `null`; undefined when that cannot be told (`any`,
 * `unknown`, a value that is not a function).
 */
export type ParameterCount = (expression: TSESTree.Expression) => number | undefined;

/**
 * The decision of the rule for a `.subscribe(...)` call on a `RealtimeChannel` (§6.6): report
 * when there is no callback, or when the callback declares no parameters (so it cannot see the
 * status), unless the call is inside one of `wrappers`, project helpers that check the status.
 */
export function lacksStatusCallback(
  call: TSESTree.CallExpression,
  parameterCount: ParameterCount,
  wrappers: ReadonlySet<string>,
): boolean {
  const [callback] = call.arguments;
  if (callback?.type === AST_NODE_TYPES.SpreadElement) return false;
  if (callback !== undefined && parameterCount(callback) !== 0) return false;
  return !insideWrapper(call, wrappers);
}

/** Whether `node` is inside the body of a function named in `wrappers`, at any depth. */
export function insideWrapper(node: TSESTree.Node, wrappers: ReadonlySet<string>): boolean {
  if (wrappers.size === 0) return false;
  // ESLint sets `Program.parent` to null, not undefined.
  for (let current = node.parent; current != null; current = current.parent) {
    if (functionNames(current).some((name) => wrappers.has(name))) return true;
  }
  return false;
}

/**
 * The names a function is known by: its own name, and the name it is bound to as a variable,
 * an object or class member, or the target of an assignment. Empty for a node that is not a
 * function.
 */
export function functionNames(node: TSESTree.Node): string[] {
  if (
    node.type !== AST_NODE_TYPES.FunctionDeclaration &&
    node.type !== AST_NODE_TYPES.FunctionExpression &&
    node.type !== AST_NODE_TYPES.ArrowFunctionExpression
  ) {
    return [];
  }
  const names = node.id === null ? [] : [node.id.name];
  const binding = bindingName(node);
  return binding === undefined ? names : [...names, binding];
}

function bindingName(node: TSESTree.FunctionLike): string | undefined {
  const parent = node.parent;
  switch (parent?.type) {
    case AST_NODE_TYPES.VariableDeclarator:
      return parent.id.type === AST_NODE_TYPES.Identifier ? parent.id.name : undefined;
    case AST_NODE_TYPES.Property:
    case AST_NODE_TYPES.MethodDefinition:
    case AST_NODE_TYPES.PropertyDefinition:
      return parent.computed ? undefined : keyName(parent.key);
    case AST_NODE_TYPES.AssignmentExpression:
      return targetName(parent.left);
    default:
      return undefined;
  }
}

function keyName(key: TSESTree.Expression | TSESTree.PrivateIdentifier): string | undefined {
  if (key.type === AST_NODE_TYPES.Identifier) return key.name;
  if (key.type === AST_NODE_TYPES.Literal && typeof key.value === 'string') return key.value;
  return undefined;
}

function targetName(target: TSESTree.Expression): string | undefined {
  if (target.type === AST_NODE_TYPES.Identifier) return target.name;
  if (target.type === AST_NODE_TYPES.MemberExpression && !target.computed) {
    return keyName(target.property);
  }
  return undefined;
}

const NULLISH = ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void;

/** `ParameterCount` from the type checker. */
export function typeParameterCount(type: ts.Type): number | undefined {
  let most = 0;
  for (const part of type.isUnion() ? type.types : [type]) {
    if ((part.flags & NULLISH) !== 0) continue;
    const signatures = part.getCallSignatures();
    if (signatures.length === 0) return undefined;
    for (const signature of signatures) most = Math.max(most, signature.parameters.length);
  }
  return most;
}

export const subscribeStatusHandler = createRule<[Options], MessageId>({
  name: 'subscribe-status-handler',
  meta: {
    type: 'problem',
    docs: {
      description: 'Require a status callback on Supabase Realtime `subscribe()` calls',
      recommended: true,
      requiresTypeChecking: true,
    },
    messages: {
      noStatusCallback:
        'This subscription has no status callback, so CHANNEL_ERROR, TIMED_OUT and CLOSED go unnoticed. Pass one: `.subscribe((status, err) => { ... })`.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowWrappers: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            uniqueItems: true,
            description:
              'Names of project helpers that already check the subscription status. `.subscribe()` calls inside their bodies are not reported.',
          },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ allowWrappers: [] }],
  },
  create(context, [options]) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();
    const wrappers = new Set(options.allowWrappers);
    stats.recordFile(context.filename);

    const parameterCount: ParameterCount = (expression) => {
      const type = typeAt(services, expression);
      return type === undefined ? undefined : typeParameterCount(type);
    };

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== AST_NODE_TYPES.MemberExpression || callee.computed) return;
        if (callee.property.name !== 'subscribe') return;
        const receiver = typeAt(services, callee.object);
        if (receiver === undefined || !isRealtimeChannel(checker, receiver)) return;
        if (!lacksStatusCallback(node, parameterCount, wrappers)) return;
        context.report({ node, messageId: 'noStatusCallback' });
      },
    };
  },
});
