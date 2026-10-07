import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { grantsLintConfigFiles } from '../settings.js';
import type { Engine, ReplayProjectOptions } from './engine-api.js';

/** The files a replay reads, or why they cannot be listed (a bad config or project). */
export type WatchedInputs =
  | { readonly files: readonly string[]; readonly error?: undefined }
  | { readonly files?: undefined; readonly error: string };

/**
 * Every file the replay of a project depends on: the migrations grants-lint would read (from the
 * engine, so a custom `migrations` setting or glob is honoured), then every grants-lint config
 * layer (`package.json#grantsLint`, `grants-lint.config.json`, an explicit config file).
 */
export function watchedInputs(engine: Engine, options: ReplayProjectOptions): WatchedInputs {
  let listed;
  try {
    listed = engine.listReplayInputs(options);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  const files = [
    ...listed.migrations,
    ...grantsLintConfigFiles(options.projectDir, options.configFile),
  ];
  if (listed.configFile !== null) files.push(listed.configFile);
  return { files: [...new Set(files)] };
}

/** A path relative to the project with `/` separators, the same on every OS. */
function relative(projectDir: string, file: string): string {
  return path.relative(projectDir, file).split(path.sep).join('/');
}

/**
 * The listing, sizes and modification times of the inputs, one line per file. Cheap (one `stat`
 * per file) and deterministic, so every thread computes the same value.
 */
export function inputsFingerprint(projectDir: string, inputs: WatchedInputs): string {
  if (inputs.error !== undefined) return `error\t${inputs.error}`;
  return inputs.files
    .map((file) => {
      const stat = statSync(file, { throwIfNoEntry: false });
      const state = stat === undefined ? 'missing' : `${stat.size}\t${stat.mtimeMs}`;
      return `${relative(projectDir, file)}\t${state}`;
    })
    .join('\n');
}

/** A hash of the inputs' names and contents, computed only when the fingerprint changes. */
export function inputsContentHash(projectDir: string, inputs: WatchedInputs): string {
  const hash = createHash('sha256');
  if (inputs.error !== undefined) return hash.update(`error\t${inputs.error}`).digest('hex');
  for (const file of inputs.files) {
    hash.update(`${relative(projectDir, file)}\u0000`);
    try {
      hash.update(readFileSync(file));
    } catch {
      hash.update('missing');
    }
    hash.update('\u0000');
  }
  return hash.digest('hex');
}

/**
 * `settings.supabase.migrationsHash` (§6.4, ADR-012): changes whenever ESLint's `--cache` must
 * forget results that depend on the schema. It covers migration names, sizes and modification
 * times, the grants-lint config layers and the engine version, and nothing that differs between
 * threads or runs, so the main thread and every `--concurrency` worker agree.
 */
export function migrationsHash(engine: Engine, options: ReplayProjectOptions): string {
  const fingerprint = inputsFingerprint(options.projectDir, watchedInputs(engine, options));
  return createHash('sha256').update(`engine\t${engine.version}\n${fingerprint}`).digest('hex');
}
