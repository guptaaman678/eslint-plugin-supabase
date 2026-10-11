#!/usr/bin/env node
// Editor performance benchmark (§6.8). Generates synthetic apps (200 source files; 100 and 500
// migrations), lints each in fresh processes with `--concurrency off` and `4`, with and without the
// plugin, and checks the budgets. Run after `npm run build` (`npm run bench` does both).
//
// Options: --out <dir> (results, default .bench/results), --runs <n> (default 3; each measure is
// the median over runs), --budget-scale <x> (multiplies every budget; 0.1 is the negative control).
// Exit code 1 when a budget is missed.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeApp } from './bench/generate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORK = path.join(ROOT, '.bench');
const BENCH = path.join(ROOT, 'scripts', 'bench');

function option(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const OUT = path.resolve(option('--out', path.join(WORK, 'results')));
const RUNS = Number(option('--runs', '3'));
const SCALE = Number(option('--budget-scale', '1'));
const MIGRATIONS = [100, 500];
const CONCURRENCY = ['off', '4'];

const median = (xs) => quantile(xs, 0.5);
function quantile(xs, q) {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.ceil(pos)] - s[lo]) * (pos - lo);
}
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// Install the built plugin where the apps resolve `eslint-plugin-supabase`; its dependencies and
// typescript-eslint resolve from the repository's node_modules.
function setup() {
  const dist = path.join(ROOT, 'dist', 'index.js');
  if (!existsSync(dist)) throw new Error('dist/index.js is missing: run `npm run build` first.');
  rmSync(WORK, { recursive: true, force: true });
  const installed = path.join(WORK, 'node_modules', 'eslint-plugin-supabase');
  mkdirSync(installed, { recursive: true });
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const manifest = {
    name: pkg.name,
    version: pkg.version,
    type: 'module',
    exports: { '.': './dist/index.js' },
    dependencies: pkg.dependencies,
  };
  writeFileSync(path.join(installed, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  cpSync(path.join(ROOT, 'dist'), path.join(installed, 'dist'), { recursive: true });
  const apps = {};
  for (const m of MIGRATIONS) {
    const app = path.join(WORK, `app-${m}`);
    const migrations = writeApp(app, m, path.join(BENCH, 'probe.mjs'));
    writeFileSync(path.join(app, '.last-migration'), `${path.basename(migrations.at(-1))}\n`);
    apps[m] = app;
  }
  return apps;
}

function run(script, args, cwd, env = {}) {
  const r = spawnSync(process.execPath, ['--expose-gc', path.join(BENCH, script), ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (r.status !== 0)
    throw new Error(`${script} ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);
}

/** One lint run; returns its report, the probe's per-thread records and the plugin's stats. */
function lint(app, config, concurrency, change) {
  const dir = path.join(WORK, 'runs', `${path.basename(app)}-${config}-${concurrency}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'report.json');
  const args = [
    app,
    path.join(app, `eslint.${config}.mjs`),
    concurrency,
    out,
    ...(change ? ['change'] : []),
  ];
  run('lint-run.mjs', args, app, {
    BENCH_PROBE_DIR: dir,
    ESLINT_PLUGIN_SUPABASE_STATS: path.join(dir, 'stats'),
  });
  const report = JSON.parse(readFileSync(out, 'utf8'));
  const threads = [];
  const stats = [];
  for (const name of readdirSync(dir)) {
    const data = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
    if (/^\d+\.json$/.test(name)) threads.push(data);
    else if (name.startsWith('stats.')) stats.push(data);
  }
  if (report.files.length !== 200)
    throw new Error(`${dir}: linted ${report.files.length} files, expected 200`);
  if (report.fatal !== 0) throw new Error(`${dir}: ${report.fatal} fatal messages`);
  return { report, threads, stats };
}

/** The measures of one run of one app and concurrency. */
function measure(app, full, base) {
  const byFile = new Map(full.report.files.map((f) => [f.file, f]));
  const rel = (f) => path.relative(app, f).split(path.sep).join('/');
  // The first file a thread lints that queries the schema builds that thread's snapshot.
  const coldFiles = full.threads.map((t) =>
    t.files.map(rel).find((f) => f.startsWith('src/features/')),
  );
  const cold = coldFiles.map((f) => byFile.get(f).plugin);
  const warm = full.report.files.filter((f) => !coldFiles.includes(f.file)).map((f) => f.plugin);
  const skips = {};
  for (const s of full.stats)
    for (const [k, v] of Object.entries(s.skips)) skips[k] = (skips[k] ?? 0) + v;
  const heap = (r) => sum(r.threads.map((t) => t.heapUsed));
  return {
    threads: full.threads.length,
    coldMax: Math.max(...cold),
    coldSum: sum(cold),
    changeCold:
      full.report.changes.length === 0
        ? null
        : Math.max(...full.report.changes.map((c) => c.plugin)),
    warmMedian: median(warm),
    warmP95: quantile(warm, 0.95),
    warmSamples: warm.length,
    pluginMs: sum(full.report.files.map((f) => f.plugin)),
    baseTotalMs: sum(base.report.files.map((f) => f.total)),
    sharePct:
      (100 * sum(full.report.files.map((f) => f.plugin))) /
      sum(base.report.files.map((f) => f.total)),
    // The same share without each thread's cold snapshot, which the cold budgets cover.
    shareWarmPct:
      (100 * (sum(full.report.files.map((f) => f.plugin)) - sum(cold))) /
      sum(base.report.files.map((f) => f.total)),
    shareOfRulesPct:
      (100 * sum(full.report.files.map((f) => f.plugin))) /
      sum(full.report.files.map((f) => f.rules)),
    wallFullMs: full.report.wallMs,
    wallBaseMs: base.report.wallMs,
    memoryPerThreadMB: (heap(full) - heap(base)) / full.threads.length / 2 ** 20,
    messages: full.report.messages,
    calls: sum(full.stats.map((s) => s.calls)),
    skips,
  };
}

function machine() {
  const tryRun = (cmd, args) => {
    try {
      return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  };
  return {
    model: process.platform === 'darwin' ? tryRun('sysctl', ['-n', 'hw.model']) : null,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
    memoryGB: Math.round(os.totalmem() / 2 ** 30),
    node: process.version,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    osVersion: process.platform === 'darwin' ? tryRun('sw_vers', ['-productVersion']) : null,
  };
}

const apps = setup();
const perRun = [];
for (let r = 0; r < RUNS; r++) {
  const entry = { memory: {}, measures: {} };
  for (const m of MIGRATIONS) {
    const memOut = path.join(WORK, `memory-${m}.json`);
    run('memory-run.mjs', [apps[m], memOut], ROOT);
    entry.memory[m] = JSON.parse(readFileSync(memOut, 'utf8'));
    for (const c of CONCURRENCY) {
      const full = lint(apps[m], 'full', c, c === 'off');
      const base = lint(apps[m], 'base', c, false);
      entry.measures[`${m}/${c}`] = measure(apps[m], full, base);
    }
  }
  perRun.push(entry);
  process.stdout.write(`run ${r + 1}/${RUNS} done\n`);
}

// Median over runs of every numeric measure.
const measures = {};
for (const key of Object.keys(perRun[0].measures)) {
  const runs = perRun.map((e) => e.measures[key]);
  measures[key] = {};
  for (const [k, v] of Object.entries(runs[0])) {
    measures[key][k] = typeof v === 'number' ? median(runs.map((x) => x[k])) : v;
  }
}
const snapshotMB = Object.fromEntries(
  MIGRATIONS.map((m) => [m, median(perRun.map((e) => e.memory[m].retainedBytes)) / 2 ** 20]),
);

const worst = (m, k) => Math.max(...CONCURRENCY.map((c) => measures[`${m}/${c}`][k] ?? -Infinity));
const budgets = [
  {
    id: 'cold-100',
    what: 'Cold snapshot, 100 migrations (max over threads, start and after a change)',
    unit: 'ms',
    limit: 300,
    value: Math.max(worst(100, 'coldMax'), worst(100, 'changeCold')),
  },
  {
    id: 'cold-500',
    what: 'Cold snapshot, 500 migrations (max over threads, start and after a change)',
    unit: 'ms',
    limit: 1000,
    value: Math.max(worst(500, 'coldMax'), worst(500, 'changeCold')),
  },
  {
    id: 'warm-median-100',
    what: 'Warm per-file overhead, median, 100 migrations',
    unit: 'ms',
    limit: 2,
    value: worst(100, 'warmMedian'),
  },
  {
    id: 'warm-p95-100',
    what: 'Warm per-file overhead, p95, 100 migrations',
    unit: 'ms',
    limit: 10,
    value: worst(100, 'warmP95'),
  },
  // The share budgets leave out each thread's first replay, which the cold budgets cover. The
  // share with it included is still reported in the measures table.
  {
    id: 'share-100',
    what: "Plugin rule time over typescript-eslint alone, without each thread's first replay, 200 files, 100 migrations",
    unit: '%',
    limit: 10,
    value: worst(100, 'shareWarmPct'),
  },
  {
    id: 'share-500',
    what: "Plugin rule time over typescript-eslint alone, without each thread's first replay, 200 files, 500 migrations",
    unit: '%',
    limit: 10,
    value: worst(500, 'shareWarmPct'),
  },
  {
    id: 'memory-500',
    what: 'Memory held per thread, 500 migrations (heap with plugin minus without)',
    unit: 'MB',
    limit: 30,
    value: worst(500, 'memoryPerThreadMB'),
  },
].map((b) => ({ ...b, limit: b.limit * SCALE, pass: b.value <= b.limit * SCALE }));

const results = {
  date: new Date().toISOString(),
  machine: machine(),
  runs: RUNS,
  budgetScale: SCALE,
  budgets,
  measures,
  snapshotMB,
  perRun,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);

const fmt = (x) => (x === null || Number.isNaN(x) ? '-' : x.toFixed(2));
const lines = [
  `# Benchmark ${results.date}`,
  '',
  `Machine: ${Object.entries(results.machine)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')}. Runs: ${RUNS} (medians). Budget scale: ${SCALE}.`,
  '',
  '| Budget | Value | Limit | Result |',
  '|---|---|---|---|',
  ...budgets.map(
    (b) =>
      `| ${b.what} | ${fmt(b.value)} ${b.unit} | ${fmt(b.limit)} ${b.unit} | ${b.pass ? 'PASS' : 'FAIL'} |`,
  ),
  '',
  '| Migrations / concurrency | Threads | Cold max | Cold sum | Cold after change | Warm median | Warm p95 | Plugin ms | Base total ms | Share % | Share without cold % | Share of rules % | Wall full / base ms | Memory MB/thread |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...Object.entries(measures).map(
    ([k, v]) =>
      `| ${k} | ${v.threads} | ${fmt(v.coldMax)} | ${fmt(v.coldSum)} | ${fmt(v.changeCold)} | ${fmt(v.warmMedian)} | ${fmt(v.warmP95)} | ${fmt(v.pluginMs)} | ${fmt(v.baseTotalMs)} | ${fmt(v.sharePct)} | ${fmt(v.shareWarmPct)} | ${fmt(v.shareOfRulesPct)} | ${fmt(v.wallFullMs)} / ${fmt(v.wallBaseMs)} | ${fmt(v.memoryPerThreadMB)} |`,
  ),
  '',
  `Snapshot heap alone (engine replay, retained): ${MIGRATIONS.map((m) => `${m} migrations ${fmt(snapshotMB[m])} MB`).join(', ')}.`,
  '',
];
writeFileSync(path.join(OUT, 'results.md'), lines.join('\n'));
process.stdout.write(lines.join('\n'));

const failed = budgets.filter((b) => !b.pass);
if (failed.length > 0) {
  process.stdout.write(
    `bench: ${failed.length} budget(s) missed: ${failed.map((b) => b.id).join(', ')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write('bench: every budget met\n');
}
