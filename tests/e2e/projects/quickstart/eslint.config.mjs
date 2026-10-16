// The README's quick start config, with the rule override of docs/configuration.md after it.
// `tests/e2e/docs-config.test.ts` checks that both still read as documented.
import parser from '@typescript-eslint/parser';
import supabase from 'eslint-plugin-supabase';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['**/supabase/functions/**'],
    languageOptions: {
      parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  supabase.configs.recommended,
  {
    files: supabase.configs.recommended.files,
    ignores: supabase.configs.recommended.ignores,
    rules: {
      'supabase/subscribe-status-handler': ['error', { allowWrappers: ['subscribeOrThrow'] }],
    },
  },
];
