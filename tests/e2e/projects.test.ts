import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'tsup';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StatsSnapshot } from '../../src/stats.js';

/**
 * Spec §6.10: whole synthetic projects in `tests/e2e/projects/`, each linted through the ESLint
 * Node API in its own process (`lint-project.mjs`) with the project as the working directory,
 * with exact expected messages (`tests/e2e/expected/<project>.json`) and the stats file the
 * plugin writes when `ESLINT_PLUGIN_SUPABASE_STATS` is set.
 *
 * Each project's `eslint.config.mjs` imports `eslint-plugin-supabase` by name. `beforeAll`
 * installs a fresh build of `src/` as `tests/e2e/projects/node_modules/eslint-plugin-supabase`
 * (git-ignored), laid out as npm installs the package; its dependencies, and the TypeScript and
 * supabase-js the projects type-check against, resolve from the repository's `node_modules`.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const E2E = path.join(ROOT, 'tests', 'e2e');
const PROJECTS = path.join(E2E, 'projects');
const INSTALLED = path.join(PROJECTS, 'node_modules', 'eslint-plugin-supabase');
const RUNNER = path.join(E2E, 'lint-project.mjs');

interface Message {
  readonly line: number;
  readonly column: number;
  readonly ruleId: string | null;
  readonly severity: number;
  readonly message: string;
}

interface Expected {
  /** Every linted file, relative to the project, and its messages in order. */
  readonly results: Readonly<Record<string, readonly Message[]>>;
  /** The stats files' counts, summed over threads. */
  readonly stats: Omit<StatsSnapshot, 'threadId'>;
}

beforeAll(async () => {
  rmSync(INSTALLED, { recursive: true, force: true });
  mkdirSync(INSTALLED, { recursive: true });
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
    dependencies: Record<string, string>;
  };
  writeFileSync(
    path.join(INSTALLED, 'package.json'),
    `${JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        type: 'module',
        exports: { '.': './dist/index.js' },
        dependencies: pkg.dependencies,
      },
      null,
      2,
    )}\n`,
  );
  await build({
    entry: { index: path.join(ROOT, 'src', 'index.ts') },
    outDir: path.join(INSTALLED, 'dist'),
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    config: false,
    dts: false,
    silent: true,
  });
}, 60_000);

afterAll(() => {
  rmSync(INSTALLED, { recursive: true, force: true });
});

interface Run {
  readonly results: Expected['results'];
  readonly threads: readonly number[];
  readonly stats: Expected['stats'];
}

/** Lints `project` in a fresh process and collects its results and stats files. */
function lintProject(project: string, concurrency: string): Run {
  const statsDir = mkdtempSync(path.join(tmpdir(), 'supabase-e2e-stats-'));
  try {
    const result = spawnSync(process.execPath, [RUNNER, concurrency], {
      cwd: path.join(PROJECTS, project),
      env: {
        ...process.env,
        NO_COLOR: '1',
        ESLINT_PLUGIN_SUPABASE_STATS: path.join(statsDir, 'stats'),
      },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    const snapshots = readdirSync(statsDir)
      .sort()
      .map((file) => JSON.parse(readFileSync(path.join(statsDir, file), 'utf8')) as StatsSnapshot);
    const skips: Record<string, number> = {};
    for (const snapshot of snapshots) {
      for (const [reason, count] of Object.entries(snapshot.skips)) {
        skips[reason] = (skips[reason] ?? 0) + count;
      }
    }
    return {
      results: JSON.parse(result.stdout) as Expected['results'],
      threads: snapshots.map((snapshot) => snapshot.threadId),
      stats: {
        files: snapshots.reduce((sum, snapshot) => sum + snapshot.files, 0),
        calls: snapshots.reduce((sum, snapshot) => sum + snapshot.calls, 0),
        skips: Object.fromEntries(Object.entries(skips).sort(([a], [b]) => a.localeCompare(b))),
      },
    };
  } finally {
    rmSync(statsDir, { recursive: true, force: true });
  }
}

const SUITES = [
  ['web', '2'],
  ['mobile', 'off'],
  ['monorepo', '2'],
  ['baseline', 'off'],
  ['quickstart', 'off'],
] as const;

describe.each(SUITES)('e2e project %s (concurrency %s)', (project, concurrency) => {
  it('reports exactly the expected messages and writes the expected stats', () => {
    const expected = JSON.parse(
      readFileSync(path.join(E2E, 'expected', `${project}.json`), 'utf8'),
    ) as Expected;
    const run = lintProject(project, concurrency);

    expect(run.results).toEqual(expected.results);
    expect(run.stats).toEqual(expected.stats);
    // One stats file per thread that linted a file: the main thread without workers, and only
    // worker threads (never the idle main thread) with them.
    if (concurrency === 'off') {
      expect(run.threads).toEqual([0]);
    } else {
      expect(run.threads.length).toBeGreaterThan(0);
      expect(run.threads.every((thread) => thread > 0)).toBe(true);
    }
  }, 120_000);
});
