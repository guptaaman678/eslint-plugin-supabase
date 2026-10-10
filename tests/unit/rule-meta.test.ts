import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { recommendedRules } from '../../src/configs/recommended.js';
import plugin from '../../src/index.js';

interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  additionalProperties?: boolean;
}

/** Every object in an options schema, nested ones included. */
function objects(schema: JsonSchema): JsonSchema[] {
  const nested = [
    ...Object.values(schema.properties ?? {}),
    ...(schema.items ? [schema.items] : []),
  ];
  return [...(schema.type === 'object' ? [schema] : []), ...nested.flatMap(objects)];
}

// The rule meta is what the README table, the docs headers and ESLint's option validation read.
describe.each(Object.entries(plugin.rules))('rule %s meta', (name, rule) => {
  const schema = (rule.meta?.schema ?? []) as JsonSchema[];

  it('links its own docs page', () => {
    expect(rule.meta?.docs?.url).toMatch(new RegExp(`/docs/rules/${name}\\.md$`));
  });

  it('is a typed problem rule', () => {
    expect(rule.meta?.type).toBe('problem');
    expect(rule.meta?.docs).toHaveProperty('requiresTypeChecking', true);
  });

  it('is marked recommended exactly when `recommended` turns it on', () => {
    expect(rule.meta?.docs?.recommended).toBe(`supabase/${name}` in recommendedRules);
  });

  it('has no empty message', () => {
    for (const message of Object.values(rule.meta?.messages ?? {})) {
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it('describes every option and rejects unknown keys at every level', () => {
    for (const object of schema.flatMap(objects)) {
      expect(object.additionalProperties).toBe(false);
      for (const option of Object.values(object.properties ?? {})) {
        expect(option.description?.length).toBeGreaterThan(0);
      }
    }
  });

  it('takes no options exactly when it has no defaults', () => {
    expect(schema.length === 0).toBe(rule.meta?.defaultOptions === undefined);
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
