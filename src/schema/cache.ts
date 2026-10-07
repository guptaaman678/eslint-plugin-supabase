import type { Engine, ReplayProjectOptions } from './engine-api.js';
import { inputsContentHash, inputsFingerprint, watchedInputs } from './inputs.js';
import { createSchemaView, type SchemaView } from './view.js';

/** How long a checked snapshot is used without looking at the files again (§6.4). */
export const FRESHNESS_MS = 250;

/** A project's schema, or the error its replay threw (a bad config or project). */
export type CacheResult =
  | { readonly view: SchemaView; readonly error?: undefined }
  | { readonly view?: undefined; readonly error: unknown };

interface Entry {
  checkedAt: number;
  fingerprint: string;
  readonly contentHash: string;
  readonly result: CacheResult;
}

/**
 * One snapshot per project directory (and config file) for this thread (§6.4, ADR-012). Before a
 * use, at most once per `FRESHNESS_MS`, it compares the inputs' listing, sizes and modification
 * times. When they changed, it hashes the contents, and rebuilds only if the hash changed too.
 */
export class SnapshotCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly engine: Engine,
    private readonly now: () => number = Date.now,
  ) {}

  get(options: ReplayProjectOptions): CacheResult {
    const key = `${options.projectDir}\u0000${options.configFile ?? ''}`;
    const entry = this.entries.get(key);
    const now = this.now();
    if (entry !== undefined && now - entry.checkedAt < FRESHNESS_MS) return entry.result;

    const inputs = watchedInputs(this.engine, options);
    const fingerprint = inputsFingerprint(options.projectDir, inputs);
    if (entry !== undefined) {
      entry.checkedAt = now;
      if (fingerprint === entry.fingerprint) return entry.result;
    }
    const contentHash = inputsContentHash(options.projectDir, inputs);
    if (entry !== undefined && contentHash === entry.contentHash) {
      entry.fingerprint = fingerprint;
      return entry.result;
    }
    const result = this.build(options);
    this.entries.set(key, { checkedAt: now, fingerprint, contentHash, result });
    return result;
  }

  private build(options: ReplayProjectOptions): CacheResult {
    try {
      const snapshot = this.engine.replayProjectSync(options);
      return { view: createSchemaView(snapshot, this.engine.publicationMembership) };
    } catch (error) {
      return { error };
    }
  }
}
