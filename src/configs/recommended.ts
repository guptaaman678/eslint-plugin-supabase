import type { ESLint, Linter } from 'eslint';
import { NAMESPACE } from '../meta.js';

/**
 * The rules need type information, so `recommended` applies to TypeScript-family files only
 * (ADR-011 item 6). A file outside this list is never handed to a typed rule, and a TypeScript
 * file linted without type information fails loudly with typescript-eslint's own error instead
 * of passing silently. Deno edge functions need a different TypeScript setup and are out of
 * scope for v0.1.
 */
export const TYPESCRIPT_FILES = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];
export const IGNORED_FILES = ['**/supabase/functions/**'];

/** Rule severities of `recommended`, filled in as rules land. */
export const recommendedRules: Linter.RulesRecord = {
  [`${NAMESPACE}/no-unsent-query`]: 'error',
  [`${NAMESPACE}/realtime-table-published`]: 'error',
  [`${NAMESPACE}/subscribe-status-handler`]: 'warn',
};

/**
 * `recommended`. With `migrationsHash` (from `discoveredHash`, recomputed at each config
 * evaluation), `eslint --cache` forgets results when the schema inputs change (ADR-012).
 */
export function createRecommended(plugin: ESLint.Plugin, migrationsHash?: string): Linter.Config {
  return {
    name: `${NAMESPACE}/recommended`,
    files: TYPESCRIPT_FILES,
    ignores: IGNORED_FILES,
    plugins: { [NAMESPACE]: plugin },
    rules: recommendedRules,
    ...(migrationsHash === undefined ? {} : { settings: { [NAMESPACE]: { migrationsHash } } }),
  };
}
