import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'eslint/config';
import type { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it, vi } from 'vitest';
import plugin from '../../src/index.js';
import { IGNORED_FILES, TYPESCRIPT_FILES } from '../../src/configs/recommended.js';
import { engine } from '../../src/schema/engine.js';
import { migrationsHash } from '../../src/schema/inputs.js';
import { schemaFixture } from '../harness/rule-tester.js';

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

  it('builds recommended at each evaluation, with the hash of the project at the working directory', () => {
    const projectDir = schemaFixture('basic');
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);
    try {
      expect(plugin.configs.recommended.settings).toEqual({
        supabase: { migrationsHash: migrationsHash(engine, { projectDir }) },
      });
      cwd.mockReturnValue(path.join(projectDir, 'supabase'));
      expect(plugin.configs.recommended.settings?.supabase).toBeDefined();
      cwd.mockReturnValue(path.parse(projectDir).root);
      expect(plugin.configs.recommended.settings).toBeUndefined();
    } finally {
      cwd.mockRestore();
    }
  });

  it('carries the withProject helper, backed by the real engine', () => {
    const projectDir = path.relative(process.cwd(), schemaFixture('rls'));
    const config = plugin.withProject({ projectDir });
    expect(config.plugins?.supabase).toBe(plugin);
    expect(config.settings).toEqual({
      supabase: {
        projectDir,
        migrationsHash: migrationsHash(engine, { projectDir: schemaFixture('rls') }),
      },
    });
  });
});
