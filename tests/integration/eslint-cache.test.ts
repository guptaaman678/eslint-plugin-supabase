import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'tsup';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsHash } from '../../src/schema/inputs.js';
import { fakeEngine } from '../harness/fake-engine.js';
import { TempProject } from '../harness/temp-project.js';

/**
 * ADR-012 item 5: `eslint --cache` forgets results when a migration or the grants-lint config
 * changes, and keeps them otherwise, also under `--concurrency 2`, where the main thread writes
 * cache entries with its own config's hash and each worker checks them against its own.
 * Every run is a fresh ESLint CLI process, as on the command line.
 */

const ESLINT_BIN = path.join(
  path.dirname(createRequire(import.meta.url).resolve('eslint/package.json')),
  'bin',
  'eslint.js',
);
const PROBE_ENTRY = fileURLToPath(new URL('../harness/probe-plugin.ts', import.meta.url));
const FILES = ['a.js', 'b.js', 'c.js', 'd.js'];

const CONFIGS = {
  withProject:
    "import { plugin, withProject } from './lib/probe-plugin.mjs';\n" +
    'export default [\n' +
    "  withProject({ projectDir: import.meta.dirname, files: ['**/*.js'] }),\n" +
    "  { files: ['**/*.js'], rules: { 'supabase/probe': 'error' } },\n" +
    '];\n',
  recommended:
    "import { recommendedAt } from './lib/probe-plugin.mjs';\n" +
    'export default [\n' +
    "  { ...recommendedAt(import.meta.dirname), files: ['**/*.js'] },\n" +
    "  { files: ['**/*.js'], rules: { 'supabase/probe': 'error' } },\n" +
    '];\n',
};

let bundleDir: TempProject;

beforeAll(async () => {
  bundleDir = new TempProject({});
  // The bundle's package metadata lookup reads `../package.json` from `lib/`, as from `dist/`.
  bundleDir.write(
    'package.json',
    '{ "name": "probe", "version": "0.0.0", "dependencies": { "supabase-grants-lint": "^0.3.0" } }',
  );
  await build({
    entry: { 'probe-plugin': PROBE_ENTRY },
    outDir: path.join(bundleDir.dir, 'lib'),
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    noExternal: [/.*/],
    outExtension: () => ({ js: '.mjs' }),
    config: false,
    dts: false,
    silent: true,
  });
}, 60_000);

afterAll(() => {
  bundleDir.remove();
});

interface LintResult {
  readonly filePath: string;
  readonly messages: readonly { readonly message: string }[];
}

function makeProject(config: string): TempProject {
  const project = new TempProject({ '0001_init.sql': 'create table todos (id int);\n' });
  project.write('package.json', '{ "name": "probe-app", "version": "0.0.0", "type": "module" }');
  project.write('grants-lint.config.json', '{}');
  project.write('eslint.config.mjs', config);
  const bundle = pathToFileURL(path.join(bundleDir.dir, 'lib', 'probe-plugin.mjs')).href;
  project.write('lib/probe-plugin.mjs', `export * from ${JSON.stringify(bundle)};\n`);
  for (const file of FILES) project.write(path.join('src', file), 'export const x = 1;\n');
  return project;
}

/** Thread ids that ran the rule in the last fresh (uncached) results. */
const threads = new Set<string>();

/** Lints the project with the ESLint CLI; returns `hash=... run=...` per file. */
function lint(project: TempProject, concurrency: string, run: string): string[] {
  const result = spawnSync(
    process.execPath,
    [ESLINT_BIN, '--cache', '--concurrency', concurrency, '--format', 'json', 'src'],
    { cwd: project.dir, env: { ...process.env, PROBE_RUN: run }, encoding: 'utf8' },
  );
  expect(result.status, result.stderr).toBe(1);
  const results = JSON.parse(result.stdout) as LintResult[];
  expect(results.map((r) => path.basename(r.filePath)).sort()).toEqual(FILES);
  return results.map((r) => {
    const [message] = r.messages.map((m) => m.message);
    const [, label, thread] = /^(.* run=\w+) thread=(\d+)$/.exec(message ?? '') ?? [];
    if (label?.endsWith(`run=${run}`) === true) threads.add(thread!);
    return label ?? `unexpected: ${message}`;
  });
}

function only(messages: string[]): string {
  const distinct = [...new Set(messages)];
  expect(distinct).toHaveLength(1);
  return distinct[0]!;
}

const cases = [
  ['withProject', 'off'],
  ['withProject', '2'],
  ['recommended', '2'],
] as const;

describe.each(cases)('eslint --cache with %s, --concurrency %s', (mode, concurrency) => {
  it('re-lints after a migration or grants-lint config edit, and only then', () => {
    const project = makeProject(CONFIGS[mode]);
    threads.clear();
    try {
      const engine = fakeEngine('0.3.0');
      const expected = () => migrationsHash(engine, { projectDir: project.dir });

      const h1 = expected();
      expect(only(lint(project, concurrency, 'a'))).toBe(`hash=${h1} run=a`);
      // Nothing changed: every thread computes the same hash, so every file is a cache hit.
      expect(only(lint(project, concurrency, 'b'))).toBe(`hash=${h1} run=a`);

      project.migration('0001_init.sql', 'create table todos (id bigint);\n');
      const h2 = expected();
      expect(h2).not.toBe(h1);
      expect(only(lint(project, concurrency, 'c'))).toBe(`hash=${h2} run=c`);
      expect(only(lint(project, concurrency, 'd'))).toBe(`hash=${h2} run=c`);

      project.write('grants-lint.config.json', '{ "since": "auto" }');
      const h3 = expected();
      expect(new Set([h1, h2, h3]).size).toBe(3);
      expect(only(lint(project, concurrency, 'e'))).toBe(`hash=${h3} run=e`);
      expect(only(lint(project, concurrency, 'f'))).toBe(`hash=${h3} run=e`);

      // Control: with `--concurrency 2` the full re-lints ran in two worker threads, never in
      // the main thread.
      expect([...threads].sort()).toEqual(concurrency === 'off' ? ['0'] : ['1', '2']);

      // An unrelated source edit re-lints only that file.
      project.write('src/a.js', 'export const x = 2;\n');
      const labels = lint(project, concurrency, 'g').map((m) => m.slice(-1));
      expect(labels.sort()).toEqual(['e', 'e', 'e', 'g']);
    } finally {
      project.remove();
    }
  }, 120_000);
});
