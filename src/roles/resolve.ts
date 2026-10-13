import type { ParserServicesWithTypeInformation, TSESTree } from '@typescript-eslint/utils';
import ts from 'typescript';
import type { ClientMapping, Role, SupabaseSettings } from '../settings.js';
import type { SupabaseCall } from '../supabase/calls.js';
import { constInitializer, resolveExpression, skipWrappers } from '../supabase/literals.js';
import { isSupabaseFile } from '../supabase/types.js';
import { matchesGlob } from './glob.js';

/** Why a call site's role set is unknown (§6.5 steps 4 and 5). */
export type RoleSkipReason = 'unknown-client' | 'unknown-key';

/** The step of §6.5 that decided a role set. */
export type RoleSource = 'settings' | 'service-role-key' | 'client-key' | 'unknown-key';

/** The roles a call can run as, or why the call is skipped. */
export type ClientRoles =
  | { readonly roles: readonly Role[]; readonly source: RoleSource; readonly skip: undefined }
  | { readonly roles: readonly Role[]; readonly source: undefined; readonly skip: RoleSkipReason };

/** Key names that visibly hold the service-role (or secret) key (§6.5 step 2). */
export const SERVICE_ROLE_NAMES: readonly RegExp[] = [
  /service[_-]?role/i,
  /service[_-]?key/i,
  /secret[_-]?key/i,
];
/** Key names that visibly hold a client key (§6.5 step 3). */
export const CLIENT_KEY_NAMES: readonly RegExp[] = [/anon[_-]?key|publishable/i];
export const SECRET_KEY_PREFIX = 'sb_secret_';
export const PUBLISHABLE_KEY_PREFIX = 'sb_publishable_';

const SERVICE_ROLE: readonly Role[] = ['service_role'];
const NO_ROLES: readonly Role[] = [];

/** Alias chains and nested fallbacks deeper than this are not followed (broken code only). */
const MAX_DEPTH = 16;
/** A project factory that calls more nested project factories than this is not followed. */
const MAX_FACTORY_HOPS = 3;

type ClientOrigin = ts.CallExpression | ts.NewExpression;

/**
 * The roles the client of a Supabase call runs as (§6.5). The client value is followed through
 * imports, `const` aliases, `await`, and supabase-js methods such as `.schema(s)` and
 * `.channel(name)`, to the call or `new` that created it. The first matching step decides:
 *
 * 1. a `settings.supabase.clients` entry, in order, whose `module` glob matches the file of that
 *    call or the file declaring the project's own factory it calls, or whose `callee` is the
 *    factory's name (as called, or as declared when imported under another name);
 * 2. a key argument of a supabase-js factory whose name says service role, service key or secret
 *    key, or a literal starting with `sb_secret_`: `service_role`;
 * 3. a key name that says anon or publishable, or a literal starting with `sb_publishable_`:
 *    `settings.supabase.defaultRoles`;
 * 4. any other origin: `defaultRoles`, or skipped as `unknown-key` when `unknownKey` is `skip`;
 * 5. no origin (a parameter, a `let`, a property, `new` of a class outside supabase-js): skipped
 *    as `unknown-client`.
 *
 * For an origin that calls the project's own factory, steps 2 and 3 read the clients that factory
 * returns, up to three factories deep: when every returned client is a supabase-js factory whose
 * key steps 2 and 3 classify the same way, that class decides (ADR-022).
 *
 * Only names and prefixes in the source text are read. Key values are never decoded or kept.
 */
export function resolveClientRoles(
  services: ParserServicesWithTypeInformation,
  call: SupabaseCall,
  settings: Pick<SupabaseSettings, 'clients' | 'defaultRoles' | 'unknownKey'>,
  projectDir: string,
): ClientRoles {
  const checker = services.program.getTypeChecker();
  const client = (call.node.callee as TSESTree.MemberExpression).object;
  const origin = clientOrigin(checker, services.esTreeNodeToTSNodeMap.get(client) as ts.Expression);
  if (origin === undefined) return { roles: NO_ROLES, source: undefined, skip: 'unknown-client' };
  const mapping = mappedClient(checker, origin, settings.clients, projectDir);
  if (mapping !== undefined) return { roles: mapping.roles, source: 'settings', skip: undefined };
  const key = keyKind(checker, origin);
  if (key === 'service-role') {
    return { roles: SERVICE_ROLE, source: 'service-role-key', skip: undefined };
  }
  if (key === 'client')
    return { roles: settings.defaultRoles, source: 'client-key', skip: undefined };
  if (settings.unknownKey === 'skip') {
    return { roles: NO_ROLES, source: undefined, skip: 'unknown-key' };
  }
  return { roles: settings.defaultRoles, source: 'unknown-key', skip: undefined };
}

