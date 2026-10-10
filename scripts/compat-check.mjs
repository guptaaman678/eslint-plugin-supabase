#!/usr/bin/env node
// CI job "compat" (spec T5.4): install the packed plugin into a throwaway project with one
// combination of ESLint, TypeScript and supabase-js from the ends of the supported ranges
// (ADR-011, ADR-002, ADR-003), lint the e2e projects there and compare every message and the
// stats with `tests/e2e/expected/`.
//
//   node scripts/compat-check.mjs --eslint 9.15.0 --typescript 5.8.2 \
//     --supabase-js 2.58.0 --ssr 0.7.0
//
// `--ssr` is the `@supabase/ssr` the projects import: the newest one whose peer range admits the
// supabase-js under test (0.12.x needs supabase-js 2.114.0 or later).
import { execFileSync, spawnSync } from 'node:child_process';
import { deepStrictEqual } from 'node:assert/strict';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const e2e = join(root, 'tests', 'e2e');
const PROJECTS = ['web', 'mobile', 'monorepo', 'baseline'];

const { values } = parseArgs({
  options: {
    eslint: { type: 'string' },
    typescript: { type: 'string' },
    'supabase-js': { type: 'string' },
    ssr: { type: 'string' },
  },
});
for (const name of ['eslint', 'typescript', 'supabase-js', 'ssr']) {
  if (values[name] === undefined) {
    console.error(`compat-check: --${name} <version or range> is required`);
    process.exit(2);
  }
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const devParser = readJson(join(root, 'package.json')).devDependencies['@typescript-eslint/parser'];

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
const [{ filename }] = JSON.parse(
  execFileSync('npm', ['pack', '--json'], { cwd: root, encoding: 'utf8' }),
);
const tarball = join(root, filename);

const work = mkdtempSync(join(tmpdir(), 'eslint-plugin-supabase-compat-'));
let failed = 0;
try {
  writeFileSync(
    join(work, 'package.json'),
    `${JSON.stringify({ name: 'compat-check', private: true, type: 'module' }, null, 2)}\n`,
  );
  // The projects sit below the install, so they resolve every package from it.
  for (const project of PROJECTS) {
    cpSync(join(e2e, 'projects', project), join(work, 'projects', project), {
      recursive: true,
      filter: (source) => !source.includes('node_modules'),
    });
  }
  cpSync(join(e2e, 'lint-project.mjs'), join(work, 'lint-project.mjs'));

  // Peer conflicts are failures here: no --legacy-peer-deps, no --force.
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      tarball,
      `eslint@${values.eslint}`,
      `typescript@${values.typescript}`,
      `@typescript-eslint/parser@${devParser}`,
      `@supabase/supabase-js@${values['supabase-js']}`,
      `@supabase/ssr@${values.ssr}`,
    ],
    { cwd: work, stdio: 'inherit' },
  );

  const installed = (name) => readJson(join(work, 'node_modules', name, 'package.json')).version;
  const versions = Object.fromEntries(
    [
      'eslint',
      'typescript',
      '@typescript-eslint/parser',
      '@typescript-eslint/utils',
      '@supabase/supabase-js',
      '@supabase/ssr',
      'supabase-grants-lint',
    ].map((name) => [name, installed(name)]),
  );
  console.log(`compat-check: installed ${JSON.stringify(versions)}`);

  for (const project of PROJECTS) {
    const expected = readJson(join(e2e, 'expected', `${project}.json`));
    const statsDir = join(work, 'stats', project);
    mkdirSync(statsDir, { recursive: true });
    const run = spawnSync(process.execPath, [join(work, 'lint-project.mjs'), 'off'], {
      cwd: join(work, 'projects', project),
      env: { ...process.env, NO_COLOR: '1', ESLINT_PLUGIN_SUPABASE_STATS: join(statsDir, 'stats') },
      encoding: 'utf8',
    });
    try {
      if (run.status !== 0) throw new Error(`lint exited ${run.status}\n${run.stderr}`);
      const snapshots = readdirSync(statsDir).map((file) => readJson(join(statsDir, file)));
      const skips = {};
      for (const snapshot of snapshots) {
        for (const [reason, count] of Object.entries(snapshot.skips)) {
          skips[reason] = (skips[reason] ?? 0) + count;
        }
      }
      deepStrictEqual(JSON.parse(run.stdout), expected.results);
      deepStrictEqual(
        {
          files: snapshots.reduce((sum, snapshot) => sum + snapshot.files, 0),
          calls: snapshots.reduce((sum, snapshot) => sum + snapshot.calls, 0),
          skips,
        },
        expected.stats,
      );
      const count = Object.values(expected.results).flat().length;
      console.log(`compat-check: PASS ${project} (${count} messages)`);
    } catch (error) {
      failed += 1;
      console.log(`compat-check: FAIL ${project}\n${error.message}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
  rmSync(tarball, { force: true });
}

console.log(
  failed === 0
    ? `compat-check: OK, ${PROJECTS.length} projects`
    : `compat-check: ${failed} of ${PROJECTS.length} projects failed`,
);
process.exit(failed === 0 ? 0 : 1);
