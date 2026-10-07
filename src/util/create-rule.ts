import { ESLintUtils } from '@typescript-eslint/utils';
import { PACKAGE_VERSION, REPO_URL } from '../meta.js';

/** Extra `meta.docs` fields every rule of this plugin declares. */
export interface SupabaseRuleDocs {
  /** Whether the rule is in the `recommended` config (read by eslint-doc-generator). */
  recommended?: boolean;
  /** Every rule here reads types, so this is always true. */
  requiresTypeChecking: true;
}

/** The docs URL of a rule, pinned to the release tag of this version. */
export function ruleDocsUrl(name: string, version: string = PACKAGE_VERSION): string {
  return `${REPO_URL}/blob/v${version}/docs/rules/${name}.md`;
}

/**
 * Creates a rule with a pinned docs URL. Rule meta conventions (spec §6.6, ADR-011 item 5):
 * a rule without options has `schema: []` and no `meta.defaultOptions`; a rule with options
 * gives every schema property a `description` and keeps defaults out of the schema (they go
 * in `meta.defaultOptions`, which ESLint 9.15 and later merge, and RuleCreator applies too).
 */
export const createRule = ESLintUtils.RuleCreator<SupabaseRuleDocs>((name) => ruleDocsUrl(name));
