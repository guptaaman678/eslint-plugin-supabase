import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import { readSettings } from '../../src/settings.js';
import { createRule } from '../../src/util/create-rule.js';

/**
 * Test-only rule that proves the harness: it reads `settings.supabase` (so invalid settings
 * throw) and reports variables whose type is supabase-js's `SupabaseClient`, which needs the
 * type checker and the real supabase-js declarations.
 */
export const dummyRule = createRule({
  name: 'dummy-typed',
  meta: {
    type: 'problem',
    docs: {
      description: 'Report variables typed as a supabase-js client (test only)',
      requiresTypeChecking: true,
    },
    messages: {
      client: '`{{name}}` is a {{type}} from {{module}}; unknownKey is {{unknownKey}}.',
    },
    schema: [],
  },
  create(context) {
    const settings = readSettings(context);
    const services = ESLintUtils.getParserServices(context);
    return {
      VariableDeclarator(node) {
        if (node.id.type !== AST_NODE_TYPES.Identifier) return;
        const symbol = services.getTypeAtLocation(node.id).getSymbol();
        const file = symbol?.declarations?.[0]?.getSourceFile().fileName ?? '';
        if (symbol?.getName() !== 'SupabaseClient' || !file.includes('/node_modules/@supabase/')) {
          return;
        }
        context.report({
          node: node.id,
          messageId: 'client',
          data: {
            name: node.id.name,
            type: symbol.getName(),
            module: /node_modules\/(@supabase\/[^/]+)\//.exec(file)?.[1],
            unknownKey: settings.unknownKey,
          },
        });
      },
    };
  },
});