function declarationOf(checker: ts.TypeChecker, origin: ClientOrigin): ts.Declaration | undefined {
  return checker.getResolvedSignature(origin)?.declaration;
}

function inSupabasePackage(declaration: ts.Node): boolean {
  return isSupabaseFile(declaration.getSourceFile().fileName);
}

/** The call or `new` that created a client value; undefined when it cannot be traced. */
function clientOrigin(checker: ts.TypeChecker, node: ts.Expression): ClientOrigin | undefined {
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const origin = resolveExpression(checker, node);
    if (ts.isAwaitExpression(origin)) {
      node = origin.expression;
      continue;
    }
    // `new Proxy(...)` and other classes outside supabase-js say nothing about the key.
    if (ts.isNewExpression(origin)) return supabaseClass(checker, origin) ? origin : undefined;
    if (!ts.isCallExpression(origin)) return undefined;
    const declaration = declarationOf(checker, origin);
    // A supabase-js method (`.schema(s)`, `.channel(name)`, `.on(...)`) keeps its receiver's key.
    if (declaration === undefined || !ts.isMethodDeclaration(declaration)) return origin;
    if (!inSupabasePackage(declaration)) return origin;
    if (!ts.isPropertyAccessExpression(origin.expression)) return undefined;
    node = origin.expression.expression;
  }
  return undefined;
}

/** Whether a `new` constructs a class declared by supabase-js (`SupabaseClient`). */
function supabaseClass(checker: ts.TypeChecker, origin: ts.NewExpression): boolean {
  const callee = skipWrappers(origin.expression);
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  let symbol = checker.getSymbolAtLocation(name);
  if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  return (symbol?.declarations ?? []).some(inSupabasePackage);
}

function mappedClient(
  checker: ts.TypeChecker,
  origin: ClientOrigin,
  clients: readonly ClientMapping[],
  projectDir: string,
): ClientMapping | undefined {
  if (clients.length === 0) return undefined;
  const files = [origin.getSourceFile().fileName];
  const declaration = declarationOf(checker, origin);
  const declaredIn = declaration?.getSourceFile().fileName;
  if (declaredIn !== undefined && !declaredIn.replaceAll('\\', '/').includes('/node_modules/')) {
    files.push(declaredIn);
  }
  const names = calleeNames(checker, origin);
  return clients.find(
    (client) =>
      (client.module !== undefined &&
        files.some((file) => matchesGlob(client.module!, file, projectDir))) ||
      (client.callee !== undefined && names.includes(client.callee)),
  );
}

/** The factory's name as called, plus its declared name when it is imported under another. */
function calleeNames(checker: ts.TypeChecker, origin: ClientOrigin): string[] {
  const callee = skipWrappers(origin.expression);
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  if (!ts.isIdentifier(name)) return [];
  const symbol = checker.getSymbolAtLocation(name);
  if (symbol === undefined || (symbol.flags & ts.SymbolFlags.Alias) === 0) return [name.text];
  return [name.text, checker.getAliasedSymbol(symbol).name];
}

type KeyKind = 'service-role' | 'client';

/** Followed project factories, by declaration; null when they decide nothing. */
const factoryKinds = new WeakMap<ts.Declaration, KeyKind | null>();

/** What the key of a client origin visibly is (§6.5 steps 2 and 3). */
function keyKind(checker: ts.TypeChecker, origin: ClientOrigin): KeyKind | undefined {
  const declaration = declarationOf(checker, origin);
  if (declaration === undefined) return undefined;
  if (inSupabasePackage(declaration)) return suppliedKeyKind(checker, origin);
  // A project's own factory: the keys of the clients it returns (ADR-022 item 1).
  let kind = factoryKinds.get(declaration);
  if (kind === undefined) {
    kind = returnedKeyKind(checker, declaration, 1, new Set()) ?? null;
    factoryKinds.set(declaration, kind);
  }
  return kind ?? undefined;
}

