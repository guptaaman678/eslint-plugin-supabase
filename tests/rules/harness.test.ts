import { Linter, type Rule } from 'eslint';
import parser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import { dummyRule } from '../harness/dummy-rule.js';
import { createRuleTester, schemaFixture, TS_FIXTURE_DIR } from '../harness/rule-tester.js';

const projectDir = schemaFixture('basic');

createRuleTester({ supabase: { projectDir, unknownKey: 'skip' } }).run('dummy-typed', dummyRule, {
  valid: [
    'const n = 1;',
    // A local class with the same name is not supabase-js's client: the type checker tells them apart.
    'class SupabaseClient {}\nconst local = new SupabaseClient();',
  ],
  invalid: [
    {
      code: "import { createClient } from '@supabase/supabase-js';\nconst supabase = createClient('http://localhost:54321', 'sb_publishable_test');",
      errors: [
        {
          messageId: 'client',
          data: {
            name: 'supabase',
            type: 'SupabaseClient',
            module: '@supabase/supabase-js',
            unknownKey: 'skip',
          },
          line: 2,
        },
      ],
    },
    {
      // Through an alias and a type annotation, in a .tsx file.
      filename: 'react.tsx',
      code: "import type { SupabaseClient } from '@supabase/supabase-js';\ndeclare const client: SupabaseClient;\nexport const db = client;\nexport const el = <div />;",
      errors: [
        { messageId: 'client', line: 2 },
        { messageId: 'client', line: 3 },
      ],
    },
  ],
});

describe('settings errors through ESLint', () => {
  function lintWith(settings: Record<string, unknown>): Linter.LintMessage[] {
    const linter = new Linter({ configType: 'flat' });
    return linter.verify(
      'export const n = 1;',
      [
        {
          files: ['**/*.ts'],
          languageOptions: {
            parser,
            parserOptions: { projectService: true, tsconfigRootDir: TS_FIXTURE_DIR },
          },
          // typescript-eslint's rule type marks `defaultOptions` readonly; ESLint's does not.
          plugins: { test: { rules: { 'dummy-typed': dummyRule as unknown as Rule.RuleModule } } },
          rules: { 'test/dummy-typed': 'error' },
          settings: { supabase: settings },
        },
      ],
      `${TS_FIXTURE_DIR}/file.ts`,
    );
  }

  it('lints with valid settings', () => {
    expect(lintWith({ defaultRoles: 'anon' })).toEqual([]);
  });

  it('fails the run with an error naming a misspelt key', () => {
    expect(() => lintWith({ projectdir: projectDir })).toThrow(
      /settings\.supabase\.projectdir: is not a known setting\. Did you mean "projectDir"\?/,
    );
  });

  it('fails the run with an error naming a key with a bad value', () => {
    expect(() => lintWith({ clients: [{ callee: 'createAdminClient', role: 'admin' }] })).toThrow(
      /settings\.supabase\.clients\[0\]\.role: expected one of anon, authenticated, service_role/,
    );
  });
});
