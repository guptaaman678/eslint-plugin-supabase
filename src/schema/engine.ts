import * as grantsLint from 'supabase-grants-lint/engine';
import { ENGINE_RANGE, PACKAGE_NAME } from '../meta.js';
import { SnapshotCache } from './cache.js';
import type { Engine, ReplayInputs, ReplayProjectOptions } from './engine-api.js';
import {
  SNAPSHOT_VERSION,
  SnapshotVersionError,
  type Membership,
  type SchemaSnapshot,
} from './snapshot.js';

/** The part of `supabase-grants-lint/engine` the plugin uses (ADR-017 §2). */
export interface EngineModule {
  readonly version: string;
  loadEngine(): Promise<void>;
  listReplayInputs(options: ReplayProjectOptions): ReplayInputs;
  replayProjectSync(options: ReplayProjectOptions): { readonly snapshotVersion: number };
  publicationMembership(snapshot: never, pub: string, schema: string, name: string): Membership;
}

// The engine's own snapshot type and the plugin's copy of the contract must stay the same shape.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameSnapshot: Same<grantsLint.SchemaSnapshot, SchemaSnapshot> = true;
void sameSnapshot;

/** Refuses a snapshot the plugin cannot read, with a message that says what to install. */
export function checkSnapshot(
  snapshot: { readonly snapshotVersion: number },
  engineVersion: string,
): SchemaSnapshot {
  if (snapshot.snapshotVersion !== SNAPSHOT_VERSION) {
    throw new SnapshotVersionError(
      `${PACKAGE_NAME} reads schema snapshot version ${SNAPSHOT_VERSION}, but ` +
        `supabase-grants-lint ${engineVersion} returned version ${String(snapshot.snapshotVersion)}. ` +
        `Install supabase-grants-lint ${ENGINE_RANGE}, the range ${PACKAGE_NAME} depends on.`,
    );
  }
  return snapshot as SchemaSnapshot;
}

/** The engine module as the schema layer's `Engine`, with the snapshot version checked. */
export function adaptEngine(module: EngineModule): Engine {
  return {
    version: module.version,
    listReplayInputs: (options) => module.listReplayInputs(options),
    replayProjectSync: (options) =>
      checkSnapshot(module.replayProjectSync(options), module.version),
    publicationMembership: (snapshot, pub, schema, name) =>
      module.publicationMembership(snapshot as never, pub, schema, name),
  };
}

/** `supabase-grants-lint/engine`. Replays need `loadEngine()` first (the entry module awaits it). */
export const engine: Engine = adaptEngine(grantsLint);

/** Loads the engine's SQL parser once (ADR-016 (a')). */
export const loadEngine = (): Promise<void> => grantsLint.loadEngine();

/** This thread's snapshots, one per project (ADR-012). Every rule shares it. */
export const snapshotCache = new SnapshotCache(engine);
