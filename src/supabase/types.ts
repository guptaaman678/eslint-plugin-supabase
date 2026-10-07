import ts from 'typescript';

/** A class declared by one of the `@supabase/*` packages. */
export interface SupabaseClass {
  /** The package directory under `node_modules/@supabase/`, for example `postgrest-js`. */
  readonly pkg: string;
  /** The class declaration's name (never the symbol name, which is `default` for default exports). */
  readonly name: string;
}

function supabaseClass(pkg: string, name: string): SupabaseClass {
  return { pkg, name };
}

/** `createClient` and the `@supabase/ssr` factories return this. Not thenable. */
export const SUPABASE_CLIENT = supabaseClass('supabase-js', 'SupabaseClient');

/** What `client.schema(s)` returns; `.from()` and `.rpc()` are called on it (ADR-003). */
export const POSTGREST_CLIENT = supabaseClass('postgrest-js', 'PostgrestClient');

/** The classes that `.from()` and `.rpc()` are called on. */
export const QUERY_RECEIVERS: readonly SupabaseClass[] = [SUPABASE_CLIENT, POSTGREST_CLIENT];

/** Declares the filter methods (`eq`, `in`, `match`, `or`, ...), and `throwOnError`. */
export const POSTGREST_FILTER_BUILDER = supabaseClass('postgrest-js', 'PostgrestFilterBuilder');

/**
 * Lazy query builders (§6.2, ADR-002): they implement `PromiseLike` and send the request only
 * when `then` is called. Most derived first, so a match names the most specific class.
 */
export const QUERY_BUILDERS: readonly SupabaseClass[] = [
  POSTGREST_FILTER_BUILDER,
  supabaseClass('postgrest-js', 'PostgrestTransformBuilder'),
  supabaseClass('postgrest-js', 'PostgrestBuilder'),
];

/** Lazy storage downloads (ADR-002): `.download(p)` and `.download(p).asStream()`. */
export const DOWNLOAD_BUILDERS: readonly SupabaseClass[] = [
  supabaseClass('storage-js', 'BlobDownloadBuilder'),
  supabaseClass('storage-js', 'StreamDownloadBuilder'),
];

/** The five lazy classes. Every other Supabase call returning a promise sends at once. */
export const LAZY_BUILDERS: readonly SupabaseClass[] = [...QUERY_BUILDERS, ...DOWNLOAD_BUILDERS];

/** `client.channel(name)` returns this; `.on()` and `.subscribe()` are called on it. */
export const CHANNEL_CLASS = supabaseClass('realtime-js', 'RealtimeChannel');

/**
 * Whether a declaration file belongs to `@supabase/<pkg>`. The path test also matches pnpm's
 * `node_modules/.pnpm/<pkg>@<version>/node_modules/@supabase/<pkg>/` layout and Windows paths.
 */
export function isPackageFile(fileName: string, pkg: string): boolean {
  return fileName.replaceAll('\\', '/').includes(`/node_modules/@supabase/${pkg}/`);
}

/** Whether a file belongs to any `@supabase/*` package (for example `createClient`'s). */
export function isSupabaseFile(fileName: string): boolean {
  return fileName.replaceAll('\\', '/').includes('/node_modules/@supabase/');
}

function declares(declaration: ts.Declaration, cls: SupabaseClass): boolean {
  return (
    ts.isClassDeclaration(declaration) &&
    declaration.name?.text === cls.name &&
    isPackageFile(declaration.getSourceFile().fileName, cls.pkg)
  );
}

/**
 * The first class of `classes` that `type` is or extends (ADR-003): the type's own class is
 * tried before its base types, then union and intersection constituents in order. Intersections
 * matter for `.throwOnError()` before supabase-js 2.91, which returns `this & PostgrestBuilder`.
 */
export function findClass(
  checker: ts.TypeChecker,
  type: ts.Type,
  classes: readonly SupabaseClass[],
): SupabaseClass | undefined {
  if (type.isUnionOrIntersection()) {
    for (const part of type.types) {
      const found = findClass(checker, part, classes);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const declarations = type.getSymbol()?.declarations ?? [];
  const own = classes.find((cls) => declarations.some((d) => declares(d, cls)));
  if (own !== undefined) return own;
  const target = isTypeReference(type) ? type.target : type;
  if (!target.isClassOrInterface()) return undefined;
  for (const base of checker.getBaseTypes(target)) {
    const found = findClass(checker, base, classes);
    if (found !== undefined) return found;
  }
  return undefined;
}

function isTypeReference(type: ts.Type): type is ts.TypeReference {
  return (
    (type.flags & ts.TypeFlags.Object) !== 0 &&
    ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) !== 0
  );
}

/** What a lazy builder sends: a PostgREST query (or RPC) or a storage download. */
export type BuilderKind = 'query' | 'download';

/** A lazy builder type (§6.2): the matched class and what it sends. */
export interface LazyBuilder {
  readonly cls: SupabaseClass;
  readonly kind: BuilderKind;
}

/** The lazy builder `type` is, or contains through a union or intersection. */
export function lazyBuilder(checker: ts.TypeChecker, type: ts.Type): LazyBuilder | undefined {
  const cls = findClass(checker, type, LAZY_BUILDERS);
  if (cls === undefined) return undefined;
  return { cls, kind: DOWNLOAD_BUILDERS.includes(cls) ? 'download' : 'query' };
}

/** Whether `type` is supabase-js's `SupabaseClient`, or a class extending it. */
export function isSupabaseClient(checker: ts.TypeChecker, type: ts.Type): boolean {
  return findClass(checker, type, [SUPABASE_CLIENT]) !== undefined;
}

/** Whether `.from()` and `.rpc()` on `type` are Supabase table and function calls. */
export function isQueryReceiver(checker: ts.TypeChecker, type: ts.Type): boolean {
  return findClass(checker, type, QUERY_RECEIVERS) !== undefined;
}

/** Whether `type` is a realtime-js `RealtimeChannel`. */
export function isRealtimeChannel(checker: ts.TypeChecker, type: ts.Type): boolean {
  return findClass(checker, type, [CHANNEL_CLASS]) !== undefined;
}

/** Whether a method symbol is one of `PostgrestFilterBuilder`'s filters (not `throwOnError`). */
export function isFilterMethod(symbol: ts.Symbol | undefined): boolean {
  if (symbol === undefined || symbol.name === 'throwOnError') return false;
  return (symbol.declarations ?? []).some(
    (declaration) =>
      ts.isClassDeclaration(declaration.parent) &&
      declares(declaration.parent, POSTGREST_FILTER_BUILDER),
  );
}
