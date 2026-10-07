import prettier from 'prettier';

/** @type {import('eslint-doc-generator').GenerateOptions} */
const config = {
  pathRuleDoc: 'docs/rules/{name}.md',
  pathRuleList: 'README.md',
  ruleDocTitleFormat: 'desc',
  ruleDocSectionInclude: ['Rule details', 'When not to use it'],
  ruleListColumns: [
    'name',
    'description',
    'configsError',
    'configsWarn',
    'hasSuggestions',
    'requiresTypeChecking',
    'options',
  ],
  // Format the generated files as `format:check` expects, so `docs:check` and it agree.
  postprocess: async (content, path) =>
    prettier.format(content, { ...(await prettier.resolveConfig(path)), parser: 'markdown' }),
};

export default config;
