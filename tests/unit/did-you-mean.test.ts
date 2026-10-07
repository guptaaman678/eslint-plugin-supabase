import { describe, expect, it } from 'vitest';
import { didYouMean, editDistance } from '../../src/util/did-you-mean.js';

describe('editDistance', () => {
  it.each([
    ['', '', 0],
    ['abc', '', 3],
    ['', 'abc', 3],
    ['projectdir', 'projectDir', 0],
    ['kitten', 'sitting', 3],
    ['role', 'roles', 1],
  ])('%s -> %s = %i', (a, b, distance) => {
    expect(editDistance(a, b)).toBe(distance);
  });
});

describe('didYouMean', () => {
  const keys = ['projectDir', 'defaultRoles', 'unknownKey'];

  it('suggests the closest key within one edit per three characters', () => {
    expect(didYouMean('projectdir', keys)).toBe('projectDir');
    expect(didYouMean('defaultRole', keys)).toBe('defaultRoles');
    expect(didYouMean('unknownkye', keys)).toBe('unknownKey');
  });

  it('prefers the nearer of two candidates', () => {
    expect(didYouMean('anom', ['anon', 'anom1'])).toBe('anon');
    expect(didYouMean('abcd', ['abxy', 'abcx'])).toBe('abcx');
  });

  it('suggests nothing when every candidate is too far', () => {
    expect(didYouMean('colour', keys)).toBeUndefined();
    expect(didYouMean('ab', ['xy'])).toBeUndefined();
    expect(didYouMean('x', [])).toBeUndefined();
  });
});
