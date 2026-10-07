import type { Membership, SchemaSnapshot } from './snapshot.js';

/** What the schema layer needs from `supabase-grants-lint/engine` (ADR-017 §2). */
export interface ReplayProjectOptions {
  /** Absolute project directory: where the config and migrations are looked up. */
  readonly projectDir: string;
  /** A config file to read instead of grants-lint's own lookup. */
  readonly configFile?: string;
}

export interface ReplayInputs {
  readonly projectDir: string;
  /** The config file with the highest precedence (absolute), or `null` for the defaults. */
  readonly configFile: string | null;
  /** Absolute paths, in replay order. */
  readonly migrations: readonly string[];
}

/**
 * The engine functions the cache, the view and `migrationsHash` call. The real engine is
 * adapted in `engine.ts`; tests pass fakes.
 */
export interface Engine {
  /** grants-lint's version, part of `migrationsHash`. */
  readonly version: string;
  /** The files a replay reads, without the parser. Throws on a bad config or project. */
  listReplayInputs(options: ReplayProjectOptions): ReplayInputs;
  /** Replays the migrations. Throws on a bad config or project, never on SQL. */
  replayProjectSync(options: ReplayProjectOptions): SchemaSnapshot;
  /** Membership of a table in a publication, from the snapshot alone (ADR-017 §3). */
  readonly publicationMembership: MembershipFunction;
}

export type MembershipFunction = (
  snapshot: SchemaSnapshot,
  pub: string,
  schema: string,
  name: string,
) => Membership;
