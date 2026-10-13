import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { ENGINE_RANGE } from '../../src/meta.js';
import { SnapshotCache } from '../../src/schema/cache.js';
import {
  adaptEngine,
  checkSnapshot,
  engine,
  loadEngine,
  snapshotCache,
  type EngineModule,
} from '../../src/schema/engine.js';
import { SnapshotVersionError } from '../../src/schema/snapshot.js';
import { fakeMembership, fakeSnapshot } from '../harness/fake-snapshot.js';
import { TempProject } from '../harness/temp-project.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  dependencies: Record<string, string>;
};

function fakeModule(
  snapshotVersion: number,
): EngineModule & { replays: number; membership: ReturnType<typeof vi.fn> } {
  const membership = vi.fn(() => 'unknown' as const);
  const module = {
    membership,
    version: '9.9.9',
    replays: 0,
    loadEngine: () => Promise.resolve(),
    listReplayInputs: (options: { projectDir: string }) => ({
      projectDir: options.projectDir,
      configFile: null,
      migrations: [],
    }),
    replayProjectSync: () => {
      module.replays++;
      return { ...fakeSnapshot(), snapshotVersion };
    },
    publicationMembership: membership,
  };
  return module;
}

describe('checkSnapshot', () => {
  it('passes a version 1 snapshot through', () => {
    const snapshot = fakeSnapshot();
    expect(checkSnapshot(snapshot, '0.3.0')).toBe(snapshot);
  });

  it.each([0, 2])('refuses snapshotVersion %i with a message that says what to install', (v) => {
    const call = () => checkSnapshot({ snapshotVersion: v }, '0.9.0');
    expect(call).toThrow(SnapshotVersionError);
    // The error carries its own name, not Error's.
    expect(call).toThrow(expect.objectContaining({ name: 'SnapshotVersionError' }));
    expect(call).toThrow(
      `eslint-plugin-supabase reads schema snapshot version 1, but supabase-grants-lint 0.9.0 ` +
        `returned version ${v}. Install supabase-grants-lint ^0.3.2, the range ` +
        `eslint-plugin-supabase depends on.`,
    );
  });
});

describe('adaptEngine', () => {
  it('passes the version, inputs and membership through', () => {
    const module = fakeModule(1);
    const adapted = adaptEngine(module);
    expect(adapted.version).toBe('9.9.9');
    expect(adapted.listReplayInputs({ projectDir: '/p' })).toEqual({
      projectDir: '/p',
      configFile: null,
      migrations: [],
    });
    const snapshot = adapted.replayProjectSync({ projectDir: '/p' });
    expect(snapshot.snapshotVersion).toBe(1);
    expect(adapted.publicationMembership(snapshot, 'pub', 'public', 'todos')).toBe('unknown');
    expect(module.membership).toHaveBeenCalledWith(snapshot, 'pub', 'public', 'todos');
  });

  it('refuses a snapshot of another version', () => {
    expect(() => adaptEngine(fakeModule(2)).replayProjectSync({ projectDir: '/p' })).toThrow(
      SnapshotVersionError,
    );
  });

  it('makes the lint run fail on another snapshot version instead of skipping the project', () => {
    const project = new TempProject();
    try {
      const module = fakeModule(2);
      const cache = new SnapshotCache(adaptEngine(module));
      expect(() => cache.get({ projectDir: project.dir })).toThrow(SnapshotVersionError);
      expect(() => cache.get({ projectDir: project.dir })).toThrow(SnapshotVersionError);
      expect(module.replays).toBe(2);
    } finally {
      project.remove();
    }
  });
});

describe('the real engine', () => {
  it('is the installed supabase-grants-lint, in the range package.json depends on', () => {
    const installed = createRequire(import.meta.url)('supabase-grants-lint/package.json') as {
      version: string;
    };
    expect(engine.version).toBe(installed.version);
    expect(ENGINE_RANGE).toBe(pkg.dependencies['supabase-grants-lint']);
    expect(ENGINE_RANGE).toBe('^0.3.2');
  });

  it('loads, and shares one cache per thread', async () => {
    await expect(loadEngine()).resolves.toBeUndefined();
    expect(snapshotCache).toBeInstanceOf(SnapshotCache);
    expect(engine.publicationMembership(fakeSnapshot(), 'missing', 'public', 'todos')).toBe(
      fakeMembership(fakeSnapshot(), 'missing', 'public', 'todos'),
    );
  });
});
