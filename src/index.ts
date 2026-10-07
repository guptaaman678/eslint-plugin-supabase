import type { TSESLint } from '@typescript-eslint/utils';
import type { ESLint, Linter, Rule } from 'eslint';
import { createWithProject, discoveredHash, type ProjectOptions } from './configs/project.js';
import { createRecommended } from './configs/recommended.js';
import { NAMESPACE, PACKAGE_NAME, PACKAGE_VERSION } from './meta.js';
import { noUnsentQuery } from './rules/no-unsent-query.js';
import { engine, loadEngine } from './schema/engine.js';

// ADR-016 (a'): load the SQL parser before ESLint runs a rule, so rules replay migrations
// synchronously in their own thread. This top-level await is why the plugin cannot be
// `require()`d; the package's `require` condition points to a stub that says so.
await loadEngine();

/** Every rule of the plugin, by name without the `supabase/` prefix. */
const rules: Record<string, TSESLint.RuleModule<string, readonly unknown[]>> = {
  'no-unsent-query': noUnsentQuery,
};

// The public objects carry ESLint's own types, so `defineConfig` from `eslint/config` accepts
// them. typescript-eslint's rule type differs only in marking `defaultOptions` readonly.
const plugin = {
  meta: {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    namespace: NAMESPACE,
  },
  rules: rules as unknown as Record<string, Rule.RuleModule>,
  configs: {
    /**
     * Built at each config evaluation, so its `migrationsHash` (for the project discovered from
     * the working directory) is current in every thread and after an editor reloads the config.
     */
    get recommended(): Linter.Config {
      return createRecommended(plugin, discoveredHash(engine, process.cwd()));
    },
  },
  /** `recommended` for one Supabase project: monorepos and custom project directories. */
  withProject: (options: ProjectOptions): Linter.Config => withProject(options),
} satisfies ESLint.Plugin & { withProject: unknown };

const withProject = createWithProject(plugin, engine);

export type { ProjectOptions };
export default plugin;
