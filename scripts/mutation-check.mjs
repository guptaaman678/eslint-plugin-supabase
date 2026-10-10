#!/usr/bin/env node
// Re-checks Stryker's JSON report(s) after `npm run mutation`: the mutation score is at least the
// minimum, and every surviving mutant is explained in CONTRIBUTING.md's "Mutation notes" table.
// A note that matches no survivor in a file the reports cover is stale and fails too.
//
// Usage: node scripts/mutation-check.mjs [--min <score>] [report.json ...]
// With no report, reads reports/mutation/mutation.json. Several reports (one per folder, as CI
// runs them) are merged; a file may appear in only one of them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const DETECTED = new Set(['Killed', 'Timeout']);
const UNDETECTED = new Set(['Survived', 'NoCoverage']);

const args = process.argv.slice(2);
let min = 85;
const reports = [];
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--min') min = Number(args[++index]);
  else reports.push(args[index]);
}
if (reports.length === 0) reports.push(join(root, 'reports', 'mutation', 'mutation.json'));

/** One line of code, whitespace collapsed, as the notes table writes it. */
function normalize(text) {
  return text.split('\n')[0].replace(/\s+/g, ' ').trim();
}

/** The cells of a Markdown table row; `\|` is a pipe inside a cell, backticks are dropped. */
function cells(row) {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replaceAll('\\|', '|').trim().replace(/^`|`$/g, ''));
}

function readNotes() {
  const text = readFileSync(join(root, 'CONTRIBUTING.md'), 'utf8');
  const start = text.indexOf('\n## Mutation notes\n');
  if (start < 0) throw new Error('mutation-check: CONTRIBUTING.md has no "## Mutation notes"');
  const end = text.indexOf('\n## ', start + 1);
  const section = text.slice(start, end < 0 ? undefined : end);
  return section
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const [file, mutator, original, replacement, reason] = cells(line);
      if (!reason) throw new Error(`mutation-check: a note has no reason: ${line}`);
      return { file, mutator, original, replacement, used: false };
    });
}

const files = new Map();
for (const report of reports) {
  const parsed = JSON.parse(readFileSync(report, 'utf8'));
  for (const [file, entry] of Object.entries(parsed.files)) {
    if (files.has(file)) throw new Error(`mutation-check: ${file} is in more than one report`);
    files.set(file, entry);
  }
}

const notes = readNotes();
let detected = 0;
let undetected = 0;
const unexplained = [];
for (const [file, entry] of files) {
  const lines = entry.source.split('\n');
  for (const mutant of entry.mutants) {
    if (DETECTED.has(mutant.status)) detected++;
    // A slow runner can time out on a mutant that survives on a fast one: a note that matches
    // a timed-out mutant is still in use, not stale.
    if (!UNDETECTED.has(mutant.status) && mutant.status !== 'Timeout') continue;
    if (UNDETECTED.has(mutant.status)) undetected++;
    const { start, end } = mutant.location;
    const original = normalize(
      start.line === end.line
        ? lines[start.line - 1].slice(start.column - 1, end.column - 1)
        : lines[start.line - 1].slice(start.column - 1),
    );
    const replacement = normalize(mutant.replacement ?? '');
    const note = notes.find(
      (candidate) =>
        candidate.file === file &&
        candidate.mutator === mutant.mutatorName &&
        candidate.original === original &&
        candidate.replacement === replacement,
    );
    if (mutant.status === 'Timeout') {
      if (note !== undefined) note.used = true;
    } else if (note === undefined) {
      unexplained.push(
        `${file}:${start.line}:${start.column} ${mutant.mutatorName} \`${original}\` -> \`${replacement}\``,
      );
    } else note.used = true;
  }
}

const stale = notes.filter((note) => files.has(note.file) && !note.used);
const score = (100 * detected) / (detected + undetected);
console.log(
  `mutation-check: ${files.size} files, ${detected} detected, ${undetected} survived, score ${score.toFixed(2)} (minimum ${min})`,
);
for (const line of unexplained) console.log(`unexplained survivor: ${line}`);
for (const note of stale) {
  console.log(
    `stale note: ${note.file} ${note.mutator} \`${note.original}\` -> \`${note.replacement}\``,
  );
}
if (score < min || unexplained.length > 0 || stale.length > 0) process.exit(1);
console.log('mutation-check: OK');
