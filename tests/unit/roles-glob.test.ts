import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { globToRegExp, matchesGlob } from '../../src/roles/glob.js';

function matches(glob: string, relative: string): boolean {
  return globToRegExp(glob)!.test(relative);
}

describe('globToRegExp', () => {
  it.each([
    ['src/**/*.ts', 'src/a.ts', true],
    ['src/**/*.ts', 'src/lib/db/a.ts', true],
    ['src/**/*.ts', 'lib/a.ts', false],
    ['src/**/*.ts', 'src/a.tsx', false],
    ['**', 'any/depth/file.ts', true],
    ['src/**', 'src/a/b.ts', true],
    ['*.ts', 'a.ts', true],
    ['*.ts', 'src/a.ts', false],
    ['lib/?.ts', 'lib/a.ts', true],
    ['lib/?.ts', 'lib/ab.ts', false],
    ['lib/?.ts', 'lib//.ts', false],
    ['lib/{admin,server}.ts', 'lib/admin.ts', true],
    ['lib/{admin,server}.ts', 'lib/server.ts', true],
    ['lib/{admin,server}.ts', 'lib/client.ts', false],
    ['./lib/admin.ts', 'lib/admin.ts', true],
    ['a,b.ts', 'a,b.ts', true],
    ['x}.ts', 'x}.ts', true],
    ['{a,{b}', '{b', true],
    ['a+b(c)[d]^$|.ts', 'a+b(c)[d]^$|.ts', true],
    ['a.ts', 'abts', false],
  ])('%s against %s: %s', (glob, relative, expected) => {
    expect(matches(glob, relative)).toBe(expected);
  });

  it('is undefined for an unclosed brace', () => {
    expect(globToRegExp('src/{a,b.ts')).toBeUndefined();
  });
});

describe('matchesGlob', () => {
  const root = path.resolve('/project');

  it('matches paths relative to the project directory', () => {
    expect(matchesGlob('src/*.ts', path.join(root, 'src', 'db.ts'), root)).toBe(true);
    expect(matchesGlob('src/*.ts', path.join(root, 'lib', 'db.ts'), root)).toBe(false);
    // Compiled once, then reused.
    expect(matchesGlob('src/*.ts', path.join(root, 'src', 'x.ts'), root)).toBe(true);
  });

  it('never matches outside the project, or with an invalid glob', () => {
    expect(matchesGlob('**', path.resolve('/elsewhere/db.ts'), root)).toBe(false);
    expect(matchesGlob('../**', path.resolve('/elsewhere/db.ts'), root)).toBe(false);
    expect(matchesGlob('src/{a', path.join(root, 'src', '{a'), root)).toBe(false);
  });
});