/**
 * The one class of key every client a project factory returns has. Returns of `null` and
 * `undefined` are ignored; any other return that does not lead to a supabase-js factory with a
 * classified key (through at most `MAX_FACTORY_HOPS` project factories, without recursion)
 * decides nothing.
 */
function returnedKeyKind(
  checker: ts.TypeChecker,
  declaration: ts.Declaration,
  hops: number,
  seen: Set<ts.Declaration>,
): KeyKind | undefined {
  if (hops > MAX_FACTORY_HOPS || seen.has(declaration)) return undefined;
  if (!projectFunction(declaration)) return undefined;
  seen.add(declaration);
  let kind: KeyKind | undefined;
  for (const returned of returnedClients(checker, declaration)) {
    const origin = clientOrigin(checker, returned);
    const inner = origin === undefined ? undefined : declarationOf(checker, origin);
    let next: KeyKind | undefined;
    if (origin === undefined || inner === undefined) next = undefined;
    else if (inSupabasePackage(inner)) next = suppliedKeyKind(checker, origin);
    else next = returnedKeyKind(checker, inner, hops + 1, seen);
    if (next === undefined || (kind !== undefined && next !== kind)) {
      kind = undefined;
      break;
    }
    kind = next;
  }
  seen.delete(declaration);
  return kind;
}

type ProjectFunction = ts.FunctionLikeDeclaration & { readonly body: ts.ConciseBody };

/** A function with a body declared outside node_modules. */
function projectFunction(declaration: ts.Declaration): declaration is ProjectFunction {
  return (
    (ts.isFunctionDeclaration(declaration) ||
      ts.isFunctionExpression(declaration) ||
      ts.isArrowFunction(declaration) ||
      ts.isMethodDeclaration(declaration)) &&
    declaration.body !== undefined &&
    !declaration.getSourceFile().fileName.replaceAll('\\', '/').includes('/node_modules/')
  );
}

/**
 * The client expressions a function returns: every `return` (not those of nested functions) and
 * an arrow's expression body. A module-level `let` that is returned contributes its initialiser
 * and every assignment to it (a lazy singleton). `null` and `undefined` are left out.
 */
