// Diagnostic only (branch agent/T9.5-corpus-diag, never merged): sparse-clone the given pins as
// scripts/corpus-regression.js does and print, per pin, the count of checked-out files by kind
// and the names of the files that are not linted (tsconfig, package.json, .d.ts), relative.
// Usage: node scripts/t95-clone-files.mjs <owner/repo,...>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const source = readFileSync(path.join(import.meta.dirname, 'corpus-regression.js'), 'utf8');
const SPARSE = JSON.parse(
  source
    .match(/const SPARSE = (\[[\s\S]*?\]);/)[1]
    .replace(/'/g, '"')
    .replace(/,(\s*\])/, '$1'),
);
const pins = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '..', 'tests', 'corpus', 'pins.json'), 'utf8'),
).pins;
const only = new Set(process.argv[2].split(','));
console.log(`git ${execFileSync('git', ['--version'], { encoding: 'utf8' }).trim()}`);
for (const pin of pins.filter((p) => only.has(new URL(p.url).pathname.slice(1)))) {
  const dir = mkdtempSync(path.join(tmpdir(), 't95-clone-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('remote', 'add', 'origin', `${pin.url}.git`);
  git('config', 'core.sparseCheckout', 'true');
  writeFileSync(path.join(dir, '.git', 'info', 'sparse-checkout'), `${SPARSE.join('\n')}\n`);
  git('fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', pin.sha);
  git('checkout', '-q', 'FETCH_HEAD');
  const files = readdirSync(dir, { recursive: true })
    .map((f) => f.split(path.sep).join('/'))
    .filter((f) => !f.startsWith('.git/') && f !== '.git' && !f.includes('node_modules/'));
  const kinds = {};
  for (const f of files) {
    const kind = path.extname(f) || '(none)';
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
  const notLinted = files.filter((f) => /(^|\/)(tsconfig[^/]*\.json|package\.json)$|\.d\.ts$/.test(f));
  const hash = (list) => createHash('sha256').update(list.sort().join('\n')).digest('hex').slice(0, 16);
  console.log(
    `PIN ${new URL(pin.url).pathname.slice(1)} entries ${files.length} ${JSON.stringify(kinds)} all ${hash(files)} notLinted ${notLinted.length} ${hash(notLinted)}`,
  );
  if (process.env.T95_LIST) for (const f of files.sort()) console.log(`  ${f}`);
  rmSync(dir, { recursive: true, force: true });
}
