import parser from '@typescript-eslint/parser';
import { Linter } from 'eslint';
import { afterEach, describe, expect, it, vi } from 'vitest';
import plugin from '../../src/index.js';
import { stats } from '../../src/stats.js';
import { TS_FIXTURE_DIR } from '../harness/rule-tester.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('every rule counts the files it runs on (§6.5 stats)', () => {
  it.each(Object.keys(plugin.rules ?? {}))('%s', (name) => {
    const recordFile = vi.spyOn(stats, 'recordFile');
    const filename = `${TS_FIXTURE_DIR}/file.ts`;
    new Linter({ configType: 'flat' }).verify(
      'export const x = 1;',
      [
        {
          files: ['**/*.ts'],
          languageOptions: {
            parser,
            parserOptions: { projectService: true, tsconfigRootDir: TS_FIXTURE_DIR },
          },
          plugins: { supabase: plugin },
          rules: { [`supabase/${name}`]: 'error' },
        },
      ],
      filename,
    );
    expect(recordFile).toHaveBeenCalledWith(filename);
  });
});
