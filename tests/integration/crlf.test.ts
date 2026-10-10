import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { realtimeTablePublished } from '../../src/rules/realtime-table-published.js';
import { rlsReadable } from '../../src/rules/rls-readable.js';
import { engine, loadEngine } from '../../src/schema/engine.js';
import { createSchemaView } from '../../src/schema/view.js';
import { createRuleTester, schemaFixture } from '../harness/rule-tester.js';

/**
 * Spec T5.4: migrations saved with CRLF line endings (`tests/fixtures/schemas/crlf`, kept CRLF by
 * `.gitattributes`) replay to the same schema as their LF copy, with the same line numbers, on
 * every OS the CI runs.
 */

await loadEngine();

const CRLF = schemaFixture('crlf');
const MIGRATIONS = path.join(CRLF, 'supabase', 'migrations');
let lfCopy: string;

beforeAll(() => {
  lfCopy = mkdtempSync(path.join(tmpdir(), 'supabase-lf-'));
  cpSync(CRLF, lfCopy, { recursive: true });
  const lfMigrations = path.join(lfCopy, 'supabase', 'migrations');
  for (const file of readdirSync(lfMigrations)) {
    const target = path.join(lfMigrations, file);
    writeFileSync(target, readFileSync(target, 'utf8').replaceAll('\r\n', '\n'));
  }
});

afterAll(() => {
  rmSync(lfCopy, { recursive: true, force: true });
});

describe('CRLF migrations', () => {
  it('are checked out with CRLF line endings only', () => {
    const files = readdirSync(MIGRATIONS);
    expect(files).toHaveLength(2);
    for (const file of files) {
      const text = readFileSync(path.join(MIGRATIONS, file), 'utf8');
      expect(text, file).toContain('\r\n');
      expect(text.replaceAll('\r\n', ''), file).not.toContain('\n');
    }
  });

  it('replay to the same snapshot as their LF copy', () => {
    const crlf = engine.replayProjectSync({ projectDir: CRLF });
    expect(crlf.meta.parseProblems).toBe(0);
    expect(crlf).toEqual(engine.replayProjectSync({ projectDir: lfCopy }));
  });

  it('answer RLS, policies and publications through the view', () => {
    const view = createSchemaView(
      engine.replayProjectSync({ projectDir: CRLF }),
      engine.publicationMembership,
    );
    expect(view.relation('public', 'todos')?.rls.enabled).toBe(true);
    expect(view.relation('public', 'messages')?.rls.enabled).toBe(true);
    expect(view.policies('anon', 'public', 'todos', 'select').map((p) => p.name)).toEqual([
      'anyone reads todos',
    ]);
    expect(view.policies('anon', 'public', 'messages', 'select')).toEqual([]);
    expect(view.inPublication('supabase_realtime', 'public', 'messages')).toBe('unknown');
  });
});

const HEADER = [
  "import { createClient } from '@supabase/supabase-js';",
  "const supabase = createClient('http://localhost:54321', 'sb_publishable_test');",
  '',
].join('\n');
const settings = { supabase: { projectDir: CRLF } };
const subscribe = (table: string): string =>
  `${HEADER}supabase\n  .channel('changes')\n  .on('postgres_changes', { event: '*', schema: 'public', table: '${table}' }, (payload) => payload)\n  .subscribe((status) => status);`;

createRuleTester().run('rls-readable over CRLF migrations', rlsReadable, {
  valid: [{ code: `${HEADER}export const rows = supabase.from('todos').select();`, settings }],
  invalid: [
    {
      code: `${HEADER}export const rows = supabase.from('messages').select();`,
      settings,
      errors: [
        {
          messageId: 'noSelectPolicy',
          data: { table: 'public.messages', roles: 'anon or authenticated', via: '' },
        },
      ],
    },
  ],
});

createRuleTester().run('realtime-table-published over CRLF migrations', realtimeTablePublished, {
  valid: [],
  invalid: [
    {
      // The block's location counts CRLF as one line break and uses `/` on every OS.
      code: subscribe('messages'),
      settings,
      options: [
        {
          publication: 'supabase_realtime',
          ignoreTables: [],
          reportUnresolved: true,
          reportUnknownTables: false,
        },
      ],
      errors: [
        {
          messageId: 'publicationUncertain',
          data: {
            table: 'public.messages',
            publication: 'supabase_realtime',
            location: 'supabase/migrations/20260102000000_realtime.sql:6',
          },
        },
      ],
    },
  ],
});
