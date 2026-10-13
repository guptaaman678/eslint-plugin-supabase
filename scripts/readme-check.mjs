#!/usr/bin/env node
// `npm run readme:check`: follow the README's quick start in a fresh project with the packed
// tarball. The project gets only what the README assumes the reader already has (a package, a
// `tsconfig.json`, `@supabase/supabase-js`); every other step is a code block of the README, run
// or written as it stands. The documented lint output must appear in the real one.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env, NO_COLOR: '1' };
const readme = readFileSync(join(root, 'README.md'), 'utf8');

function fail(message) {
  throw new Error(`readme-check: ${message}`);
}

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', env });
}

// Fenced blocks as { lang, body }.
const blocks = [...readme.matchAll(/^```(\w*)\n([\s\S]*?)^```$/gm)].map((match) => ({
  lang: match[1],
  body: match[2],
}));

function block(description, predicate) {
  const found = blocks.filter(predicate);
  if (found.length !== 1)
    fail(`expected one README block with ${description}, found ${found.length}`);
  return found[0].body;
}

// A block whose first line is `// <path>` is a file the reader writes.
function fileBlock(lang, path) {
  const body = block(`\`// ${path}\``, (b) => b.lang === lang && b.body.startsWith(`// ${path}\n`));
  return { path, body };
}

// Split a one-line shell command into arguments (double quotes only, as the README uses).
function shellWords(line) {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2]);
}

const installLine = block('the npm install command', (b) =>
  b.body.startsWith('npm install --save-dev eslint-plugin-supabase '),
).trim();
const lintLine = block(
  'the lint command',
  (b) => b.lang === 'sh' && b.body.trim() === 'npx eslint .',
).trim();
const config = fileBlock('js', 'eslint.config.mjs');
const source = fileBlock('ts', 'src/todos.ts');
const expectedOutput = block('the lint output', (b) => b.lang === 'text')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const packOutput = run('npm', ['pack', '--json'], root);
const packed = JSON.parse(packOutput.slice(packOutput.indexOf('['))).find(
  (item) => typeof item?.filename === 'string' && Array.isArray(item?.files),
);
if (!packed) fail(`no pack result in the output of npm pack\n${packOutput}`);
const tarball = join(root, packed.filename);

const work = mkdtempSync(join(tmpdir(), 'eslint-plugin-supabase-readme-'));
try {
  // What the README assumes.
  writeFileSync(
    join(work, 'package.json'),
    `${JSON.stringify({ name: 'readme-app', version: '1.0.0', private: true }, null, 2)}\n`,
  );
  writeFileSync(
    join(work, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'es2022',
          module: 'nodenext',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ['src'],
      },
      null,
      2,
    )}\n`,
  );
  run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '@supabase/supabase-js'],
    work,
  );

  // The README's steps. The install installs the packed tarball in place of the registry package.
  const [npm, ...args] = shellWords(installLine);
  if (npm !== 'npm') fail(`the install command does not start with npm: ${installLine}`);
  const installArgs = args.map((arg) => (arg === 'eslint-plugin-supabase' ? tarball : arg));
  run(npm, [...installArgs, '--ignore-scripts', '--no-audit', '--no-fund'], work);
  for (const file of [config, source]) {
    mkdirSync(dirname(join(work, file.path)), { recursive: true });
    writeFileSync(join(work, file.path), file.body);
  }
  const [npx, ...lintArgs] = shellWords(lintLine);
  const lint = spawnSync(npx, lintArgs, { cwd: work, encoding: 'utf8', env });
  const output = `${lint.stdout}${lint.stderr}`;
  console.log(output.trim());

  if (lint.status !== 1) fail(`\`${lintLine}\` exited ${lint.status}, expected 1 (an error found)`);
  const lines = output.split('\n').map((line) => line.trim().replace(/\s+/g, ' '));
  for (const want of expectedOutput) {
    if (!lines.includes(want.replace(/\s+/g, ' '))) {
      fail(`the README's output line is not in the real output: ${want}`);
    }
  }
  const versions = JSON.parse(run('npm', ['ls', '--json', '--depth', '0'], work)).dependencies;
  const installed = Object.entries(versions)
    .map(([name, info]) => `${name}@${info.version}`)
    .join(', ');
  console.log(`readme-check: installed ${installed}`);
  console.log(`readme-check: OK (${expectedOutput.length} documented line(s) found)`);
} finally {
  rmSync(work, { recursive: true, force: true });
  rmSync(tarball, { force: true });
}
