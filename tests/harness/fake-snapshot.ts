import {
  SNAPSHOT_VERSION,
  type Membership,
  type PolicyCommand,
  type PolicyPredicate,
  type SchemaSnapshot,
  type SnapshotLocation,
  type SnapshotMeta,
  type SnapshotName,
  type SnapshotPolicy,
  type SnapshotPublication,
  type SnapshotRelation,
} from '../../src/schema/snapshot.js';
import { createSchemaView, type SchemaView } from '../../src/schema/view.js';

/** Hand-built snapshots for rule tests, so rule logic does not wait for the engine (§6.4). */

export const AT: SnapshotLocation = {
  file: 'supabase/migrations/0001_init.sql',
  line: 1,
  column: 1,
};

function split(qualified: string): SnapshotName {
  const dot = qualified.indexOf('.');
  return dot === -1
    ? { schema: 'public', name: qualified }
    : { schema: qualified.slice(0, dot), name: qualified.slice(dot + 1) };
}

export interface FakePolicy {
  readonly name?: string;
  readonly command: PolicyCommand;
  /** Default `['public']`. */
  readonly roles?: readonly string[];
  /** Default `true`. */
  readonly permissive?: boolean;
  /** Default `'other'`. */
  readonly using?: PolicyPredicate | null;
  readonly withCheck?: PolicyPredicate | null;
}

export interface FakeRelation {
  readonly kind?: SnapshotRelation['kind'];
  /** RLS on, from a statement; or the whole `rls` object. */
  readonly rls?: boolean | SnapshotRelation['rls'];
  /** Grantee to privileges held on the table. */
  readonly grants?: Readonly<Record<string, readonly string[]>>;
  /** Grantee to privileges held only on some columns. */
  readonly columnGrants?: Readonly<Record<string, readonly string[]>>;
  readonly policies?: readonly FakePolicy[];
  /** Where a `do` block made the policies unknown (ADR-023). */
  readonly policiesUncertain?: SnapshotLocation;
}

/** A relation, `schema.name` or `name` (schema `public`). */
export function fakeRelation(qualified: string, fake: FakeRelation = {}): SnapshotRelation {
  const privileges: Record<string, Record<string, 'table' | 'columns'>> = {};
  const add = (grants: FakeRelation['grants'], level: 'table' | 'columns') => {
    for (const [grantee, list] of Object.entries(grants ?? {})) {
      for (const privilege of list) (privileges[grantee] ??= {})[privilege] = level;
    }
  };
  add(fake.columnGrants, 'columns');
  add(fake.grants, 'table');
  const rls =
    typeof fake.rls === 'object'
      ? fake.rls
      : fake.rls === true
        ? { enabled: true, forced: false, source: 'statement' as const, at: AT }
        : { enabled: false, forced: false, source: 'default' as const, at: null };
  return {
    ...split(qualified),
    kind: fake.kind ?? 'table',
    created: AT,
    rls,
    privileges,
    policies: (fake.policies ?? []).map((policy, index): SnapshotPolicy => ({
      name: policy.name ?? `policy_${index}`,
      command: policy.command,
      roles: policy.roles ?? ['public'],
      permissive: policy.permissive ?? true,
      using: policy.using === undefined ? 'other' : policy.using,
      withCheck: policy.withCheck ?? null,
      created: AT,
      altered: null,
    })),
    policiesUncertain: fake.policiesUncertain ?? null,
  };
}

export interface FakePublication {
  readonly allTables?: boolean;
  readonly schemas?: readonly string[];
  readonly tables?: readonly string[];
  readonly uncertain?: boolean;
  readonly excluded?: readonly string[];
}

export function fakePublication(name: string, fake: FakePublication = {}): SnapshotPublication {
  return {
    name,
    origin: name === 'supabase_realtime' ? 'platform' : 'migration',
    allTables: fake.allTables ?? false,
    schemas: fake.schemas ?? [],
    tables: (fake.tables ?? []).map(split),
    uncertain: fake.uncertain === true ? AT : null,
    excluded: (fake.excluded ?? []).map(split),
  };
}

export const FAKE_META: SnapshotMeta = {
  engineVersion: '0.0.0-fake',
  configSource: 'defaults',
  files: 1,
  since: { value: null, source: null },
  parseProblems: 0,
  dynamicSql: 0,
  declarativeFiles: 0,
  autoRls: { mode: 'auto', active: null },
  notes: [],
};

export interface FakeSnapshot {
  /** `schema.name` (or `name`) to relation. */
  readonly relations?: Readonly<Record<string, FakeRelation>>;
  /** Name to publication; default an empty `supabase_realtime`, as the platform creates it. */
  readonly publications?: Readonly<Record<string, FakePublication>>;
  readonly meta?: Partial<SnapshotMeta>;
}

export function fakeSnapshot(fake: FakeSnapshot = {}): SchemaSnapshot {
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    relations: Object.entries(fake.relations ?? {}).map(([name, relation]) =>
      fakeRelation(name, relation),
    ),
    sequences: [],
    publications: Object.entries(fake.publications ?? { supabase_realtime: {} }).map(
      ([name, publication]) => fakePublication(name, publication),
    ),
    meta: { ...FAKE_META, ...fake.meta },
  };
}

/** ADR-017 §3's membership order, as the engine's `publicationMembership` implements it. */
export function fakeMembership(
  snapshot: SchemaSnapshot,
  pub: string,
  schema: string,
  name: string,
): Membership {
  const found = snapshot.publications.find((p) => p.name === pub);
  if (found === undefined) return 'no';
  const same = (t: SnapshotName) => t.schema === schema && t.name === name;
  const isTable =
    snapshot.relations.some((r) => same(r) && r.kind === 'table') || !snapshot.relations.some(same);
  if (found.tables.some(same) || (found.allTables && isTable) || found.schemas.includes(schema)) {
    return 'yes';
  }
  if (found.excluded.some(same)) return 'no';
  return found.uncertain === null ? 'no' : 'unknown';
}

/** A `SchemaView` over a fake snapshot. */
export function fakeView(fake: FakeSnapshot = {}): SchemaView {
  return createSchemaView(fakeSnapshot(fake), fakeMembership);
}
