import { describe, expect, it } from 'vitest';
import { createSchemaView } from '../../src/schema/view.js';
import { AT, fakeMembership, fakeSnapshot, fakeView, FAKE_META } from '../harness/fake-snapshot.js';

const view = fakeView({
  relations: {
    'public.todos': {
      rls: true,
      grants: { anon: ['select'], authenticated: ['select', 'insert'] },
      columnGrants: { authenticated: ['update'] },
      policies: [
        { name: 'read', command: 'select', roles: ['authenticated'] },
        { name: 'everything', command: 'all', roles: ['service_role'] },
        { name: 'deny', command: 'select', roles: ['anon'], permissive: false },
        { name: 'insert_any', command: 'insert' },
      ],
    },
    'public.orders': { grants: { public: ['select'] } },
    'public.todo_view': { kind: 'view' },
    'private.audit_log': {},
  },
  publications: {
    supabase_realtime: { tables: ['public.todos'], uncertain: true, excluded: ['public.orders'] },
    everything: { allTables: true },
    by_schema: { schemas: ['private'] },
  },
});

describe('SchemaView.relation', () => {
  it('finds relations by schema and name, and returns undefined for unknown ones', () => {
    expect(view.relation('public', 'todos')?.rls.enabled).toBe(true);
    expect(view.relation('private', 'audit_log')?.schema).toBe('private');
    expect(view.relation('private', 'todos')).toBeUndefined();
    expect(view.relation('public', 'scores')).toBeUndefined();
  });
});

describe('SchemaView.canUse', () => {
  it('counts privileges held on the table or only on some columns (ADR-008)', () => {
    expect(view.canUse('anon', 'public', 'todos', 'select')).toBe(true);
    expect(view.canUse('anon', 'public', 'todos', 'insert')).toBe(false);
    expect(view.canUse('authenticated', 'public', 'todos', 'insert')).toBe(true);
    expect(view.canUse('authenticated', 'public', 'todos', 'update')).toBe(true);
    expect(view.canUse('authenticated', 'public', 'todos', 'delete')).toBe(false);
  });

  it('counts privileges granted to PUBLIC for every role', () => {
    expect(view.canUse('anon', 'public', 'orders', 'select')).toBe(true);
    expect(view.canUse('service_role', 'public', 'orders', 'select')).toBe(true);
    expect(view.canUse('anon', 'public', 'orders', 'insert')).toBe(false);
  });

  it('is false for a role with no grants and for an unknown relation', () => {
    expect(view.canUse('service_role', 'public', 'todos', 'select')).toBe(false);
    expect(view.canUse('anon', 'public', 'scores', 'select')).toBe(false);
  });
});

describe('SchemaView.policies', () => {
  const names = (...args: Parameters<typeof view.policies>) =>
    view.policies(...args).map((policy) => policy.name);

  it('returns permissive policies for the command or all, for the role or PUBLIC', () => {
    expect(names('authenticated', 'public', 'todos', 'select')).toEqual(['read']);
    expect(names('service_role', 'public', 'todos', 'select')).toEqual(['everything']);
    expect(names('service_role', 'public', 'todos', 'delete')).toEqual(['everything']);
    expect(names('anon', 'public', 'todos', 'insert')).toEqual(['insert_any']);
    expect(names('authenticated', 'public', 'todos', 'insert')).toEqual(['insert_any']);
  });

  it('leaves out restrictive policies, other roles and other commands', () => {
    expect(names('anon', 'public', 'todos', 'select')).toEqual([]);
    expect(names('authenticated', 'public', 'todos', 'update')).toEqual([]);
  });

  it('returns no policies for a relation without any, or an unknown relation', () => {
    expect(names('anon', 'public', 'orders', 'select')).toEqual([]);
    expect(names('anon', 'public', 'scores', 'select')).toEqual([]);
  });
});

describe('SchemaView.inPublication', () => {
  it('answers through the membership function, in ADR-017 order', () => {
    expect(view.inPublication('supabase_realtime', 'public', 'todos')).toBe('yes');
    expect(view.inPublication('supabase_realtime', 'public', 'orders')).toBe('no');
    expect(view.inPublication('supabase_realtime', 'private', 'audit_log')).toBe('unknown');
    expect(view.inPublication('everything', 'public', 'orders')).toBe('yes');
    expect(view.inPublication('everything', 'public', 'not_created')).toBe('yes');
    expect(view.inPublication('everything', 'public', 'todo_view')).toBe('no');
    expect(view.inPublication('by_schema', 'private', 'audit_log')).toBe('yes');
    expect(view.inPublication('by_schema', 'public', 'todos')).toBe('no');
    expect(view.inPublication('missing', 'public', 'todos')).toBe('no');
  });

  it('passes the snapshot and arguments to the engine function unchanged', () => {
    const snapshot = fakeSnapshot();
    const calls: unknown[][] = [];
    const custom = createSchemaView(snapshot, (...args) => {
      calls.push(args);
      return 'unknown';
    });
    expect(custom.inPublication('pub', 'public', 'todos')).toBe('unknown');
    expect(calls).toEqual([[snapshot, 'pub', 'public', 'todos']]);
  });

  it('treats an empty platform publication as having no members', () => {
    const empty = fakeSnapshot({ relations: { todos: {} } });
    expect(fakeMembership(empty, 'supabase_realtime', 'public', 'todos')).toBe('no');
  });
});

describe('SchemaView.publication', () => {
  it('returns the publication by name, with its uncertain mark, or undefined', () => {
    expect(view.publication('supabase_realtime')?.uncertain).toEqual(AT);
    expect(view.publication('everything')?.allTables).toBe(true);
    expect(view.publication('everything')?.uncertain).toBeNull();
    expect(view.publication('missing')).toBeUndefined();
  });
});

describe('SchemaView.meta', () => {
  it('returns the snapshot meta', () => {
    expect(view.meta()).toEqual(FAKE_META);
    expect(fakeView({ meta: { files: 7 } }).meta().files).toBe(7);
  });
});

describe('fakeSnapshot', () => {
  it('builds plain, versioned JSON with every v1 field', () => {
    const snapshot = fakeSnapshot({
      relations: {
        scores: {
          rls: { enabled: true, forced: true, source: 'auto-rls', at: null },
          policies: [{ command: 'select', using: 'false', withCheck: 'other' }],
        },
      },
    });
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot.snapshotVersion).toBe(1);
    expect(snapshot.relations[0]).toMatchObject({
      schema: 'public',
      name: 'scores',
      kind: 'table',
      rls: { enabled: true, forced: true, source: 'auto-rls' },
      policies: [{ name: 'policy_0', roles: ['public'], using: 'false', withCheck: 'other' }],
    });
    expect(snapshot.publications.map((p) => [p.name, p.origin])).toEqual([
      ['supabase_realtime', 'platform'],
    ]);
  });
});
