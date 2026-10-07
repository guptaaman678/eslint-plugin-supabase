import { cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { ESLint } from 'eslint';
import { afterEach, describe, expect, it } from 'vitest';
import { createWithProject, discoveredHash } from '../../src/configs/project.js';
import { createRecommended, TYPESCRIPT_FILES } from '../../src/configs/recommended.js';
import { inputsFingerprint, migrationsHash, watchedInputs } from '../../src/schema/inputs.js';
import { fakeEngine } from '../harness/fake-engine.js';
import { TempProject } from '../harness/temp-project.js';

const projects: TempProject[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) project.remove();
});

function setup() {
  const project = new TempProject({ '0001_init.sql': 'create table todos (id int);\n' });
  projects.push(project);
  const engine = fakeEngine('0.3.0');
  const hash = () => migrationsHash(engine, { projectDir: project.dir });
  return { project, engine, hash };
}

describe('migrationsHash (ADR-012)', () => {
  it('is a stable sha256 hex string', () => {
    const { hash } = setup();
    expect(hash()).toMatch(/^[0-9a-f]{64}$/);
    expect(hash()).toBe(hash());
  });

  it('changes when a migration is edited, touched, added or renamed', () => {
    const { project, hash } = setup();
    const seen = new Set([hash()]);
    project.migration('0001_init.sql', 'create table todos (id bigint);\n');
    seen.add(hash());
    project.touch('supabase/migrations/0001_init.sql');
    seen.add(hash());
    project.migration('0002_orders.sql', 'create table orders (id int);\n');
    seen.add(hash());
    project.migration('0003_orders.sql', 'create table orders (id int);\n');
    rmSync(path.join(project.migrationsDir, '0002_orders.sql'));
    seen.add(hash());
    expect(seen.size).toBe(5);
  });

  it('changes when the grants-lint config is created or edited', () => {
    const { project, hash } = setup();
    const seen = new Set([hash()]);
    project.write('grants-lint.config.json', '{"since":"auto"}');
    seen.add(hash());
    project.write('grants-lint.config.json', '{"since":"20260101000000"}');
    seen.add(hash());
    expect(seen.size).toBe(3);
  });

  it('changes when package.json gains or edits a grantsLint key, not for other edits', () => {
    const { project, hash } = setup();
    project.write('package.json', '{"name":"app"}');
    const plain = hash();
    project.write('package.json', '{"name":"app","version":"2.0.0"}');
    expect(hash()).toBe(plain);
    project.write('package.json', '{"name":"app","grantsLint":{"schemas":["public"]}}');
    const keyed = hash();
    expect(keyed).not.toBe(plain);
    project.write('package.json', '{"name":"app","grantsLint":{"schemas":["public","api"]}}');
    expect(hash()).not.toBe(keyed);
  });

  it('covers an explicit grants-lint config file', () => {
    const { project, engine } = setup();
    const configFile = project.write('config/gl.json', '{}');
    const explicit = () => migrationsHash(engine, { projectDir: project.dir, configFile });
    const before = explicit();
    project.write('config/gl.json', '{"since":"auto"}');
    expect(explicit()).not.toBe(before);
  });

  it('changes with the engine version', () => {
    const { project, hash } = setup();
    expect(migrationsHash(fakeEngine('0.4.0'), { projectDir: project.dir })).not.toBe(hash());
  });

  it('ignores files that are not replay inputs', () => {
    const { project, hash } = setup();
    const before = hash();
    project.write('src/app.ts', 'export {};\n');
    project.write('supabase/config.toml', '[api]\n');
    project.write('supabase/migrations/notes.md', 'x\n');
    expect(hash()).toBe(before);
  });

  it('does not depend on where the project is checked out', () => {
    const { project, hash } = setup();
    project.write('grants-lint.config.json', '{}');
    const inputs = ['supabase/migrations/0001_init.sql', 'grants-lint.config.json'];
    project.pin(inputs);
    const copy = new TempProject({});
    projects.push(copy);
    cpSync(project.dir, copy.dir, { recursive: true });
    copy.pin(inputs);
    expect(migrationsHash(fakeEngine('0.3.0'), { projectDir: copy.dir })).toBe(hash());
  });

  it('hashes a project the engine cannot list without throwing', () => {
    const { project, engine } = setup();
    rmSync(project.migrationsDir, { recursive: true });
    const broken = migrationsHash(engine, { projectDir: project.dir });
    expect(broken).toMatch(/^[0-9a-f]{64}$/);
    expect(migrationsHash(engine, { projectDir: project.dir })).toBe(broken);
  });
});

