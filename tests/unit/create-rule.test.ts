import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRule, ruleDocsUrl } from '../../src/util/create-rule.js';
import { dummyRule } from '../harness/dummy-rule.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

describe('createRule', () => {
  it('pins the docs URL to the release tag of this version', () => {
    expect(dummyRule.meta.docs?.url).toBe(
      `https://github.com/guptaaman678/eslint-plugin-supabase/blob/v${pkg.version}/docs/rules/dummy-typed.md`,
    );
    expect(ruleDocsUrl('no-unsent-query', '0.1.0')).toBe(
      'https://github.com/guptaaman678/eslint-plugin-supabase/blob/v0.1.0/docs/rules/no-unsent-query.md',
    );
  });

  it('keeps the rule meta and applies meta.defaultOptions', () => {
    const rule = createRule<[{ publication: string }], 'x'>({
      name: 'with-options',
      meta: {
        type: 'problem',
        docs: { description: 'd', requiresTypeChecking: true },
        messages: { x: '{{publication}}' },
        schema: [
          {
            type: 'object',
            properties: { publication: { type: 'string', description: 'Publication name.' } },
            additionalProperties: false,
          },
        ],
        defaultOptions: [{ publication: 'supabase_realtime' }],
      },
      create: (_context, [options]) => ({ Program: () => void options.publication }),
    });
    expect(rule.meta.defaultOptions).toEqual([{ publication: 'supabase_realtime' }]);
    expect(rule.meta.docs?.requiresTypeChecking).toBe(true);
    expect(dummyRule.meta.schema).toEqual([]);
    expect(dummyRule.meta.defaultOptions).toBeUndefined();
  });
});
