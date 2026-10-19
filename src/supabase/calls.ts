import {
  AST_NODE_TYPES,
  type ParserServicesWithTypeInformation,
  type TSESTree,
} from '@typescript-eslint/utils';
import ts from 'typescript';
import { typeAt } from './checker.js';
import { findProperty, resolveExpression, resolveObject, stringValues } from './literals.js';
import { isFilterMethod, isQueryReceiver, isRealtimeChannel, isSupabaseFile } from './types.js';

/** Why a call site was skipped rather than checked (§6.1: skip and count, never guess). */
export type SkipReason =
  | 'dynamic-schema'
  | 'dynamic-table'
  | 'realtime-all-tables'
  /** `.from(t)` whose operation is not chained to it, for example `const q = client.from(t)`. */
  | 'unknown-operation';

export const TABLE_OPERATIONS = ['select', 'insert', 'update', 'upsert', 'delete'] as const;
export type TableOperation = (typeof TABLE_OPERATIONS)[number];

/** `client[.schema(s)].from(t).<operation>(...)...` (§6.3). */
export interface TableCall {
  readonly kind: 'table';
  /** The `.from(t)` call. */
  readonly node: TSESTree.CallExpression;
  /** Set when the call cannot be checked; `schemas` or `tables` may then be empty. */
  readonly skip: SkipReason | undefined;
  readonly schemas: readonly string[];
  /** Every literal the table name can be (a union of at most five). */
  readonly tables: readonly string[];
  readonly operation: TableOperation | undefined;
  /** The operation's call, for example `.update(row)`. */
  readonly operationNode: TSESTree.CallExpression | undefined;
  /** A filter (`eq`, `in`, `match`, `or`, ...) is chained after the operation. */
  readonly filtered: boolean;
  /** `.select()` is chained after a write, so rows come back. */
  readonly returning: boolean;
  /** `upsert(row, { ignoreDuplicates })`: false by default, undefined when not a literal. */
  readonly ignoreDuplicates: boolean | undefined;
}

/** `client[.schema(s)].rpc(fn)`: recognised, not checked against the schema in v0.1. */
export interface RpcCall {
  readonly kind: 'rpc';
  readonly node: TSESTree.CallExpression;
  readonly skip: 'dynamic-schema' | undefined;
  readonly schemas: readonly string[];
  /** The function names, or undefined when the name is not a literal. */
  readonly functions: readonly string[] | undefined;
}

/** `channel.on('postgres_changes', { event, schema, table, filter }, callback)` (§6.3, ADR-009). */
export interface Subscription {
  readonly kind: 'realtime';
  readonly node: TSESTree.CallExpression;
  readonly skip: SkipReason | undefined;
  readonly schemas: readonly string[];
  readonly tables: readonly string[];
  /** `INSERT`, `UPDATE`, `DELETE` or `*`; undefined when not a literal. */
  readonly events: readonly string[] | undefined;
}

export type SupabaseCall = TableCall | RpcCall | Subscription;

/** Whether `rls-readable` treats a table call as a read: `select`, or `update`/`delete` returning rows. */
export function readsRows(call: TableCall): boolean {
  if (call.operation === 'select') return true;
  return call.returning && (call.operation === 'update' || call.operation === 'delete');
}

const PUBLIC: readonly string[] = ['public'];
const NONE: readonly string[] = [];

/**
 * The Supabase call that `node` starts, by type (§6.2): `.from(t)` or `.rpc(fn)` on a
 * `SupabaseClient` or `PostgrestClient`, or `.on('postgres_changes', ...)` on a
 * `RealtimeChannel`. Undefined for every other call.
 */
export function analyzeCall(
  services: ParserServicesWithTypeInformation,
  node: TSESTree.CallExpression,
): SupabaseCall | undefined {
  const callee = node.callee;
  if (callee.type !== AST_NODE_TYPES.MemberExpression || callee.computed) return undefined;
  const method = callee.property.name;
  if (method !== 'from' && method !== 'rpc' && method !== 'on') return undefined;
  const checker = services.program.getTypeChecker();
  const receiverType = typeAt(services, callee.object);
  if (receiverType === undefined) return undefined;
  const call = services.esTreeNodeToTSNodeMap.get(node);
  if (method === 'on') {
    return isRealtimeChannel(checker, receiverType) ? subscription(checker, node, call) : undefined;
  }
  if (!isQueryReceiver(checker, receiverType)) return undefined;
  const receiver = services.esTreeNodeToTSNodeMap.get(callee.object) as ts.Expression;
  const schemas = resolveSchema(checker, receiver);
  if (method === 'rpc') {
    return {
      kind: 'rpc',
      node,
      skip: schemas === undefined ? 'dynamic-schema' : undefined,
      schemas: schemas ?? NONE,
      functions: argumentValues(checker, call, 0),
    };
  }
  return tableCall(services, checker, node, call, schemas);
}

function argumentValues(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
  index: number,
): readonly string[] | undefined {
  const argument = call.arguments[index];
  return argument === undefined ? undefined : stringValues(checker, argument);
}

/**
 * The schema of a query receiver (§6.3): `.schema(s)` with a literal; else the `db.schema`
 * option of the `createClient` (or ssr factory) call that made the client, when it is a
 * literal; else `public`. Undefined when the schema is given but not a literal.
 */
