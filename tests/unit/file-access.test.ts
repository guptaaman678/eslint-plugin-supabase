import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { resolveClientRoles } from '../../src/roles/resolve.js';
import { grantsLintConfigFiles, readSettings } from '../../src/settings.js';
import { Stats } from '../../src/stats.js';
import { analyzeCall } from '../../src/supabase/calls.js';
import { collect } from '../harness/analyze.js';

/** Every path the plugin's own modules pass to `node:fs` (dependencies are not mocked). */
const touched = vi.hoisted(() => [] as string[]);

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const wrapped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(actual)) {
    wrapped[name] =
      typeof value === 'function' && /^[a-z]/.test(name)
        ? (...args: unknown[]) => {
            if (typeof args[0] === 'string' || args[0] instanceof URL)
              touched.push(String(args[0]));
            return (value as (...a: unknown[]) => unknown)(...args);
          }
        : value;
  }
  return { ...wrapped, default: wrapped };
});

const SECRET_VALUE = 'sb_secret_fromenv';

/** A project with migrations, config, and files the plugin must never read. */
function makeProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'supabase-access-'));
  mkdirSync(path.join(dir, 'supabase', 'migrations'), { recursive: true });
  mkdirSync(path.join(dir, 'src'));
  writeFileSync(path.join(dir, 'package.json'), '{ "grantsLint": { "schemas": ["public"] } }');
  writeFileSync(path.join(dir, 'grants-lint.config.json'), '{}');
  writeFileSync(path.join(dir, 'supabase', 'config.toml'), '[api]\n');
  writeFileSync(path.join(dir, 'supabase', 'migrations', '20260101000000_todos.sql'), '');
  writeFileSync(path.join(dir, '.env'), `SUPABASE_SERVICE_ROLE_KEY=${SECRET_VALUE}\n`);
  writeFileSync(path.join(dir, '.env.local'), `SUPABASE_SECRET_KEY=${SECRET_VALUE}\n`);
  writeFileSync(path.join(dir, 'src', 'db.ts'), 'export {};\n');
  return dir;
}

const project = makeProject();

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
});

const CODE =
  "import { createClient } from '@supabase/supabase-js';\n" +
  "const admin = createClient('http://localhost:54321', process.env.SUPABASE_SERVICE_ROLE_KEY!);\n" +
  "const secret = createClient('http://localhost:54321', 'sb_secret_test');\n" +
  "const browser = createClient('http://localhost:54321', process.env.SUPABASE_ANON_KEY!);\n" +
  "const other = createClient('http://localhost:54321', process.env.SUPABASE_KEY!);\n" +
  "void admin.from('todos').select();\nvoid secret.from('todos').select();\n" +
  "void browser.from('todos').select();\nvoid other.from('todos').select();\n";

describe('file access and key text (G4, G12)', () => {
  it('reads only migrations and config under the project, never .env, and prints no key', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SECRET_VALUE);
    touched.length = 0;

    const settings = readSettings({
      cwd: project,
      settings: {
        supabase: {
          grantsLintConfig: 'grants-lint.config.json',
          clients: [{ module: 'src/**', role: 'service_role' }],
        },
      },
    });
    const configFiles = grantsLintConfigFiles(project, settings.grantsLintConfig);
    const stats = new Stats(path.join(project, 'stats'), 0, () => {});
    const results = collect<TSESTree.CallExpression, unknown>(
      CODE,
      AST_NODE_TYPES.CallExpression,
      (node, { services }) => {
        const call = analyzeCall(services, node);
        if (call === undefined) return undefined;
        const roles = resolveClientRoles(services, call, settings, project);
        stats.recordCall(node, roles.skip);
        return roles;
      },
    );
    stats.recordFile(fileURLToPath(new URL('../fixtures/ts/file.ts', import.meta.url)));
    stats.write();

    const allowed = new Set([
      path.join(project, 'package.json'),
      path.join(project, 'grants-lint.config.json'),
      path.join(project, 'supabase', 'config.toml'),
      `${path.join(project, 'stats')}.0.json`,
    ]);
    const migrations = path.join(project, 'supabase', 'migrations') + path.sep;
    const outside = touched.filter((file) => !allowed.has(file) && !file.startsWith(migrations));
    expect(outside).toEqual([]);
    expect(touched.some((file) => file.includes('.env'))).toBe(false);
    // Control: the mock does see the plugin's reads of config and its stats write.
    expect(touched).toContain(path.join(project, 'package.json'));
    expect(touched).toContain(`${path.join(project, 'stats')}.0.json`);
    expect(configFiles).toHaveLength(2);

    const output = JSON.stringify([results, stats.snapshot()]);
    expect(results).toHaveLength(4);
    expect(output).not.toContain(SECRET_VALUE);
    expect(output).not.toContain('sb_secret_');
    expect(output).not.toContain('SUPABASE_');
    vi.unstubAllEnvs();
  });
});
