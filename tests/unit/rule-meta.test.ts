import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { recommendedRules } from '../../src/configs/recommended.js';
import plugin from '../../src/index.js';

interface OptionsSchema {
  properties?: Record<string, { description?: string }>;
}

// The rule meta is what the README table, the docs headers and ESLint's option validation read.
describe.each(Object.entries(plugin.rules))('rule %s meta', (name, rule) => {
  it('is marked recommended exactly when `recommended` turns it on', () => {
    expect(rule.meta?.docs?.recommended).toBe(`supabase/${name}` in recommendedRules);
  });

  it('describes every option', () => {
    const schema = (rule.meta?.schema ?? []) as OptionsSchema[];
    for (const option of Object.values(schema[0]?.properties ?? {})) {
      expect(option.description?.length).toBeGreaterThan(0);
    }
  });
});

/** ESLint validates rule options against `meta.schema` before the rule runs. */
function configure(rule: string, options: object) {
  return () =>
    new Linter({ configType: 'flat' }).verify('x;', {
      plugins: { supabase: plugin },
      rules: { [`supabase/${rule}`]: ['warn', options] },
    });
}

describe('subscribe-status-handler options', () => {
  it('defaults to no wrappers', () => {
    expect(plugin.rules['subscribe-status-handler']?.meta?.defaultOptions).toEqual([
      { allowWrappers: [] },
    ]);
  });

  it('rejects empty, repeated and unknown wrapper settings', () => {
    const rule = 'subscribe-status-handler';
    expect(configure(rule, { allowWrappers: [''] })).toThrow(/shorter than 1 characters/);
    expect(configure(rule, { allowWrappers: ['a', 'a'] })).toThrow(/duplicate items/);
    expect(configure(rule, { allowWrapper: ['a'] })).toThrow(/additional properties/i);
  });
});
