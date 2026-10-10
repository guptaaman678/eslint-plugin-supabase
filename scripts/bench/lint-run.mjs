// One benchmark run in a fresh process: `eslint .` on a synthetic app through the ESLint Node API
// with `stats: true` (the per-rule times `TIMING` prints), written as JSON to `out`.
// Usage: node --expose-gc lint-run.mjs <app> <config> <off|N> <out> [change]
// With `change` (only with `off`), it then edits a migration, lints one file again in the same
// process (the cold snapshot after a migration change), and restores the migration.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { ESLint } from 'eslint';

const [app, config, concurrency, out, change] = process.argv.slice(2);
const PLUGIN = 'supabase/';

/** Per-file times in ms: the plugin's rules, the other rules, parsing, and the whole file. */
function times(result) {
  let plugin = 0;
  let rules = 0;
  let parse = 0;
  let total = 0;
  for (const pass of result.stats?.times.passes ?? []) {
    parse += pass.parse?.total ?? 0;
    total += pass.total;
    for (const [id, { total: ms }] of Object.entries(pass.rules ?? {})) {
      if (id.startsWith(PLUGIN)) plugin += ms;
      else rules += ms;
    }
  }
  return {
    file: path.relative(app, result.filePath).split(path.sep).join('/'),
    plugin,
    rules,
    parse,
    total,
  };
}

const eslint = new ESLint({
  cwd: app,
  overrideConfigFile: config,
  stats: true,
  concurrency: concurrency === 'off' ? 'off' : Number(concurrency),
});
const start = performance.now();
const results = await eslint.lintFiles(['.']);
const wallMs = performance.now() - start;

/** Rule time summed over files, for every rule. */
const byRule = {};
for (const result of results) {
  for (const pass of result.stats?.times.passes ?? []) {
    for (const [id, { total: ms }] of Object.entries(pass.rules ?? {}))
      byRule[id] = (byRule[id] ?? 0) + ms;
  }
}

const report = {
  wallMs,
  byRule,
  files: results.map(times),
  messages: results.reduce((n, r) => n + r.messages.length, 0),
  fatal: results.reduce((n, r) => n + r.messages.filter((m) => m.fatal === true).length, 0),
  changes: [],
};

if (change === 'change') {
  const migrations = path.join(app, 'supabase', 'migrations');
  const target = path.join(
    migrations,
    readFileSync(path.join(app, '.last-migration'), 'utf8').trim(),
  );
  const original = readFileSync(target, 'utf8');
  const probe = path.join(app, 'src', 'features', 'f1.ts');
  try {
    // Past the cache's freshness window, so the next lint compares the inputs again.
    for (const content of [`${original}\ncomment on table public.t0 is 'bench';\n`, original]) {
      writeFileSync(target, content);
      await sleep(300);
      const [result] = await eslint.lintFiles([probe]);
      report.changes.push(times(result));
    }
  } finally {
    writeFileSync(target, original);
  }
}

writeFileSync(out, JSON.stringify(report));
