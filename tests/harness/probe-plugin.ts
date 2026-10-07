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

const projectConfig = createWithProject(plugin, engine);

// Both helpers drop the real rules: the probe plugin does not have them, and the test files are
// untyped JavaScript. The settings, which carry the hash, are the plugin's own.

/** The plugin's `withProject`, around the probe plugin. */
export function withProject(options: Parameters<typeof projectConfig>[0]): Linter.Config {
  return { ...projectConfig(options), rules: {} };
}

/** `recommended` as the plugin builds it when ESLint runs in `cwd`. */
export function recommendedAt(cwd: string): Linter.Config {
  return { ...createRecommended(plugin, discoveredHash(engine, cwd)), rules: {} };
}
