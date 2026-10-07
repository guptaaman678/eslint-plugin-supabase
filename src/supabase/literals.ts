import ts from 'typescript';

/** A wider union of literal names is treated as dynamic (§6.3). */
export const MAX_LITERAL_UNION = 5;

/**
 * The string values an expression can take (§6.3): a string literal, a template literal without
 * expressions, or an expression whose type is a string literal or a union of at most
 * `MAX_LITERAL_UNION` string literals. Undefined when the value is not known statically.
 */
export function stringValues(
  checker: ts.TypeChecker,
  node: ts.Expression,
): readonly string[] | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  const type = checker.getTypeAtLocation(node);
  const parts = type.isUnion() ? type.types : [type];
  if (parts.length > MAX_LITERAL_UNION) return undefined;
  const values: string[] = [];
  for (const part of parts) {
    if (!part.isStringLiteral()) return undefined;
    values.push(part.value);
  }
  return values;
}

/** A `const` chain longer than this is not followed (it can only be a cycle in broken code). */
const MAX_ALIAS_DEPTH = 16;

/**
 * The expression a value comes from: strips parentheses, `as`, `satisfies` and `!`, and follows
 * identifiers through imports and `const` declarations to their initialisers, across files.
 * Anything else (a parameter, a `let`, a property access) is returned as it is.
 */
export function resolveExpression(checker: ts.TypeChecker, node: ts.Expression): ts.Expression {
  for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth++) {
    node = skipWrappers(node);
    if (!ts.isIdentifier(node)) return node;
    const initializer = constInitializer(checker, node);
    if (initializer === undefined) return node;
    node = initializer;
  }
  return node;
}

/** `node` without parentheses, `as`, `satisfies` and `!`. */
export function skipWrappers(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

/** The initialiser of the `const` an identifier names, through imports; else undefined. */
export function constInitializer(
  checker: ts.TypeChecker,
  identifier: ts.Identifier,
): ts.Expression | undefined {
  let symbol = checker.getSymbolAtLocation(identifier);
  if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  const declaration = symbol?.valueDeclaration;
  if (
    declaration === undefined ||
    !ts.isVariableDeclaration(declaration) ||
    (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) === 0
  ) {
    return undefined;
  }
  return declaration.initializer;
}

/** Result of looking up a property in an object literal. */
export type PropertyLookup =
  { readonly found: ts.Expression } | { readonly absent: true } | { readonly unknown: true };

/**
 * The value of property `name` in an object literal. The last assignment wins; a spread after the
 * last assignment (or with none) makes the value unknown, since it may set the property.
 */
export function findProperty(object: ts.ObjectLiteralExpression, name: string): PropertyLookup {
  for (let index = object.properties.length - 1; index >= 0; index--) {
    const property = object.properties[index]!;
    // A spread or a computed key may set the property to anything.
    if (ts.isSpreadAssignment(property) || ts.isComputedPropertyName(property.name)) {
      return { unknown: true };
    }
    if (property.name.text !== name) continue;
    if (ts.isPropertyAssignment(property)) return { found: property.initializer };
    if (ts.isShorthandPropertyAssignment(property)) return { found: property.name };
    // A method or accessor: not a plain value.
    return { unknown: true };
  }
  return { absent: true };
}

/** `node`, followed through `const` aliases, if that is an object literal. */
export function resolveObject(
  checker: ts.TypeChecker,
  node: ts.Expression,
): ts.ObjectLiteralExpression | undefined {
  const resolved = resolveExpression(checker, node);
  return ts.isObjectLiteralExpression(resolved) ? resolved : undefined;
}
