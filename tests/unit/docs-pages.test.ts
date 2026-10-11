import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PACKAGE_VERSION, REPO_URL } from '../../src/meta.js';
import plugin from '../../src/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const rulesDir = path.join(root, 'docs/rules');

/** The Markdown pages users read: the README and everything under docs/. */
const PAGES = [
  'README.md',
  ...readdirSync(path.join(root, 'docs'), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.md'))
    .map((file) => path.posix.join('docs', file.split(path.sep).join('/'))),
];

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function anchors(markdown: string): Set<string> {
  const withoutCode = markdown.replace(/^```[\s\S]*?^```/gm, '');
  return new Set([...withoutCode.matchAll(/^#{1,6} (.+)$/gm)].map((match) => slug(match[1]!)));
}

/** Relative links of a page, as [target file, anchor]. External links are not followed. */
function relativeLinks(markdown: string): [string, string | undefined][] {
  const withoutCode = markdown.replace(/^```[\s\S]*?^```/gm, '');
  return [...withoutCode.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((match) => match[1]!)
    .filter((target) => !/^[a-z]+:/.test(target))
    .map((target) => {
      const [file = '', anchor] = target.split('#');
      return [file, anchor];
    });
}

describe('rule docs pages', () => {
  it('has exactly one page per registered rule', () => {
    const pages = readdirSync(rulesDir)
      .filter((file) => file.endsWith('.md'))
      .map((file) => file.slice(0, -'.md'.length));
    expect(pages.sort()).toEqual(Object.keys(plugin.rules).sort());
  });

  describe.each(Object.entries(plugin.rules))('%s', (name, rule) => {
    it('links a docs URL at the release tag that maps to an existing file', () => {
      const prefix = `${REPO_URL}/blob/v${PACKAGE_VERSION}/`;
      const url = rule.meta?.docs?.url ?? '';
      expect(url.startsWith(prefix)).toBe(true);
      const file = url.slice(prefix.length);
      expect(file).toBe(`docs/rules/${name}.md`);
      expect(existsSync(path.join(root, file))).toBe(true);
    });
  });
});

describe('relative links', () => {
  it.each(PAGES)('in %s resolve to a file and heading', (page) => {
    const markdown = readFileSync(path.join(root, page), 'utf8');
    for (const [file, anchor] of relativeLinks(markdown)) {
      const target = path.join(root, path.dirname(page), file === '' ? path.basename(page) : file);
      expect(existsSync(target), `${page}: ${file}`).toBe(true);
      if (anchor !== undefined) {
        expect(anchors(readFileSync(target, 'utf8')), `${page}: ${file}#${anchor}`).toContain(
          anchor,
        );
      }
    }
  });
});

describe('reference pages', () => {
  it.each(['docs/configuration.md', 'docs/how-it-works.md', 'docs/faq.md'])('%s exists', (page) => {
    expect(existsSync(path.join(root, page))).toBe(true);
  });
});