describe('watchedInputs and inputsFingerprint', () => {
  it('lists migrations in replay order, then each config layer once', () => {
    const { project, engine } = setup();
    project.migration('0002_b.sql', '');
    project.write('package.json', '{"grantsLint":{}}');
    project.write('grants-lint.config.json', '{}');
    const inputs = watchedInputs(engine, { projectDir: project.dir });
    expect(inputs.files?.map((file) => path.relative(project.dir, file))).toEqual([
      path.join('supabase', 'migrations', '0001_init.sql'),
      path.join('supabase', 'migrations', '0002_b.sql'),
      'package.json',
      'grants-lint.config.json',
    ]);
  });

  it('writes project-relative paths with / separators', () => {
    const { project, engine } = setup();
    const fingerprint = inputsFingerprint(
      project.dir,
      watchedInputs(engine, { projectDir: project.dir }),
    );
    expect(fingerprint).toMatch(/^supabase\/migrations\/0001_init\.sql\t\d+\t[\d.]+$/);
  });
});

describe('recommended and withProject settings', () => {
  const plugin: ESLint.Plugin = { meta: { name: 'p' }, rules: {} };

  it('recommended carries the hash of the project discovered from cwd', () => {
    const { project, engine, hash } = setup();
    const nested = project.write('apps/web/src/a.ts', '');
    const discovered = discoveredHash(engine, path.dirname(nested));
    expect(discovered).toBe(hash());
    expect(createRecommended(plugin, discovered).settings).toEqual({
      supabase: { migrationsHash: hash() },
    });
  });

  it('recommended has no settings outside a Supabase project', () => {
    const { project, engine } = setup();
    rmSync(project.migrationsDir, { recursive: true });
    expect(discoveredHash(engine, project.dir)).toBeUndefined();
    expect(createRecommended(plugin, undefined)).not.toHaveProperty('settings');
  });

  it('withProject sets projectDir, the config file and the hash for one project', () => {
    const { project, engine } = setup();
    project.write('gl.json', '{}');
    const withProject = createWithProject(plugin, engine, () => project.dir);
    const config = withProject({ projectDir: '.', grantsLintConfig: 'gl.json' });
    expect(config).toMatchObject({
      name: 'supabase/project:.',
      files: TYPESCRIPT_FILES,
      plugins: { supabase: plugin },
      settings: {
        supabase: {
          projectDir: '.',
          grantsLintConfig: 'gl.json',
          migrationsHash: migrationsHash(engine, {
            projectDir: project.dir,
            configFile: path.join(project.dir, 'gl.json'),
          }),
        },
      },
    });
  });

  it('withProject covers a monorepo package with its own files', () => {
    const { project, engine } = setup();
    const api = new TempProject();
    projects.push(api);
    const withProject = createWithProject(plugin, engine, () => path.dirname(api.dir));
    const config = withProject({ projectDir: path.basename(api.dir), files: ['api/**/*.ts'] });
    expect(config.files).toEqual(['api/**/*.ts']);
    expect(config.settings?.supabase).toEqual({
      projectDir: path.basename(api.dir),
      migrationsHash: migrationsHash(engine, { projectDir: api.dir }),
    });
    expect(config.settings?.supabase).not.toEqual(
      createWithProject(plugin, engine, () => project.dir)({ projectDir: '.' }).settings?.supabase,
    );
  });

  it('withProject resolves against process.cwd() by default', () => {
    const { project, engine } = setup();
    const config = createWithProject(plugin, engine)({ projectDir: project.dir });
    expect(config.settings?.supabase).toEqual({
      projectDir: project.dir,
      migrationsHash: migrationsHash(engine, { projectDir: project.dir }),
    });
  });
});
