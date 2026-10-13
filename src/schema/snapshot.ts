/**
 * `SchemaSnapshot` v1: the database a project's migrations build, as `supabase-grants-lint/engine`
 * returns it (ADR-017 §3). Plain JSON. The plugin declares the shape itself so that rules and their
 * tests depend on the JSON contract, not on the engine package.
 */

export const SNAPSHOT_VERSION = 1;

export interface SnapshotLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export interface SnapshotName {
  readonly schema: string;
  readonly name: string;
}

export type RelationKind = 'table' | 'view' | 'materialized view' | 'foreign table';
export type PolicyCommand = 'all' | 'select' | 'insert' | 'update' | 'delete';
export type PolicyPredicate = 'service_role' | 'false' | 'other';

export interface SnapshotRelation {
  readonly schema: string;
  readonly name: string;
  readonly kind: RelationKind;
  readonly created: SnapshotLocation | null;
  readonly rls: {
    readonly enabled: boolean;
    readonly forced: boolean;
    /** Why `enabled` has its value. */
    readonly source: 'default' | 'statement' | 'auto-rls';
    /** The statement, or the automatic RLS trigger or function that applied. */
    readonly at: SnapshotLocation | null;
  };
  /**
   * Grantee, then privilege: `'table'` when held on the whole relation, `'columns'` when held only
   * on some columns. Grantee `'public'` is PUBLIC.
   */
  readonly privileges: Readonly<Record<string, Readonly<Record<string, 'table' | 'columns'>>>>;
  readonly policies: readonly SnapshotPolicy[];
  /**
   * Where a `do` block that creates, alters or drops a policy on this relation (or on a name built
   * at run time) made `policies` incomplete, or `null`.
   */
  readonly policiesUncertain: SnapshotLocation | null;
}

export interface SnapshotPolicy {
  readonly name: string;
  readonly command: PolicyCommand;
  /** `'public'` for PUBLIC. */
  readonly roles: readonly string[];
  readonly permissive: boolean;
  readonly using: PolicyPredicate | null;
  readonly withCheck: PolicyPredicate | null;
  readonly created: SnapshotLocation;
  readonly altered: SnapshotLocation | null;
}

export interface SnapshotSequence {
  readonly schema: string;
  readonly name: string;
  /** Grantee to privileges; grantee `'public'` is PUBLIC. */
  readonly privileges: Readonly<Record<string, readonly string[]>>;
  readonly ownedBy: {
    readonly schema: string;
    readonly name: string;
    readonly column: string;
  } | null;
}

export interface SnapshotPublication {
  readonly name: string;
  /** The platform's initial state, a `create` statement, or first seen in an `alter`. */
  readonly origin: 'platform' | 'migration' | 'unseen';
  readonly allTables: boolean;
  /** `FOR TABLES IN SCHEMA`. */
  readonly schemas: readonly string[];
  /** Explicit members. */
  readonly tables: readonly SnapshotName[];
  /** Where a change the replay cannot follow made membership unknown (ADR-015). */
  readonly uncertain: SnapshotLocation | null;
  /** Tables explicitly removed after the `uncertain` mark. */
  readonly excluded: readonly SnapshotName[];
}

export interface SnapshotMeta {
  /** grants-lint's version. */
  readonly engineVersion: string;
  /** The config source with the highest precedence, or `defaults`. */
  readonly configSource: string;
  /** Migration files replayed. */
  readonly files: number;
  readonly since: {
    readonly value: string | null;
    readonly source: 'cli' | 'config' | 'auto' | null;
  };
  /** Statements the parser could not read. */
  readonly parseProblems: number;
  /** `DO` blocks. */
  readonly dynamicSql: number;
  /** Declarative schema files found (not replayed). */
  readonly declarativeFiles: number;
  readonly autoRls: {
    readonly mode: 'auto' | 'on' | 'off';
    readonly active: SnapshotLocation | 'start' | null;
  };
  readonly notes: readonly {
    readonly code: string;
    readonly message: string;
    readonly at: SnapshotLocation;
  }[];
}

export interface SchemaSnapshot {
  readonly snapshotVersion: typeof SNAPSHOT_VERSION;
  /** Every tracked relation, in every schema, in creation order. */
  readonly relations: readonly SnapshotRelation[];
  readonly sequences: readonly SnapshotSequence[];
  readonly publications: readonly SnapshotPublication[];
  readonly meta: SnapshotMeta;
}

/** Whether a table is in a publication; `'unknown'` after a change the replay cannot follow. */
export type Membership = 'yes' | 'no' | 'unknown';

/**
 * The engine returned a snapshot of a version the plugin cannot read. Not a schema problem the
 * rules can skip: the installed `supabase-grants-lint` does not match the plugin, so the lint run
 * fails with this message.
 */
export class SnapshotVersionError extends Error {
  override readonly name = 'SnapshotVersionError';
}
