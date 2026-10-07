import { fileURLToPath } from 'node:url';
import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

/** The typed fixture project: its tsconfig includes `file.ts` and `react.tsx`. */
export const TS_FIXTURE_DIR = fileURLToPath(new URL('../fixtures/ts', import.meta.url));

/** A schema fixture project, `tests/fixtures/schemas/<name>/`. */
export function schemaFixture(name: string): string {
  return fileURLToPath(new URL(`../fixtures/schemas/${name}`, import.meta.url));
}

/**
 * A RuleTester with type information: each case is linted as `tests/fixtures/ts/file.ts` (or
 * `react.tsx`), so supabase-js resolves from this package's devDependencies.
 */
export function createRuleTester(settings: Record<string, unknown> = {}): RuleTester {
  return new RuleTester({
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: TS_FIXTURE_DIR,
      },
    },
    settings,
  });
}
