import { rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FRESHNESS_MS, SnapshotCache } from '../../src/schema/cache.js';
import type { Engine } from '../../src/schema/engine-api.js';
import { fakeEngine } from '../harness/fake-engine.js';
import { fakeMembership, fakeSnapshot } from '../harness/fake-snapshot.js';
import { INIT_SQL, TempProject } from '../harness/temp-project.js';

const projects: TempProject[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) project.remove();
});

function setup(migrations?: Record<string, string>) {
  const project = new TempProject(migrations);
  projects.push(project);
  const engine = fakeEngine();
  let time = 1_000;
  const cache = new SnapshotCache(engine, () => time);
  const get = (configFile?: string) =>
    cache.get({ projectDir: project.dir, ...(configFile === undefined ? {} : { configFile }) });
  const later = () => {
    time += FRESHNESS_MS;
  };
  return { project, engine, cache, get, later };
}

describe('SnapshotCache', () => {
  it('builds a snapshot once and serves a view of it', () => {
    const { engine, get } = setup();
    const first = get();
    expect(engine.replays).toBe(1);
    expect(first.view?.meta().files).toBe(1);
    expect(get()).toBe(first);
    expect(engine.replays).toBe(1);
  });

  it('does not look at the files again within the freshness window', () => {
    const { project, engine, get, later } = setup();
    const first = get();
    project.migration('0002_orders.sql', 'create table public.orders (id int);\n');
    expect(get()).toBe(first);
    expect(engine.replays).toBe(1);
    later();
    expect(get().view?.meta().files).toBe(2);
    expect(engine.replays).toBe(2);
  });

  it('keeps the snapshot when nothing changed', () => {
    const { engine, get, later } = setup();
    const first = get();
    later();
    expect(get()).toBe(first);
    later();
    expect(get()).toBe(first);
    expect(engine.replays).toBe(1);
  });

  it('skips the rebuild when an mtime changed but the content hash did not', () => {
    const { project, engine, get, later } = setup();
    const first = get();
    project.touch('supabase/migrations/0001_init.sql');
    later();
    expect(get()).toBe(first);
    expect(engine.replays).toBe(1);
    // The new mtime is remembered: the next check does not hash again, and still no rebuild.
    later();
    expect(get()).toBe(first);
    expect(engine.replays).toBe(1);
  });

  it('rebuilds when a migration changed (new mtime, new content)', () => {
    const { project, engine, get, later } = setup();
    const first = get();
    project.migration('0001_init.sql', INIT_SQL.replace('todos', 'tasks'));
    project.touch('supabase/migrations/0001_init.sql');
    later();
    const second = get();
    expect(second).not.toBe(first);
    expect(engine.replays).toBe(2);
  });

  it('rebuilds when a migration is added or removed', () => {
    const { project, engine, get, later } = setup();
    get();
    const file = project.migration('0002_orders.sql', 'create table public.orders (id int);\n');
    later();
    expect(get().view?.meta().files).toBe(2);
    rmSync(file);
    later();
    expect(get().view?.meta().files).toBe(1);
    expect(engine.replays).toBe(3);
  });

  it('rebuilds when the grants-lint config or package.json#grantsLint changes', () => {
    const { project, engine, get, later } = setup();
    get();
    project.write('grants-lint.config.json', '{"since":"auto"}');
    later();
    get();
    expect(engine.replays).toBe(2);
    project.write('grants-lint.config.json', '{"since":"20260101000000"}');
    later();
    get();
    expect(engine.replays).toBe(3);
    project.write('package.json', '{"name":"app"}');
    later();
    get();
    expect(engine.replays).toBe(3);
    project.write('package.json', '{"name":"app","grantsLint":{"schemas":["public"]}}');
    later();
    get();
    expect(engine.replays).toBe(4);
  });

  it('ignores files that are not replay inputs', () => {
    const { project, engine, get, later } = setup();
    get();
    project.write('src/app.ts', 'export {};\n');
    project.write('supabase/migrations/README.md', 'notes\n');
    project.write('supabase/config.toml', '[api]\n');
    later();
    get();
    expect(engine.replays).toBe(1);
  });

  it('keeps one snapshot per project directory and config file', () => {
    const { project, engine, cache, get, later } = setup();
    const other = new TempProject();
    projects.push(other);
    project.write('alt.json', '{}');
    const first = get();
    const alt = get(path.join(project.dir, 'alt.json'));
    const second = cache.get({ projectDir: other.dir });
    expect(new Set([first, alt, second]).size).toBe(3);
    expect(engine.replays).toBe(3);
    later();
    expect(get()).toBe(first);
    expect(get(path.join(project.dir, 'alt.json'))).toBe(alt);
    expect(cache.get({ projectDir: other.dir })).toBe(second);
    expect(engine.replays).toBe(3);
  });

  it('caches an error until the inputs change, then builds', () => {
    const { project, engine, get, later } = setup();
    project.write('grants-lint.config.json', '{ not json');
    const failed = get();
    expect(failed.view).toBeUndefined();
    expect(failed.error).toBeInstanceOf(SyntaxError);
    later();
    expect(get()).toBe(failed);
    project.write('grants-lint.config.json', '{}');
    later();
    expect(get().view?.meta().files).toBe(1);
    expect(engine.replays).toBe(1);
  });

  it('reports a missing migrations directory as an error result, not a throw', () => {
    const { project, get } = setup();
    rmSync(project.migrationsDir, { recursive: true });
    expect(String(get().error)).toContain('Migrations directory not found');
  });

  it('turns a replay exception into an error result', () => {
    const project = new TempProject();
    projects.push(project);
    const boom = new Error('engine bug');
    const engine: Engine = {
      ...fakeEngine(),
      replayProjectSync: () => {
        throw boom;
      },
    };
    expect(new SnapshotCache(engine).get({ projectDir: project.dir })).toEqual({ error: boom });
  });

  it('tolerates a listed input that vanished, and a non-Error throw from the listing', () => {
    const project = new TempProject();
    projects.push(project);
    let calls = 0;
    const gone = path.join(project.migrationsDir, 'gone.sql');
    const engine: Engine = {
      version: 'x',
      listReplayInputs: (options) => {
        calls++;
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- a non-Error throw
        if (calls === 3) throw 'listing failed';
        return { projectDir: options.projectDir, configFile: null, migrations: [gone] };
      },
      replayProjectSync: () => fakeSnapshot(),
      publicationMembership: fakeMembership,
    };
    let time = 0;
    const cache = new SnapshotCache(engine, () => time);
    const first = cache.get({ projectDir: project.dir });
    expect(first.view).toBeDefined();
    time += FRESHNESS_MS;
    expect(cache.get({ projectDir: project.dir })).toBe(first);
    time += FRESHNESS_MS;
    expect(cache.get({ projectDir: project.dir }).view).toBeDefined();
  });

  it('uses Date.now by default', () => {
    const project = new TempProject();
    projects.push(project);
    const engine = fakeEngine();
    const cache = new SnapshotCache(engine);
    cache.get({ projectDir: project.dir });
    cache.get({ projectDir: project.dir });
    expect(engine.replays).toBe(1);
  });
});