function resolveSchema(
  checker: ts.TypeChecker,
  receiver: ts.Expression,
): readonly string[] | undefined {
  const origin = resolveExpression(checker, receiver);
  if (ts.isCallExpression(origin) && ts.isPropertyAccessExpression(origin.expression)) {
    if (origin.expression.name.text === 'schema') return argumentValues(checker, origin, 0);
  }
  if (!ts.isCallExpression(origin) && !ts.isNewExpression(origin)) return PUBLIC;
  const declaration = checker.getResolvedSignature(origin)?.declaration;
  // A project's own factory: its options are not supabase-js's, so the default applies.
  if (declaration === undefined || !isSupabaseFile(declaration.getSourceFile().fileName)) {
    return PUBLIC;
  }
  const options = origin.arguments?.[2];
  if (options === undefined) return PUBLIC;
  const db = objectProperty(checker, options, 'db');
  if (db === 'absent') return PUBLIC;
  if (db === undefined) return undefined;
  const schema = objectProperty(checker, db, 'schema');
  if (schema === 'absent') return PUBLIC;
  return schema === undefined ? undefined : stringValues(checker, schema);
}

/**
 * Property `name` of `node` (followed through `const` aliases), `'absent'` when the object
 * literal does not set it, undefined when `node` is not an object literal or may set it.
 */
function objectProperty(
  checker: ts.TypeChecker,
  node: ts.Expression,
  name: string,
): ts.Expression | 'absent' | undefined {
  const object = resolveObject(checker, node);
  if (object === undefined) return undefined;
  const lookup = findProperty(object, name);
  if ('found' in lookup) return lookup.found;
  return 'absent' in lookup ? 'absent' : undefined;
}

interface ChainLink {
  readonly name: string;
  readonly member: TSESTree.MemberExpression;
  readonly call: TSESTree.CallExpression;
}

/** The method calls chained on `start`: `start.a(...).b(...)` gives `a`, then `b`. */
function chainedCalls(start: TSESTree.CallExpression): ChainLink[] {
  const links: ChainLink[] = [];
  let node = start;
  for (;;) {
    const member = node.parent;
    if (member.type !== AST_NODE_TYPES.MemberExpression || member.object !== node) break;
    if (member.computed) break;
    const call = member.parent;
    if (call.type !== AST_NODE_TYPES.CallExpression || call.callee !== member) break;
    links.push({ name: member.property.name, member, call });
    node = call;
  }
  return links;
}

function isOperation(name: string): name is TableOperation {
  return (TABLE_OPERATIONS as readonly string[]).includes(name);
}

function tableCall(
  services: ParserServicesWithTypeInformation,
  checker: ts.TypeChecker,
  node: TSESTree.CallExpression,
  call: ts.CallExpression,
  schemas: readonly string[] | undefined,
): TableCall {
  const tables = argumentValues(checker, call, 0);
  const [first, ...rest] = chainedCalls(node);
  const operationCall = first !== undefined && isOperation(first.name) ? first.call : undefined;
  const operation = operationCall === undefined ? undefined : (first!.name as TableOperation);
  let filtered = false;
  let selected = false;
  if (operation !== undefined) {
    for (const link of rest) {
      if (link.name === 'select') selected = true;
      const member = services.esTreeNodeToTSNodeMap.get(link.member) as ts.PropertyAccessExpression;
      if (isFilterMethod(checker.getSymbolAtLocation(member.name))) filtered = true;
    }
  }
  let skip: SkipReason | undefined;
  if (schemas === undefined) skip = 'dynamic-schema';
  else if (tables === undefined) skip = 'dynamic-table';
  else if (operation === undefined) skip = 'unknown-operation';
  return {
    kind: 'table',
    node,
    skip,
    schemas: schemas ?? NONE,
    tables: tables ?? NONE,
    operation,
    operationNode: operationCall,
    filtered,
    returning: selected && operation !== 'select',
    ignoreDuplicates:
      operation === 'upsert'
        ? ignoresDuplicates(checker, services.esTreeNodeToTSNodeMap.get(operationCall!))
        : false,
  };
}

/** `upsert(row, { ignoreDuplicates })`, read from a literal (or a `const` alias of one). */
function ignoresDuplicates(checker: ts.TypeChecker, call: ts.CallExpression): boolean | undefined {
  const options = call.arguments[1];
  if (options === undefined) return false;
  const value = objectProperty(checker, options, 'ignoreDuplicates');
  if (value === 'absent') return false;
  if (value === undefined) return undefined;
  const resolved = resolveExpression(checker, value);
  if (resolved.kind === ts.SyntaxKind.TrueKeyword) return true;
  return resolved.kind === ts.SyntaxKind.FalseKeyword ? false : undefined;
}

function subscription(
  checker: ts.TypeChecker,
  node: TSESTree.CallExpression,
  call: ts.CallExpression,
): Subscription | undefined {
  if (argumentValues(checker, call, 0)?.join() !== 'postgres_changes') return undefined;
  const options = call.arguments[1];
  const values = (name: string): readonly string[] | 'absent' | undefined => {
    const value = options === undefined ? undefined : objectProperty(checker, options, name);
    return value === undefined || value === 'absent' ? value : stringValues(checker, value);
  };
  // `schema` is required by supabase-js's types, so there is no default (ADR-009).
  const schemas = values('schema');
  const tables = values('table');
  const events = values('event');
  let skip: SkipReason | undefined;
  if (!Array.isArray(schemas)) skip = 'dynamic-schema';
  else if (schemas.includes('*') || tables === 'absent') skip = 'realtime-all-tables';
  else if (tables === undefined) skip = 'dynamic-table';
  return {
    kind: 'realtime',
    node,
    skip,
    schemas: Array.isArray(schemas) ? schemas : NONE,
    tables: Array.isArray(tables) ? tables : NONE,
    events: Array.isArray(events) ? events : undefined,
  };
}