function returnedClients(checker: ts.TypeChecker, fn: ProjectFunction): ts.Expression[] {
  const returned: ts.Expression[] = [];
  if (!ts.isBlock(fn.body)) {
    returned.push(fn.body);
  } else {
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
      if (ts.isReturnStatement(node)) {
        if (node.expression !== undefined) returned.push(node.expression);
        return;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(fn.body, visit);
  }
  return returned
    .flatMap(branches)
    .flatMap((expression) => singletonValues(checker, expression) ?? [expression])
    .filter((expression) => !nullish(skipWrappers(expression)));
}

/** Both branches of `cond ? a : b` (nested ones too), which the expression returns; else itself. */
function branches(expression: ts.Expression): ts.Expression[] {
  const inner = skipWrappers(expression);
  if (!ts.isConditionalExpression(inner)) return [expression];
  return [...branches(inner.whenTrue), ...branches(inner.whenFalse)];
}

/** The initialiser and assigned values of a returned module-level `let`; else undefined. */
function singletonValues(
  checker: ts.TypeChecker,
  expression: ts.Expression,
): ts.Expression[] | undefined {
  // `return (cached ??= createClient(...))` returns the variable.
  const assigned = skipWrappers(expression);
  if (ts.isBinaryExpression(assigned) && assignment(assigned)) expression = assigned.left;
  const identifier = resolveExpression(checker, expression);
  if (!ts.isIdentifier(identifier)) return undefined;
  const symbol = checker.getSymbolAtLocation(identifier);
  const declaration = symbol?.valueDeclaration;
  if (
    declaration === undefined ||
    !ts.isVariableDeclaration(declaration) ||
    !ts.isVariableStatement(declaration.parent.parent) ||
    !ts.isSourceFile(declaration.parent.parent.parent)
  ) {
    return undefined;
  }
  const values = declaration.initializer === undefined ? [] : [declaration.initializer];
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && assignment(node)) {
      const target = skipWrappers(node.left);
      if (ts.isIdentifier(target) && checker.getSymbolAtLocation(target) === symbol) {
        values.push(node.right);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(declaration.getSourceFile(), visit);
  return values;
}

/** `a = b`, `a ??= b` or `a ||= b`. */
function assignment(node: ts.BinaryExpression): boolean {
  const kind = node.operatorToken.kind;
  return (
    kind === ts.SyntaxKind.EqualsToken ||
    kind === ts.SyntaxKind.QuestionQuestionEqualsToken ||
    kind === ts.SyntaxKind.BarBarEqualsToken
  );
}

/** `null`, `undefined` or `void x`. */
function nullish(node: ts.Expression): boolean {
  return (
    node.kind === ts.SyntaxKind.NullKeyword ||
    ts.isVoidExpression(node) ||
    (ts.isIdentifier(node) && node.text === 'undefined')
  );
}

/** What the key argument of a supabase-js factory visibly is (§6.5 steps 2 and 3). */
function suppliedKeyKind(checker: ts.TypeChecker, origin: ClientOrigin): KeyKind | undefined {
  const key = (origin.arguments ?? [])[1];
  if (key === undefined) return undefined;
  const names: string[] = [];
  const literals: string[] = [];
  keyParts(checker, key, names, literals, 0);
  const matches = (patterns: readonly RegExp[]) =>
    names.some((name) => patterns.some((pattern) => pattern.test(name)));
  if (matches(SERVICE_ROLE_NAMES) || literals.some((text) => text.startsWith(SECRET_KEY_PREFIX))) {
    return 'service-role';
  }
  if (
    matches(CLIENT_KEY_NAMES) ||
    literals.some((text) => text.startsWith(PUBLISHABLE_KEY_PREFIX))
  ) {
    return 'client';
  }
  return undefined;
}

/** String methods that return the same key, so `key.trim()` is read as `key`. */
const KEY_STRING_METHODS: ReadonlySet<string> = new Set([
  'trim',
  'trimStart',
  'trimEnd',
  'toString',
  'valueOf',
]);

/**
 * Collects the names and string literals a key expression is made of: identifiers along a
 * `const` chain, the property of `a.b` or `a['b']` (so `process.env.X` and `import.meta.env.X`
 * give `X`), the string literal first argument of a call (`Deno.env.get('X')`, `getEnv('X')`,
 * `config.get('X')`: ADR-022 item 4), the receiver of a string method without arguments
 * (`process.env.X!.trim()`), and both sides of `??` and `||`.
 */
function keyParts(
  checker: ts.TypeChecker,
  node: ts.Expression,
  names: string[],
  literals: string[],
  depth: number,
): void {
  if (depth >= MAX_DEPTH) return;
  node = skipWrappers(node);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    literals.push(node.text);
  } else if (ts.isIdentifier(node)) {
    names.push(node.text);
    const initializer = constInitializer(checker, node);
    if (initializer !== undefined) keyParts(checker, initializer, names, literals, depth + 1);
  } else if (ts.isPropertyAccessExpression(node)) {
    names.push(node.name.text);
  } else if (ts.isElementAccessExpression(node)) {
    if (ts.isStringLiteral(node.argumentExpression)) names.push(node.argumentExpression.text);
  } else if (ts.isCallExpression(node)) {
    const argument = node.arguments[0];
    if (
      argument !== undefined &&
      (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
    ) {
      names.push(argument.text);
    } else if (
      node.arguments.length === 0 &&
      ts.isPropertyAccessExpression(node.expression) &&
      KEY_STRING_METHODS.has(node.expression.name.text)
    ) {
      // `process.env.X!.trim()` is still the key named X.
      keyParts(checker, node.expression.expression, names, literals, depth + 1);
    }
  } else if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    keyParts(checker, node.left, names, literals, depth + 1);
    keyParts(checker, node.right, names, literals, depth + 1);
  }
}
