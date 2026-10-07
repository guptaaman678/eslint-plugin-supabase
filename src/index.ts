import type { TSESLint } from '@typescript-eslint/utils';
import type { ESLint, Linter, Rule } from 'eslint';
import { createRecommended } from './configs/recommended.js';
import { NAMESPACE, PACKAGE_NAME, PACKAGE_VERSION } from './meta.js';
import { noUnsentQuery } from './rules/no-unsent-query.js';

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
  configs: {} as { recommended: Linter.Config },
} satisfies ESLint.Plugin;

plugin.configs.recommended = createRecommended(plugin);

export default plugin;
