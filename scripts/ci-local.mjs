#!/usr/bin/env node
// Run every command of the CI jobs (`.github/workflows/ci.yml`) on this machine, one after the
// other, and print one PASS or FAIL line per step. While the repo is private, push and PR CI runs
// only the ubuntu legs, so this is how a change is checked on the rest (CONTRIBUTING, "Local CI").
//
//   node scripts/ci-local.mjs                 every step, then the 12 compat cells
//   node scripts/ci-local.mjs --skip-compat   every step except the compat cells
//
// Steps run in CI order and a failed step does not stop the later ones. Exit code 1 if any step
// failed. This covers one OS and one Node version: the one running the script.
import { spawnSync } from 'node:child_process';
import { arch, platform, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));

const { values } = parseArgs({ options: { 'skip-compat': { type: 'boolean', default: false } } });

// Job "test", then job "package".
const steps = [
  ['npm ci', 'npm', ['ci']],
  ['format:check', 'npm', ['run', 'format:check']],
  ['lint', 'npm', ['run', 'lint']],
  ['typecheck', 'npm', ['run', 'typecheck']],
  ['build', 'npm', ['run', 'build']],
  ['demo check', 'node', ['media/demo/check.mjs']],
  ['test:coverage', 'npm', ['run', 'test:coverage']],
  ['docs:check', 'npm', ['run', 'docs:check']],
  ['pack-check', 'npm', ['run', 'pack-check']],
];

// Job "compat": the same matrix as ci.yml.
if (!values['skip-compat']) {
  const supabase = [
    { js: '^2', ssr: 'latest' },
    { js: '2.58.0', ssr: '0.7.0' },
  ];
  for (const eslint of ['9.15.0', '9.39.5', '^10']) {
    for (const typescript of ['5.8.2', '<6.1']) {
      for (const { js, ssr } of supabase) {
        steps.push([
          `compat (eslint ${eslint}, typescript ${typescript}, supabase-js ${js})`,
          'node',
          [
            'scripts/compat-check.mjs',
            '--eslint',
            eslint,
            '--typescript',
            typescript,
            '--supabase-js',
            js,
            '--ssr',
            ssr,
          ],
        ]);
      }
    }
  }
}

const results = [];
for (const [name, command, args] of steps) {
  console.log(`\n=== ${name}: ${command} ${args.join(' ')}`);
  const started = Date.now();
  const { status, error } = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NO_COLOR: '1' },
    // npm is a .cmd file on Windows. Only npm goes through the shell: `<6.1` would be a redirect.
    shell: command === 'npm' && platform() === 'win32',
  });
  const ok = status === 0 && error === undefined;
  results.push({ name, ok, seconds: ((Date.now() - started) / 1000).toFixed(1) });
}

console.log(`\nci-local on ${platform()} ${release()} ${arch()}, Node ${process.versions.node}`);
for (const { name, ok, seconds } of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} (${seconds} s)`);
}
const failed = results.filter((result) => !result.ok).length;
console.log(
  failed === 0
    ? `ci-local: all ${results.length} steps passed`
    : `ci-local: ${failed} of ${results.length} steps failed`,
);
if (values['skip-compat']) console.log('ci-local: compat cells skipped (--skip-compat)');
process.exit(failed === 0 ? 0 : 1);
