import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { SnapshotCache } from '../../src/schema/cache.js';
import { engine, loadEngine } from '../../src/schema/engine.js';
import { schemaForFile } from '../../src/schema/lookup.js';
import { createSchemaView, type SchemaView } from '../../src/schema/view.js';
import { schemaFixture } from '../harness/rule-tester.js';

/** Every fixture schema that has a hand-written `expected.json`. */
const FIXTURES = [
  'basic',
  'rls',
  'policies',
  'publications',
  'db-pull',
  'opt-in',
  'opt-in-dashboard',
  'unparseable',
];

function expected(name: string): unknown {
  const text = readFileSync(path.join(schemaFixture(name), 'expected.json'), 'utf8');
  return JSON.parse(text.replaceAll('$ENGINE_VERSION', engine.version)) as unknown;
}

function view(name: string): SchemaView {
  const snapshot = engine.replayProjectSync({ projectDir: schemaFixture(name) });
  return createSchemaView(snapshot, engine.publicationMembership);
}

beforeAll(async () => {
  await loadEngine();
});

describe('the engine over the fixture schemas', () => {
  it.each(FIXTURES)('replays %s to its hand-written expected snapshot', (name) => {
    const snapshot = engine.replayProjectSync({ projectDir: schemaFixture(name) });
    expect(snapshot).toEqual(expected(name));
  });

  it('answers RLS on and off through the view', () => {
    const rls = view('rls');
    expect(rls.relation('public', 'todos')?.rls.enabled).toBe(true);
    expect(rls.relation('public', 'orders')?.rls.enabled).toBe(false);
    expect(rls.relation('public', 'audit_log')?.rls.forced).toBe(true);
    expect(rls.relation('public', 'messages')?.rls).toMatchObject({
      enabled: false,
      source: 'statement',
    });
    expect(rls.relation('public', 'missing')).toBeUndefined();
  });

  it('answers policies by role and command through the view', () => {
    const policies = view('policies');
    const names = (
      role: 'anon' | 'authenticated' | 'service_role',
      command: 'select' | 'insert' | 'update' | 'delete',
    ) => policies.policies(role, 'public', 'todos', command).map((policy) => policy.name);
    expect(names('authenticated', 'select')).toEqual(['owners read', 'service manages']);
    expect(names('anon', 'select')).toEqual([
      'anyone reads nothing',
      'owners read',
      'service manages',
    ]);
    expect(names('authenticated', 'insert')).toEqual(['owners write', 'service manages']);
    expect(names('anon', 'insert')).toEqual(['service manages']);
    // The restrictive policy never counts.
    expect(names('authenticated', 'delete')).toEqual(['service manages']);
  });

  it('answers publication membership through the view', () => {
    const publications = view('publications');
    expect(publications.inPublication('supabase_realtime', 'public', 'messages')).toBe('no');
    expect(publications.inPublication('supabase_realtime', 'public', 'scores')).toBe('unknown');
    expect(publications.inPublication('orders_feed', 'public', 'scores')).toBe('no');
    expect(publications.inPublication('everything', 'public', 'scores')).toBe('yes');
    expect(publications.inPublication('missing', 'public', 'scores')).toBe('no');
    expect(view('db-pull').inPublication('supabase_realtime', 'public', 'messages')).toBe('yes');
  });

  it('answers grants after an opt-in through the view', () => {
    for (const name of ['opt-in', 'opt-in-dashboard']) {
      const optIn = view(name);
      expect(optIn.canUse('anon', 'public', 'audit_log', 'insert')).toBe(true);
      expect(optIn.canUse('anon', 'public', 'scores', 'select')).toBe(false);
      expect(optIn.canUse('authenticated', 'public', 'scores', 'select')).toBe(true);
      expect(optIn.canUse('authenticated', 'public', 'scores', 'insert')).toBe(false);
    }
    // A column grant counts (ADR-008).
    expect(view('opt-in').canUse('authenticated', 'public', 'scores', 'update')).toBe(true);
  });

  it('builds the snapshot past a statement the parser cannot read', () => {
    const unparseable = view('unparseable');
    expect(unparseable.meta().parseProblems).toBe(1);
    expect(unparseable.relation('public', 'todos')?.rls.enabled).toBe(true);
  });

  it('skips a project whose config the engine refuses, with reason engine-error', () => {
    const cache = new SnapshotCache(engine);
    const file = path.join(schemaFixture('bad-config'), 'src', 'app.ts');
    const settings = { projectDir: undefined, grantsLintConfig: undefined };
    expect(schemaForFile(cache, file, settings)).toEqual({ skip: 'engine-error' });
    expect(cache.get({ projectDir: schemaFixture('bad-config') }).error).toMatchObject({
      code: 'config',
    });
  });

  it('reads an explicit grants-lint config file given as an absolute path', () => {
    const cache = new SnapshotCache(engine);
    const projectDir = schemaFixture('rls');
    const settings = {
      projectDir,
      grantsLintConfig: path.join(schemaFixture('opt-in-dashboard'), 'grants-lint.config.json'),
    };
    const lookup = schemaForFile(cache, path.join(projectDir, 'app.ts'), settings);
    expect(lookup.view?.meta()).toMatchObject({
      configSource: '../opt-in-dashboard/grants-lint.config.json',
      since: { value: '20260101000000', source: 'config' },
    });
  });
});
