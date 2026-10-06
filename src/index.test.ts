import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import plugin from './index.js';

const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name: string; version: string };

describe('plugin object', () => {
  it('exposes meta matching package.json', () => {
    expect(plugin.meta.name).toBe(pkg.name);
    expect(plugin.meta.version).toBe(pkg.version);
    expect(plugin.meta.namespace).toBe('supabase');
  });

  it('exposes a recommended config', () => {
    expect(plugin.configs).toHaveProperty('recommended');
  });
});
