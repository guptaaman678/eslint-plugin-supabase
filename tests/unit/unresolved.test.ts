import { describe, expect, it } from 'vitest';
import { unresolvedReason } from '../../src/rules/unresolved.js';
import type { StatsReason } from '../../src/stats.js';

/** One fragment of each reason's text, so every reason has its own explanation. */
const FRAGMENTS: Record<StatsReason, string> = {
  'dynamic-schema': '`schema` is not a string literal',
  'dynamic-table': '`table` is not a string literal',
  'dynamic-event': '`event` is not a string literal',
  'realtime-all-tables': 'every table of a schema',
  'unknown-operation': 'not chained to `.from()`',
  'unknown-client': 'the role it runs as is unknown',
  'unknown-key': '`settings.supabase.unknownKey` is `skip`',
  'no-project': 'Set `settings.supabase.projectDir`',
  'engine-error': 'npx supabase-grants-lint check',
  'unknown-relation': '`public.x` is not created in your migrations',
  'unknown-table': '`public.x` is not created as a table',
  view: '`public.x` is a view',
  'publication-uncertain': 'whether `public.x` is a member is unknown',
  'policy-uncertain': 'changes the policies of `public.x`',
};

describe('unresolvedReason', () => {
  it.each(Object.entries(FRAGMENTS))('explains %s', (reason, fragment) => {
    const text = unresolvedReason(reason as StatsReason, 'public.x');
    expect(text).toContain(fragment);
    expect(text.endsWith('.')).toBe(true);
  });

  it('gives each reason its own text', () => {
    const texts = Object.keys(FRAGMENTS).map((reason) =>
      unresolvedReason(reason as StatsReason, 'public.x'),
    );
    expect(new Set(texts).size).toBe(texts.length);
  });
});
