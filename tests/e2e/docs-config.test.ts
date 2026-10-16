import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The documented setup must lint a project with edge functions and `.js` files without errors.
 * `projects/quickstart` proves it end to end (`projects.test.ts`); this test keeps its config equal
 * to the README's quick start with the override of docs/configuration.md, and checks that every
 * documented config sets the plugin's rules only where `recommended` registers the plugin.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/** The bodies of the fenced `js` blocks of a markdown file. */
function jsBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/^```js\n([\s\S]*?)^```$/gm)].map((match) => match[1]!);
}

const DOCS = [
  'README.md',
  'docs/configuration.md',
  ...readdirSync(path.join(ROOT, 'docs', 'rules')).map((file) => `docs/rules/${file}`),
];
const TYPED_BLOCK = "    files: ['**/*.ts', '**/*.tsx'],\n";
const IGNORE_FUNCTIONS = "    ignores: ['**/supabase/functions/**'],\n";
const SCOPED_RULES = [
  '    files: supabase.configs.recommended.files,',
  '    ignores: supabase.configs.recommended.ignores,',
  '    rules: {',
].join('\n');

describe('documented configs', () => {
  it('the quickstart e2e config is the README quick start plus the documented override', () => {
    const quickStart = jsBlocks(read('README.md')).filter((body) =>
      body.startsWith('// eslint.config.mjs\n'),
    );
    expect(quickStart).toHaveLength(1);
    const override = jsBlocks(read('docs/configuration.md')).filter((body) =>
      body.includes("'supabase/subscribe-status-handler'"),
    );
    expect(override).toHaveLength(1);
    const overrideObject = override[0]!.slice(
      override[0]!.indexOf('  supabase.configs.recommended,\n') +
        '  supabase.configs.recommended,\n'.length,
      override[0]!.lastIndexOf('];'),
    );

    const fixture = read('tests/e2e/projects/quickstart/eslint.config.mjs');
    const body = fixture.slice(fixture.indexOf('import '));
    const documented = quickStart[0]!.slice(quickStart[0]!.indexOf('import '));
    expect(body).toBe(documented.replace(/\];\n$/, `${overrideObject}];\n`));
  });

  it.each(DOCS)('%s keeps edge functions out of typed linting', (file) => {
    for (const body of jsBlocks(read(file)).filter((b) => b.includes(TYPED_BLOCK))) {
      expect(body).toContain(TYPED_BLOCK + IGNORE_FUNCTIONS);
    }
  });

  it.each(DOCS)('%s scopes every rule override to the files of recommended', (file) => {
    for (const body of jsBlocks(read(file)).filter((b) => b.includes("'supabase/"))) {
      expect(body).toContain(SCOPED_RULES);
    }
  });
});
