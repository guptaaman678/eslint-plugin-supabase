import { readFileSync } from 'node:fs';
import { Linter } from 'eslint';
import parser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import plugin from '../../src/index.js';
import { TS_FIXTURE_DIR } from '../harness/rule-tester.js';

interface Example {
  readonly kind: 'incorrect' | 'correct';
  readonly code: string;
  readonly line: number;
}

/**
 * The `ts` code blocks of a rule doc that follow a line marking them as **incorrect** or
 * **correct** (as in "Examples of **incorrect** code for this rule:").
 */
function docExamples(markdown: string): Example[] {
  const lines = markdown.split('\n');
  const examples: Example[] = [];
  let kind: Example['kind'] | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const marker = /\*\*(incorrect|correct)\*\*/.exec(line);
    if (marker !== null) kind = marker[1] as Example['kind'];
    if (line !== '```ts' || kind === undefined) continue;
    const end = lines.indexOf('```', i + 1);
    examples.push({ kind, code: lines.slice(i + 1, end).join('\n'), line: i + 1 });
    kind = undefined;
    i = end;
  }
  return examples;
}

function lint(rule: string, code: string): Linter.LintMessage[] {
  return new Linter({ configType: 'flat' }).verify(
    code,
    [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser,
          parserOptions: { projectService: true, tsconfigRootDir: TS_FIXTURE_DIR },
        },
        plugins: { supabase: plugin },
        rules: { [`supabase/${rule}`]: 'error' },
      },
    ],
    `${TS_FIXTURE_DIR}/file.ts`,
  );
}

describe('docExamples', () => {
  it('takes the ts blocks after a marker, one block per marker', () => {
    const markdown = [
      '```ts',
      'unmarked();',
      '```',
      'Examples of **incorrect** code:',
      '',
      '```ts',
      'bad();',
      '```',
      '```ts',
      'unmarked();',
      '```',
      'Examples of **correct** code:',
      '```js',
      'notTs();',
      '```',
      '```ts',
      'good();',
      'good();',
      '```',
    ].join('\n');
    expect(docExamples(markdown)).toEqual([
      { kind: 'incorrect', code: 'bad();', line: 6 },
      { kind: 'correct', code: 'good();\ngood();', line: 16 },
    ]);
  });
});

// Checklist of spec Phase 4: the docs examples are linted (the invalid example reports, the
// valid one does not).
describe.each(Object.keys(plugin.rules))('docs/rules/%s.md examples', (rule) => {
  const markdown = readFileSync(new URL(`../../docs/rules/${rule}.md`, import.meta.url), 'utf8');
  const examples = docExamples(markdown);

  it('has at least one incorrect and one correct example', () => {
    expect(examples.some((example) => example.kind === 'incorrect')).toBe(true);
    expect(examples.some((example) => example.kind === 'correct')).toBe(true);
  });

  it.each(examples.map((example) => [example.line, example] as const))(
    'example at line %i',
    (_, example) => {
      const messages = lint(rule, example.code);
      if (example.kind === 'correct') {
        expect(messages).toEqual([]);
      } else {
        expect(messages.length).toBeGreaterThan(0);
        expect(messages.every((message) => message.ruleId === `supabase/${rule}`)).toBe(true);
      }
    },
  );
});
