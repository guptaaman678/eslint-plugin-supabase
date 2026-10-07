import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter, type Rule } from 'eslint';
import parser from '@typescript-eslint/parser';
import {
  ESLintUtils,
  type ParserServicesWithTypeInformation,
  type TSESTree,
} from '@typescript-eslint/utils';
import type ts from 'typescript';

const TS_FIXTURE_DIR = fileURLToPath(new URL('../fixtures/ts', import.meta.url));

/** Typed parser services plus the checker, as a rule sees them. */
export interface Typed {
  readonly services: ParserServicesWithTypeInformation;
  readonly checker: ts.TypeChecker;
  /** The TypeScript node of an ESTree node. */
  readonly tsNode: (node: TSESTree.Node) => ts.Node;
  /** The source text of an ESTree node. */
  readonly text: (node: TSESTree.Node) => string;
}

/**
 * Lints `code` as `tests/fixtures/ts/<filename>` with type information and calls `visit` on
 * every node of type `selector`. Returns the visits' results that are not undefined, in order.
 */
export function collect<N extends TSESTree.Node, T>(
  code: string,
  selector: N['type'],
  visit: (node: N, typed: Typed) => T | undefined,
  filename = 'file.ts',
): T[] {
  const results: T[] = [];
  const rule: Rule.RuleModule = {
    meta: { type: 'problem', schema: [] },
    create(context) {
      // ESLint's and typescript-eslint's context types differ only in readonly markers.
      const services = ESLintUtils.getParserServices(
        context as unknown as Parameters<typeof ESLintUtils.getParserServices>[0],
      );
      const typed: Typed = {
        services,
        checker: services.program.getTypeChecker(),
        tsNode: (node) => services.esTreeNodeToTSNodeMap.get(node),
        text: (node) => context.sourceCode.getText(node as never),
      };
      const listener = (node: N) => {
        const result = visit(node, typed);
        if (result !== undefined) results.push(result);
      };
      return { [selector]: listener } as Rule.RuleListener;
    },
  };
  const linter = new Linter({ configType: 'flat' });
  const messages = linter.verify(
    code,
    [
      {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
          parser,
          parserOptions: { projectService: true, tsconfigRootDir: TS_FIXTURE_DIR },
        },
        plugins: { test: { rules: { collect: rule } } },
        rules: { 'test/collect': 'error' },
      },
    ],
    path.join(TS_FIXTURE_DIR, filename),
  );
  const fatal = messages.find((message) => message.fatal === true);
  if (fatal !== undefined) throw new Error(`${fatal.line}:${fatal.column} ${fatal.message}`);
  return results;
}

/** A Supabase client in the snippet: `supabase` (2.117), with `createClient` imported. */
export const CLIENT =
  "import { createClient, SupabaseClient } from '@supabase/supabase-js';\n" +
  "const supabase = createClient('http://localhost:54321', 'sb_publishable_test');\n";
