import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLES,
  GRANTS_LINT_KEYS,
  grantsLintConfigFiles,
  parseSettings,
  readSettings,
  SettingsError,
} from '../../src/settings.js';
import { schemaFixture } from '../harness/rule-tester.js';

const cwd = path.resolve('/work/app');
const basic = schemaFixture('basic');

function errorOf(raw: unknown, base = cwd): SettingsError {
  try {
    parseSettings(raw, base);
  } catch (error) {
    if (error instanceof SettingsError) return error;
    throw error;
  }
  throw new Error('expected a SettingsError');
}

describe('parseSettings defaults', () => {
  it('applies the defaults when settings.supabase is absent or empty', () => {
    const expected = {
      projectDir: undefined,
      grantsLintConfig: undefined,
      clients: [],
      defaultRoles: DEFAULT_ROLES,
      unknownKey: 'default',
      migrationsHash: undefined,
    };
    expect(parseSettings(undefined, cwd)).toEqual(expected);
    expect(parseSettings({}, cwd)).toEqual(expected);
    expect(DEFAULT_ROLES).toEqual(['anon', 'authenticated']);
  });

  it('resolves paths against the working directory', () => {
    const settings = parseSettings(
      { projectDir: '../db', grantsLintConfig: path.join(basic, 'grants-lint.config.json') },
      cwd,
    );
    expect(settings.projectDir).toBe(path.resolve('/work/db'));
    expect(settings.grantsLintConfig).toBe(path.join(basic, 'grants-lint.config.json'));
    expect(
      parseSettings({ grantsLintConfig: 'grants-lint.config.json' }, basic).grantsLintConfig,
    ).toBe(path.join(basic, 'grants-lint.config.json'));
  });

  it('keeps every valid value', () => {
    const settings = parseSettings(
      {
        clients: [
          { module: 'src/lib/admin.ts', role: 'service_role' },
          { callee: 'createBrowserClient', role: ['anon', 'authenticated'] },
          { module: 'src/server/**', callee: 'createServerClient', role: 'authenticated' },
        ],
        defaultRoles: ['authenticated'],
        unknownKey: 'skip',
        migrationsHash: 'abc123',
      },
      cwd,
    );
    expect(settings.clients).toEqual([
      { module: 'src/lib/admin.ts', roles: ['service_role'] },
      { callee: 'createBrowserClient', roles: ['anon', 'authenticated'] },
      { module: 'src/server/**', callee: 'createServerClient', roles: ['authenticated'] },
    ]);
    expect(settings.defaultRoles).toEqual(['authenticated']);
    expect(settings.unknownKey).toBe('skip');
    expect(settings.migrationsHash).toBe('abc123');
    expect(parseSettings({ defaultRoles: 'service_role' }, cwd).defaultRoles).toEqual([
      'service_role',
    ]);
  });
});

