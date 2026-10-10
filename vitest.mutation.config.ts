import { defineConfig } from 'vitest/config';
import base from './vitest.config.js';

// Used by Stryker (`npm run mutation`). Stryker switches mutants inside the test process, so
// tests that build the plugin and lint in a child process never see an active mutant; they only
// slow every run down with a tsup build. (mergeConfig would append to `include`, so the object
// is spread.)
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      'tests/e2e/**',
      'tests/integration/eslint-cache.test.ts',
      'tests/unit/require-stub.test.ts',
    ],
    setupFiles: ['tests/stryker-name-filter.ts'],
  },
});
