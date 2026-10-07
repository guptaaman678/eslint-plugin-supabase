import { defineConfig } from 'vitest/config';

const FULL = { lines: 100, branches: 100, functions: 100, statements: 100 };

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      // Spec §6.10: 100% on the rule, schema, role and detection code; 95% overall.
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
        'src/rules/**': FULL,
        'src/schema/**': FULL,
        'src/roles/**': FULL,
        'src/supabase/**': FULL,
        'src/stats.ts': FULL,
      },
    },
  },
});
