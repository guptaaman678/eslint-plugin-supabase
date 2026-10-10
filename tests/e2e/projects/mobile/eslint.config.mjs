import parser from '@typescript-eslint/parser';
import supabase from 'eslint-plugin-supabase';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  supabase.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'supabase/subscribe-status-handler': ['warn', { allowWrappers: ['subscribeLogged'] }],
    },
  },
];
