import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SnapshotCache } from '../../src/schema/cache.js';
import type { Engine } from '../../src/schema/engine-api.js';
import { schemaForFile } from '../../src/schema/lookup.js';
import { fakeEngine } from '../harness/fake-engine.js';
import { TempProject } from '../harness/temp-project.js';

const NO_SETTINGS = { projectDir: undefined, grantsLintConfig: undefined };

const projects: TempProject[] = [];
function project(): TempProject {
  const created = new TempProject();
  projects.push(created);
  return created;
}

afterEach(() => {
  for (const created of projects.splice(0)) created.remove();
});

/** A fake engine whose replay throws something unexpected, counting the attempts. */
function throwingEngine(): Engine & { replays: number } {
  const base = fakeEngine();
  const engine = {
    ...base,
    replays: 0,
    replayProjectSync(): never {
      engine.replays++;
      throw new TypeError('unexpected engine failure');
    },
  };
  return engine;
}

describe('schemaForFile', () => {
  it('skips a file in no Supabase project with reason no-project', () => {
    const cache = new SnapshotCache(fakeEngine());
    const outside = path.join(path.parse(process.cwd()).root, 'nowhere', 'app.ts');
    expect(schemaForFile(cache, outside, NO_SETTINGS)).toEqual({ skip: 'no-project' });
  });

  it('returns the view of the discovered project', () => {
    const engine = fakeEngine();
    const { dir } = project();
    const lookup = schemaForFile(
      new SnapshotCache(engine),
      path.join(dir, 'src', 'a.ts'),
      NO_SETTINGS,
    );
    expect(lookup.skip).toBeUndefined();
    expect(lookup.view?.meta().files).toBe(1);
  });

  it('uses settings.projectDir and the explicit grants-lint config', () => {
    const engine = fakeEngine();
    const calls: unknown[] = [];
    const recording: Engine = {
      ...engine,
      replayProjectSync(options) {
        calls.push(options);
        return engine.replayProjectSync(options);
      },
    };
    const target = project();
    const config = target.write('config/grants-lint.json', '{}');
    const elsewhere = path.join(project().dir, 'a.ts');
    const settings = { projectDir: target.dir, grantsLintConfig: config };
    expect(schemaForFile(new SnapshotCache(recording), elsewhere, settings).view).toBeDefined();
    expect(calls).toEqual([{ projectDir: target.dir, configFile: config }]);
  });

  it('catches an unexpected engine exception and skips the project once, with reason engine-error', () => {
    const engine = throwingEngine();
    const cache = new SnapshotCache(engine);
    const broken = project();
    const files = ['a.ts', 'b.ts', path.join('src', 'c.ts')].map((f) => path.join(broken.dir, f));
    for (const file of files) {
      expect(schemaForFile(cache, file, NO_SETTINGS)).toEqual({ skip: 'engine-error' });
    }
    expect(engine.replays).toBe(1);
  });

  it('keeps skipping until the inputs change, then replays again', () => {
    let now = 0;
    const engine = throwingEngine();
    const cache = new SnapshotCache(engine, () => now);
    const broken = project();
    const file = path.join(broken.dir, 'a.ts');
    expect(schemaForFile(cache, file, NO_SETTINGS).skip).toBe('engine-error');
    now += 1000;
    expect(schemaForFile(cache, file, NO_SETTINGS).skip).toBe('engine-error');
    expect(engine.replays).toBe(1);
    broken.migration('0002_more.sql', 'create table public.orders (id bigint primary key);\n');
    now += 1000;
    expect(schemaForFile(cache, file, NO_SETTINGS).skip).toBe('engine-error');
    expect(engine.replays).toBe(2);
  });

  it('skips only the failing project', () => {
    const fine = fakeEngine();
    const broken = project();
    const healthy = project();
    const engine: Engine = {
      ...fine,
      replayProjectSync(options) {
        if (options.projectDir === broken.dir) throw new Error('boom');
        return fine.replayProjectSync(options);
      },
    };
    const cache = new SnapshotCache(engine);
    expect(schemaForFile(cache, path.join(broken.dir, 'a.ts'), NO_SETTINGS).skip).toBe(
      'engine-error',
    );
    expect(schemaForFile(cache, path.join(healthy.dir, 'a.ts'), NO_SETTINGS).view).toBeDefined();
  });
});
