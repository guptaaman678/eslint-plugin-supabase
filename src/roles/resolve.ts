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
export const SERVICE_ROLE_NAMES: readonly RegExp[] = [/service[_-]?role/i, /secret[_-]?key/i];
/** Key names that visibly hold a client key (§6.5 step 3). */
export const CLIENT_KEY_NAMES: readonly RegExp[] = [/anon[_-]?key|publishable/i];
export const SECRET_KEY_PREFIX = 'sb_secret_';
export const PUBLISHABLE_KEY_PREFIX = 'sb_publishable_';

const SERVICE_ROLE: readonly Role[] = ['service_role'];
const NO_ROLES: readonly Role[] = [];

/** Alias chains and nested fallbacks deeper than this are not followed (broken code only). */
const MAX_DEPTH = 16;

type ClientOrigin = ts.CallExpression | ts.NewExpression;

/**
 * The roles the client of a Supabase call runs as (§6.5). The client value is followed through
 * imports, `const` aliases, `await`, and supabase-js methods such as `.schema(s)` and
 * `.channel(name)`, to the call or `new` that created it. The first matching step decides:
 *
 * 1. a `settings.supabase.clients` entry, in order, whose `module` glob matches the file of that
 *    call or the file declaring the project's own factory it calls, or whose `callee` is the
 *    factory's name (as called, or as declared when imported under another name);
 * 2. a key argument of a supabase-js factory whose name says service role or secret key, or a
 *    literal starting with `sb_secret_`: `service_role`;
 * 3. a key name that says anon or publishable, or a literal starting with `sb_publishable_`:
 *    `settings.supabase.defaultRoles`;
 * 4. any other origin: `defaultRoles`, or skipped as `unknown-key` when `unknownKey` is `skip`;
 * 5. no origin (a parameter, a `let`, a property): skipped as `unknown-client`.
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
    if (ts.isNewExpression(origin)) return origin;
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

/** What the key argument of a supabase-js factory visibly is (§6.5 steps 2 and 3). */
function keyKind(checker: ts.TypeChecker, origin: ClientOrigin): KeyKind | undefined {
  const declaration = declarationOf(checker, origin);
  // A project's own factory: the key it passes is not visible here (settings can map it).
  if (declaration === undefined || !inSupabasePackage(declaration)) return undefined;
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

/**
 * Collects the names and string literals a key expression is made of: identifiers along a
 * `const` chain, the property of `a.b` or `a['b']` (so `process.env.X` and `import.meta.env.X`
 * give `X`), the argument of `Deno.env.get('X')`, and both sides of `??` and `||`.
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
    const variable = denoEnvName(node);
    if (variable !== undefined) names.push(variable);
  } else if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    keyParts(checker, node.left, names, literals, depth + 1);
    keyParts(checker, node.right, names, literals, depth + 1);
  }
}

/** `X` of `Deno.env.get('X')`. */
function denoEnvName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  const argument = call.arguments[0];
  if (
    !ts.isPropertyAccessExpression(callee) ||
    callee.name.text !== 'get' ||
    callee.expression.getText() !== 'Deno.env' ||
    argument === undefined ||
    !ts.isStringLiteral(argument)
  ) {
    return undefined;
  }
  return argument.text;
}
