import { readFileSync } from 'node:fs';
import { defineConfig } from 'eslint/config';
import type { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import plugin from '../../src/index.js';
import { IGNORED_FILES, TYPESCRIPT_FILES } from '../../src/configs/recommended.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  name: string;
  version: string;
};

describe('plugin object', () => {
  it('exposes meta matching package.json', () => {
    expect(plugin.meta.name).toBe(pkg.name);
    expect(plugin.meta.version).toBe(pkg.version);
    expect(plugin.meta.namespace).toBe('supabase');
  });

  it('exposes a recommended flat config scoped to TypeScript files', () => {
    const { recommended } = plugin.configs;
    expect(recommended.name).toBe('supabase/recommended');
    expect(recommended.files).toBe(TYPESCRIPT_FILES);
    expect(TYPESCRIPT_FILES).toEqual(['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts']);
    expect(recommended.ignores).toEqual(IGNORED_FILES);
    expect(IGNORED_FILES).toEqual(['**/supabase/functions/**']);
    expect(recommended.plugins?.supabase).toBe(plugin);
  });

  it("is assignable to ESLint's own flat config type", () => {
    const config: Linter.Config = plugin.configs.recommended;
    const configs: Linter.Config[] = defineConfig([plugin.configs.recommended]);
    expect(configs[0]).toEqual(config);
    // typescript-eslint's (deprecated) helper accepts it too.
    expect(tseslint.config(plugin.configs.recommended)[0]).toEqual(config);
  });

  it('turns on every rule of the plugin in recommended, and nothing else', () => {
    const enabled = Object.keys(plugin.configs.recommended.rules ?? {});
    expect(enabled).toEqual(Object.keys(plugin.rules).map((name) => `supabase/${name}`));
  });
});
