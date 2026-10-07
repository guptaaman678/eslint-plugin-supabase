import { writeFileSync } from 'node:fs';
import { threadId } from 'node:worker_threads';
import type { RoleSkipReason } from './roles/resolve.js';
import type { SchemaSkipReason } from './schema/lookup.js';
import type { SkipReason } from './supabase/calls.js';

/** Set to a path to write skip statistics at exit, one file per thread (§6.5, ADR-012). */
export const STATS_ENV = 'ESLINT_PLUGIN_SUPABASE_STATS';

/** Every reason a call site can be skipped. */
export type StatsReason = SkipReason | RoleSkipReason | SchemaSkipReason;

/** The JSON written to `<path>.<threadId>.json`. Summed over threads by the corpus runner. */
export interface StatsSnapshot {
  readonly threadId: number;
  /** Files at least one rule ran on. */
  readonly files: number;
  /** Supabase call sites that at least one rule looked at. */
  readonly calls: number;
  /** Call sites skipped, by reason. A call skipped by two rules for one reason counts once. */
  readonly skips: Readonly<Partial<Record<StatsReason, number>>>;
}

/** Counters for one thread. Rules share one instance, `stats`. */
export class Stats {
  private readonly files = new Set<string>();
  private readonly calls = new WeakMap<object, Set<StatsReason | undefined>>();
  private callCount = 0;
  private readonly skips = new Map<StatsReason, number>();
  private hooked = false;

  /**
   * @param target the `ESLINT_PLUGIN_SUPABASE_STATS` path, or undefined to write nothing.
   * @param thread the worker thread id (0 for the main thread).
   * @param onExit registers a listener for the thread's exit.
   */
  constructor(
    private readonly target: string | undefined,
    private readonly thread: number,
    private readonly onExit: (listener: () => void) => void,
  ) {}

  /** Records that a rule ran on `filename`. */
  recordFile(filename: string): void {
    this.files.add(filename);
    this.hook();
  }

  /**
   * Records a call site (by its AST node, which every rule of a file shares), and the reason it
   * was skipped, if it was.
   */
  recordCall(node: object, skip: StatsReason | undefined): void {
    this.hook();
    let seen = this.calls.get(node);
    if (seen === undefined) {
      seen = new Set();
      this.calls.set(node, seen);
      this.callCount++;
    }
    if (seen.has(skip)) return;
    seen.add(skip);
    if (skip !== undefined) this.skips.set(skip, (this.skips.get(skip) ?? 0) + 1);
  }

  snapshot(): StatsSnapshot {
    const skips: Partial<Record<StatsReason, number>> = {};
    for (const reason of [...this.skips.keys()].sort()) skips[reason] = this.skips.get(reason)!;
    return { threadId: this.thread, files: this.files.size, calls: this.callCount, skips };
  }

  /** The file this thread writes, or undefined when the env var is not set. */
  file(): string | undefined {
    return this.target === undefined ? undefined : `${this.target}.${this.thread}.json`;
  }

  /**
   * Writes the snapshot to `file()`. Called at exit. A thread that linted no file writes nothing,
   * so the main thread under `--concurrency` (whose exit fires last, with zero counts) leaves the
   * workers' files alone (ADR-012).
   */
  write(): void {
    const file = this.file();
    if (file === undefined || this.files.size === 0) return;
    writeFileSync(file, `${JSON.stringify(this.snapshot(), null, 2)}\n`);
  }

  /** Registers the exit write on the first record, so threads that lint nothing never write. */
  private hook(): void {
    if (this.hooked || this.target === undefined) return;
    this.hooked = true;
    this.onExit(() => this.write());
  }
}

function statsTarget(): string | undefined {
  const value = process.env[STATS_ENV];
  return value === undefined || value === '' ? undefined : value;
}

/** This thread's counters. */
export const stats = new Stats(statsTarget(), threadId, (listener) => {
  process.once('exit', listener);
});