describe('parseSettings errors name the key', () => {
  it.each([
    [null, '', 'invalid settings.supabase: expected an object, got null'],
    [['x'], '', 'expected an object, got an array'],
    [{ projectdir: '.' }, 'projectdir', 'is not a known setting. Did you mean "projectDir"?'],
    [{ defaultRole: 'anon' }, 'defaultRole', 'Did you mean "defaultRoles"?'],
    [{ colour: 'red' }, 'colour', 'is not a known setting.'],
    [{ projectDir: '' }, 'projectDir', 'expected a non-empty string, got ""'],
    [{ projectDir: 3 }, 'projectDir', 'expected a non-empty string, got a number'],
    [{ grantsLintConfig: 'missing.json' }, 'grantsLintConfig', 'file not found'],
    [{ grantsLintConfig: '.' }, 'grantsLintConfig', 'file not found'],
    [{ clients: {} }, 'clients', 'expected an array, got an object'],
    [{ clients: [undefined] }, 'clients[0]', 'expected an object, got undefined'],
    [{ clients: ['x'] }, 'clients[0]', 'expected an object, got "x"'],
    [{ clients: [{ role: 'anon' }] }, 'clients[0]', 'needs `module` or `callee`'],
    [{ clients: [{ callee: 'f' }] }, 'clients[0].role', 'is required'],
    [{ clients: [{ callee: 'f', roles: 'anon' }] }, 'clients[0].roles', 'Did you mean "role"?'],
    [
      { clients: [{ callee: 7, role: 'anon' }] },
      'clients[0].callee',
      'expected a non-empty string',
    ],
    [
      { clients: [{ module: 'src/{a,b.ts', role: 'anon' }] },
      'clients[0].module',
      'has a "{" without a closing "}": src/{a,b.ts',
    ],
    [{ clients: [{ module: 'a', role: 'anonn' }] }, 'clients[0].role', 'Did you mean "anon"?'],
    [{ clients: [{ module: 'a', role: 'admin' }] }, 'clients[0].role', 'got "admin".'],
    [{ clients: [{ module: 'a', role: [] }] }, 'clients[0].role', 'expected at least one role'],
    [{ defaultRoles: ['anon', 'anon'] }, 'defaultRoles', 'lists a role twice'],
    [{ defaultRoles: ['anon', 1] }, 'defaultRoles[1]', 'got a number'],
    [{ unknownKey: 'ignore' }, 'unknownKey', 'expected "default" or "skip", got "ignore"'],
    [{ migrationsHash: false }, 'migrationsHash', 'got a boolean'],
  ])('%j -> %s', (raw, key, text) => {
    const error = errorOf(raw);
    expect(error.key).toBe(key);
    expect(error.name).toBe('SettingsError');
    expect(error.message).toContain(text);
    expect(error.message.startsWith('eslint-plugin-supabase: invalid settings.supabase')).toBe(
      true,
    );
  });

  it.each(GRANTS_LINT_KEYS)('points the grants-lint key %s to grants-lint config', (key) => {
    const error = errorOf({ [key]: 'x' });
    expect(error.key).toBe(key);
    expect(error.message).toContain(
      'is a grants-lint setting: set it in grants-lint.config.json or package.json#grantsLint',
    );
  });
});

describe('readSettings', () => {
  it('parses once per settings object and working directory', () => {
    const supabase = { unknownKey: 'skip' };
    const first = readSettings({ settings: { supabase }, cwd });
    expect(readSettings({ settings: { supabase }, cwd })).toBe(first);
    const other = readSettings({ settings: { supabase }, cwd: path.resolve('/other') });
    expect(other).not.toBe(first);
    expect(other.unknownKey).toBe('skip');
  });

  it('uses the defaults without settings, and rejects a non-object', () => {
    expect(readSettings({ settings: {}, cwd }).unknownKey).toBe('default');
    expect(readSettings({ settings: {}, cwd })).toBe(readSettings({ settings: {}, cwd }));
    expect(() => readSettings({ settings: { supabase: 'x' }, cwd })).toThrow(SettingsError);
  });
});

describe('grantsLintConfigFiles', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'eps-settings-'));
  afterAll(() => rmSync(temp, { recursive: true, force: true }));

  function project(name: string, files: Record<string, string>): string {
    const dir = path.join(temp, name);
    mkdirSync(dir, { recursive: true });
    for (const [file, content] of Object.entries(files))
      writeFileSync(path.join(dir, file), content);
    return dir;
  }

  it('lists package.json#grantsLint, then grants-lint.config.json, then the explicit file', () => {
    const explicit = path.join(temp, 'custom.json');
    writeFileSync(explicit, '{}');
    expect(grantsLintConfigFiles(basic, explicit)).toEqual([
      path.join(basic, 'package.json'),
      path.join(basic, 'grants-lint.config.json'),
      explicit,
    ]);
  });

  it('lists an explicit file that is also the default file once', () => {
    const file = path.join(basic, 'grants-lint.config.json');
    expect(grantsLintConfigFiles(basic, file)).toEqual([path.join(basic, 'package.json'), file]);
  });

  it('skips a package.json without the key, and lists one that does not parse', () => {
    expect(
      grantsLintConfigFiles(project('nokey', { 'package.json': '{"name":"x"}' }), undefined),
    ).toEqual([]);
    expect(grantsLintConfigFiles(project('array', { 'package.json': '[]' }), undefined)).toEqual(
      [],
    );
    const broken = project('broken', { 'package.json': '{' });
    expect(grantsLintConfigFiles(broken, undefined)).toEqual([path.join(broken, 'package.json')]);
  });

  it('is empty for a project without config', () => {
    expect(grantsLintConfigFiles(project('empty', {}), undefined)).toEqual([]);
  });
});
