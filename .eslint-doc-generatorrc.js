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
};

export default config;
