import { threadId } from 'node:worker_threads';
import type { ESLint, Linter, Rule } from 'eslint';
import { createWithProject, discoveredHash } from '../../src/configs/project.js';
import { createRecommended } from '../../src/configs/recommended.js';
import { fakeEngine } from './fake-engine.js';

/**
 * Bundled by `tests/integration/eslint-cache.test.ts` and loaded by the ESLint CLI in every
 * thread. Rule `supabase/probe` reports the `migrationsHash` it sees and the run label from
 * `PROBE_RUN`, so a result restored from `--cache` shows an earlier run's label.
 */
const probe: Rule.RuleModule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { probe: 'hash={{hash}} run={{run}} thread={{thread}}' },
  },
  create(context) {
    const settings = context.settings.supabase as { migrationsHash?: string } | undefined;
    return {
      Program(node) {
        context.report({
          node,
          messageId: 'probe',
          data: {
            hash: settings?.migrationsHash ?? 'none',
            run: process.env.PROBE_RUN ?? '',
            thread: String(threadId),
          },
        });
      },
    };
  },
};

export const plugin: ESLint.Plugin = { meta: { name: 'probe' }, rules: { probe } };

const engine = fakeEngine('0.3.0');

export const withProject = createWithProject(plugin, engine);

/** `recommended` as the plugin builds it when ESLint runs in `cwd`. */
export function recommendedAt(cwd: string): Linter.Config {
  return createRecommended(plugin, discoveredHash(engine, cwd));
}
