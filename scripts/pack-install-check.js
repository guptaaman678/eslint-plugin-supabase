#!/usr/bin/env node
// CI job "package" (spec §6.9): pack the built tarball, install it into a throwaway project
// alongside ESLint and typescript-eslint, and lint a fixture through it.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// Stub until the peer dependency ranges are final: a placeholder range cannot be installed.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (Object.values(pkg.peerDependencies ?? {}).some((range) => range.startsWith('TODO'))) {
  console.log('pack-check: skipped, peerDependencies are still placeholders');
  process.exit(0);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts });
}

run('npm', ['run', 'build']);
const packOut = run('npm', ['pack', '--json']);
const [{ filename }] = JSON.parse(packOut);
const tarballPath = join(root, filename);

const work = mkdtempSync(join(tmpdir(), 'eslint-plugin-supabase-pack-'));
try {
  writeFileSync(
    join(work, 'package.json'),
    JSON.stringify({ name: 'pack-check', private: true, type: 'module' }, null, 2),
  );
  execFileSync('npm', ['install', tarballPath, 'eslint@10.12.0', 'typescript-eslint@8.71.1'], {
    cwd: work,
    stdio: 'inherit',
  });

  // `recommended` covers TypeScript files and its rules need type information.
  writeFileSync(
    join(work, 'eslint.config.js'),
    [
      "import supabase from 'eslint-plugin-supabase';",
      "import tseslint from 'typescript-eslint';",
      'export default [',
      '  {',
      "    files: ['**/*.ts'],",
      '    languageOptions: {',
      '      parser: tseslint.parser,',
      '      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },',
      '    },',
      '  },',
      '  supabase.configs.recommended,',
      '];',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(work, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['fixture.ts'] }),
  );
  writeFileSync(join(work, 'fixture.ts'), 'export const x: number = 1;\n');

  execFileSync('npx', ['eslint', '--max-warnings', '0', 'fixture.ts'], {
    cwd: work,
    stdio: 'inherit',
  });
  console.log('pack-check: OK');
} finally {
  rmSync(work, { recursive: true, force: true });
  rmSync(tarballPath, { force: true });
}
