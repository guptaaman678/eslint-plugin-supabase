import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const IMPORT_FORM =
  "module.exports = import('eslint-plugin-supabase').then(({ default: supabase }) => [supabase.configs.recommended]);";

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ESLINT_BIN = path.join(
  path.dirname(createRequire(import.meta.url).resolve('eslint/package.json')),
  'bin',
  'eslint.js',
);

describe('require() of the plugin', () => {
  it('fails with a message pointing to the import() form (package self-reference)', () => {
    const load = () => createRequire(import.meta.url)('eslint-plugin-supabase') as unknown;
    expect(load).toThrow(IMPORT_FORM);
    expect(load).toThrow(expect.objectContaining({ code: 'ERR_REQUIRE_ASYNC_MODULE' }));
  });

  it('fails an ESLint run whose CommonJS config requires it, with that message', () => {
    const config = fileURLToPath(new URL('../fixtures/configs/require.cjs', import.meta.url));
    const file = fileURLToPath(new URL('../fixtures/ts/file.ts', import.meta.url));
    const result = spawnSync(
      process.execPath,
      [ESLINT_BIN, '--config', config, '--print-config', file],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(IMPORT_FORM);
  });
});
