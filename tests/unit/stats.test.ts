import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { threadId } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATS_ENV, Stats } from '../../src/stats.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'supabase-stats-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

describe('Stats counters', () => {
  it('counts files, call sites and skips, each call and reason once', () => {
    const stats = new Stats(undefined, 0, () => {});
    const a = {};
    const b = {};
    stats.recordFile('a.ts');
    stats.recordFile('a.ts');
    stats.recordFile('b.ts');
    stats.recordCall(a, undefined);
    // A second rule skipping the same call for the same reason does not count it again.
    stats.recordCall(a, 'unknown-client');
    stats.recordCall(a, 'unknown-client');
    stats.recordCall(b, 'unknown-client');
    stats.recordCall(b, 'dynamic-table');
    stats.recordCall(b, undefined);
    expect(stats.snapshot()).toEqual({
      threadId: 0,
      files: 2,
      calls: 2,
      skips: { 'dynamic-table': 1, 'unknown-client': 2 },
    });
    // Reasons are sorted, so files compare byte for byte.
    expect(Object.keys(stats.snapshot().skips)).toEqual(['dynamic-table', 'unknown-client']);
  });
});

describe('Stats file', () => {
  it('writes nothing and registers no exit hook without the env var', () => {
    const onExit = vi.fn();
    const stats = new Stats(undefined, 0, onExit);
    stats.recordFile('a.ts');
    stats.recordCall({}, 'dynamic-schema');
    stats.write();
    expect(onExit).not.toHaveBeenCalled();
    expect(stats.file()).toBeUndefined();
  });

  it('registers one exit hook on the first record, and writes <path>.<threadId>.json', () => {
    const target = path.join(dir, 'stats');
    const listeners: (() => void)[] = [];
    const stats = new Stats(target, 3, (listener) => listeners.push(listener));
    expect(listeners).toHaveLength(0);
    stats.recordCall({}, 'unknown-key');
    stats.recordFile('a.ts');
    stats.recordFile('b.ts');
    expect(listeners).toHaveLength(1);
    expect(stats.file()).toBe(`${target}.3.json`);
    listeners[0]!();
    expect(readJson(`${target}.3.json`)).toEqual({
      threadId: 3,
      files: 2,
      calls: 1,
      skips: { 'unknown-key': 1 },
    });
  });

  it('writes nothing for a thread that linted no file (the main thread under --concurrency)', () => {
    const target = path.join(dir, 'stats');
    const listeners: (() => void)[] = [];
    const stats = new Stats(target, 0, (listener) => listeners.push(listener));
    stats.recordCall({}, 'dynamic-table');
    listeners[0]!();
    expect(existsSync(`${target}.0.json`)).toBe(false);
  });

  it('the shared instance reads the env var and hooks process exit', async () => {
    const target = path.join(dir, 'run');
    vi.stubEnv(STATS_ENV, target);
    const once = vi.spyOn(process, 'once').mockImplementation(() => process);
    vi.resetModules();
    const { stats } = await import('../../src/stats.js');
    expect(once).not.toHaveBeenCalled();
    stats.recordFile('a.ts');
    expect(once).toHaveBeenCalledTimes(1);
    expect(once.mock.calls[0]![0]).toBe('exit');
    (once.mock.calls[0]![1] as () => void)();
    expect(readJson(`${target}.${threadId}.json`)).toEqual({
      threadId,
      files: 1,
      calls: 0,
      skips: {},
    });
  });

  it('the shared instance treats an empty env var as unset', async () => {
    vi.stubEnv(STATS_ENV, '');
    vi.resetModules();
    const { stats } = await import('../../src/stats.js');
    expect(stats.file()).toBeUndefined();
  });
});
