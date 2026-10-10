#!/usr/bin/env node
// CI job "package" (spec §6.9): pack the built tarball, check its entries against the `files`
// allowlist, install it into a throwaway project alongside ESLint, typescript-eslint and
// supabase-js, and lint a fixture app through it.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const env = { ...process.env, NO_COLOR: '1' };

// §6.9, plus `stub/` for the `require` condition that points CommonJS users to `import()` (T3.5).
// npm always adds `package.json`.
const allowedFiles = new Set(['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md']);
const allowedDirs = ['dist/', 'stub/'];
const requiredFiles = [
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'dist/index.js',
  'dist/index.d.ts',
  'stub/require.cjs',
];

// The fixture app is the `web` e2e project; the versions are the ones the repo tests against.
const fixture = join(root, 'tests', 'e2e', 'projects', 'web');
const expected = JSON.parse(
  readFileSync(join(root, 'tests', 'e2e', 'expected', 'web.json'), 'utf8'),
).results;
const installs = [
  'eslint',
  'typescript-eslint',
  '@typescript-eslint/parser',
  'typescript',
  '@supabase/supabase-js',
  '@supabase/ssr',
  '@types/node',
].map((name) => `${name}@${pkg.devDependencies[name]}`);

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', env, ...opts });
}

function fail(message) {
  throw new Error(`pack-check: ${message}`);
}

// `npm pack --json` prints an array with one object per package; find it by shape, not position.
function parsePack(output) {
  const start = output.indexOf('[');
  const parsed = start === -1 ? undefined : JSON.parse(output.slice(start));
  const entry = Array.isArray(parsed)
    ? parsed.find((item) => typeof item?.filename === 'string' && Array.isArray(item?.files))
    : undefined;
  if (!entry) fail(`could not find the pack result in the output of npm pack\n${output}`);
  return entry;
}

run('npm', ['run', 'build']);
const packed = parsePack(run('npm', ['pack', '--json']));
const tarballPath = join(root, packed.filename);

const work = mkdtempSync(join(tmpdir(), 'eslint-plugin-supabase-pack-'));
try {
  const paths = packed.files.map((file) => file.path);
  const extra = paths.filter(
    (path) => !allowedFiles.has(path) && !allowedDirs.some((dir) => path.startsWith(dir)),
  );
  if (extra.length > 0) fail(`files outside the allowlist in the tarball: ${extra.join(', ')}`);
  const missing = requiredFiles.filter((path) => !paths.includes(path));
  if (missing.length > 0) fail(`files missing from the tarball: ${missing.join(', ')}`);
  console.log(
    `pack-check: ${packed.filename}: ${packed.entryCount} files, ` +
      `size ${packed.size} bytes, unpacked ${packed.unpackedSize} bytes`,
  );

  cpSync(fixture, work, { recursive: true });
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarballPath, ...installs],
    { cwd: work, stdio: 'inherit', env },
  );

  // Lint the fixture app through the installed package, as a user's script would.
  cpSync(join(root, 'tests', 'e2e', 'lint-project.mjs'), join(work, 'lint-project.mjs'));
  const linted = JSON.parse(
    execFileSync('node', ['lint-project.mjs'], { cwd: work, env, encoding: 'utf8' }),
  );
  delete linted['lint-project.mjs'];
  if (!isDeepStrictEqual(linted, expected)) {
    fail(
      `the fixture app did not lint as expected\nexpected ${JSON.stringify(expected, null, 2)}\n` +
        `actual ${JSON.stringify(linted, null, 2)}`,
    );
  }
  const reported = Object.values(linted).flat().length;
  console.log(`pack-check: the fixture app reports the expected ${reported} messages`);

  // ADR-016: a CommonJS config exports a Promise of the config; a require() of the plugin fails
  // with a message that shows that form.
  const importForm =
    "module.exports = import('eslint-plugin-supabase').then(({ default: supabase }) => [supabase.configs.recommended]);";
  writeFileSync(join(work, 'promise.cjs'), `${importForm}\n`);
  const target = join('src', 'lib', 'supabase.ts');
  const printed = execFileSync(
    'npx',
    ['eslint', '--config', 'promise.cjs', '--print-config', target],
    { cwd: work, encoding: 'utf8', env },
  );
  if (!printed.includes('supabase/no-unsent-query')) {
    fail('the CommonJS Promise config did not load the plugin');
  }
  writeFileSync(
    join(work, 'require.cjs'),
    "const supabase = require('eslint-plugin-supabase');\nmodule.exports = [supabase.configs.recommended];\n",
  );
  const required = spawnSync(
    'npx',
    ['eslint', '--config', 'require.cjs', '--print-config', target],
    {
      cwd: work,
      encoding: 'utf8',
      env,
    },
  );
  if (required.status === 0 || !required.stderr.includes(importForm)) {
    fail(`require() of the plugin did not fail with the import() form\n${required.stderr}`);
  }
  console.log('pack-check: OK');
} finally {
  rmSync(work, { recursive: true, force: true });
  rmSync(tarballPath, { force: true });
}
