// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPlugin from 'eslint-plugin-eslint-plugin';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // The e2e projects are linted by `tests/e2e/projects.test.ts` and the demo project by
  // `media/demo/check.mjs`, each with its own config.
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'reports/**',
      '.bench/**',
      '.stryker-tmp/**',
      '.changeset/**',
      'tests/e2e/projects/**',
      'media/demo/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked, eslintPlugin.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  prettierConfig,
);
