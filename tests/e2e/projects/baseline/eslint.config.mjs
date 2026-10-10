import parser from '@typescript-eslint/parser';
import supabase from 'eslint-plugin-supabase';

export default [
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  supabase.configs.recommended,
];
