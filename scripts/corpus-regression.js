// Pinned corpus regression. For every pin in tests/corpus/pins.json: sparse-clone the public
// repository at its SHA into a temporary folder, check its license, install only
// @supabase/supabase-js at the pinned version (scripts disabled), lint it with the built plugin and
// compare the finding count per rule and the skip count per reason with the pin's `expected`.
// Nothing from the cloned source is printed or kept: only counts. Clones are deleted afterwards.
//
// Usage: node scripts/corpus-regression.js [--pins <file>] [--only owner/repo,...] [--jobs 2]
//          [--update]
//   --update  write the measured counts into the pins file instead of comparing (review the diff).
// Run `npm run build` first. Exit 0 when every pin matches, 1 otherwise.
import { execFile, spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const env = { ...process.env, NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0' };
const MINUTE = 60_000;

const { values } = parseArgs({
  options: {
    pins: { type: 'string', default: path.join(ROOT, 'tests', 'corpus', 'pins.json') },
    only: { type: 'string' },
    jobs: { type: 'string', default: '2' },
    update: { type: 'boolean' },
    // Internal: lint one clone (the parent spawns this so each repo gets its own process).
    child: { type: 'string' },
    'project-dir': { type: 'string' },
    out: { type: 'string' },
  },
});

// Only what linting needs: TypeScript sources, package and tsconfig files, the Supabase project,
// and the license files at the root.
const SPARSE = [
  '*.ts',
  '*.tsx',
  '*.mts',
  '*.cts',
  'package.json',
  'tsconfig*.json',
  'grants-lint.config.json',
  '**/supabase/migrations/**',
  '**/supabase/**/*.sql',
  '**/supabase/config.toml',
  '/LICENSE*',
  '/LICENCE*',
  '!**/node_modules/**',
  '!**/supabase/functions/**',
];
const LICENSES = {
  MIT: /Permission is hereby granted, free of charge/,
  'Apache-2.0': /Apache License[\s\S]{0,200}Version 2\.0/,
};
const FILES = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];
const IGNORES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.output/**',
  '**/coverage/**',
  '**/vendor/**',
  '**/*.d.ts',
  '**/supabase/functions/**',
];
const GENERATED = '.corpus-tsconfig.json';
// Parser messages that mean "no usable type information for this file", not a syntax error.
const TYPE_SETUP =
  /project service|allowDefaultProject|parserOptions\.project|tsconfig|Cannot read file/i;

const firstLine = (s) => String(s).trim().split('\n')[0].slice(0, 300);
const headLines = (s, n) =>
  String(s)
    .trim()
    .split('\n')
    .slice(0, n)
    .map((line) => line.slice(0, 300));
// A crash's message, ESLint's "Occurred while linting" line and the top stack frames.
const CRASH_LINES = 12;
// A crash deep inside TypeScript has no plugin frame in its top frames: also print the first
// frames from the built plugin, which name the call that reached TypeScript.
const PLUGIN_FRAMES = 6;
const crashReport = (err) => {
  const lines = String(err?.stack ?? err)
    .trim()
    .split('\n');
  const head = lines.slice(0, CRASH_LINES);
  const dist = path.join(ROOT, 'dist');
  const plugin = lines
    .slice(CRASH_LINES)
    .filter((line) => line.includes(dist))
    .slice(0, PLUGIN_FRAMES);
  const omitted = plugin.length ? ['    ... (frames outside the plugin omitted)'] : [];
  return [...head, ...omitted, ...plugin].map((line) => line.slice(0, 300));
};
const sorted = (obj) =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

// ---------------------------------------------------------------------------------------------
// Child: lint one clone. Pass 1 uses the repository's own tsconfigs (projectService). Files it
// cannot type are linted again in pass 2 against a generated permissive tsconfig that keeps the
// root tsconfig's path aliases.

function readJsonc(file) {
  try {
    const text = readFileSync(file, 'utf8')
      .replace(/("(?:\\.|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m, str) => str ?? '')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function aliasPaths(clone, projectDir) {
  const rel = (f) => path.relative(clone, f).split(path.sep).join('/');
  for (const dir of [projectDir, '.']) {
    const file = path.join(clone, dir, 'tsconfig.json');
    const opts = existsSync(file) ? readJsonc(file)?.compilerOptions : undefined;
    if (!opts?.paths || typeof opts.paths !== 'object') continue;
    const base = path.resolve(path.dirname(file), opts.baseUrl ?? '.');
    const paths = {};
    for (const [key, targets] of Object.entries(opts.paths)) {
      if (!Array.isArray(targets)) continue;
      paths[key] = targets
        .filter((t) => typeof t === 'string')
        .map((t) => `./${rel(path.resolve(base, t))}`);
    }
    return paths;
  }
  return undefined;
}

async function lintChild(clone, projectDir, out) {
  const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
  const { ESLint } = await import('eslint');
  const parser = (await import('@typescript-eslint/parser')).default;
  const supabase = (await load('dist/index.js')).default;
  const makeEslint = (parserOptions) =>
    new ESLint({
      cwd: clone,
      overrideConfigFile: true,
      errorOnUnmatchedPattern: false,
      overrideConfig: [
        { ignores: IGNORES },
        {
          files: FILES,
          // The repository's own disable comments name rules this config does not load.
          linterOptions: { reportUnusedDisableDirectives: 'off' },
          languageOptions: { parser, parserOptions: { ...parserOptions, tsconfigRootDir: clone } },
        },
        supabase.withProject({ projectDir, files: FILES }),
      ],
    });

  const record = { files: 0, typeSetupRetries: 0, parseErrors: 0, rules: {} };
  const collect = (results, pass) => {
    const retry = [];
    for (const result of results) {
      const fatal = result.messages.filter((m) => m.fatal || !m.ruleId);
      if (pass === 1 && fatal.some((m) => TYPE_SETUP.test(m.message))) {
        retry.push(result.filePath);
        continue;
      }
      record.files++;
      if (fatal.length) record.parseErrors++;
      for (const m of result.messages) {
        if (m.ruleId?.startsWith('supabase/'))
          record.rules[m.ruleId] = (record.rules[m.ruleId] ?? 0) + 1;
      }
    }
    return retry;
  };
  try {
    const retry = collect(await makeEslint({ projectService: true }).lintFiles(FILES), 1);
    record.typeSetupRetries = retry.length;
    if (retry.length) {
      const paths = aliasPaths(clone, projectDir);
      const compilerOptions = {
        target: 'es2022',
        module: 'esnext',
        moduleResolution: 'bundler',
        lib: ['es2023', 'dom', 'dom.iterable'],
        jsx: 'preserve',
        strict: false,
        skipLibCheck: true,
        noEmit: true,
        resolveJsonModule: true,
        allowArbitraryExtensions: true,
        types: [],
        ...(paths ? { paths } : {}),
      };
      writeFileSync(
        path.join(clone, GENERATED),
        JSON.stringify({ compilerOptions, include: FILES, exclude: ['**/node_modules/**'] }),
      );
      collect(await makeEslint({ project: [`./${GENERATED}`] }).lintFiles(retry), 2);
    }
  } finally {
    rmSync(path.join(clone, GENERATED), { force: true });
  }
  record.rules = sorted(record.rules);
  writeFileSync(out, `${JSON.stringify(record)}\n`);
}

// ---------------------------------------------------------------------------------------------
// Parent.

async function clone(pin, dir) {
  mkdirSync(dir, { recursive: true });
  const git = (...args) =>
    run('git', ['-C', dir, ...args], { env, timeout: 10 * MINUTE, maxBuffer: 64 << 20 });
  await git('init', '-q');
  await git('remote', 'add', 'origin', `${pin.url}.git`);
  await git('config', 'core.sparseCheckout', 'true');
  writeFileSync(path.join(dir, '.git', 'info', 'sparse-checkout'), `${SPARSE.join('\n')}\n`);
  await git('fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', pin.sha);
  await git('checkout', '-q', 'FETCH_HEAD');
  const { stdout } = await git('rev-parse', 'HEAD');
  if (stdout.trim() !== pin.sha)
    throw new Error(`checked out ${stdout.trim()}, expected ${pin.sha}`);
}

function checkLicense(pin, dir) {
  const pattern = LICENSES[pin.license];
  if (!pattern) throw new Error(`license ${pin.license} is not MIT or Apache-2.0`);
  const files = readdirSync(dir).filter((f) => /^licen[cs]e/i.test(f));
  if (!files.some((f) => pattern.test(readFileSync(path.join(dir, f), 'utf8')))) {
    throw new Error(
      `no ${pin.license} license text in ${files.join(', ') || 'the root (no LICENSE file)'}`,
    );
  }
}

// One install per supabase-js version, shared by the pins that use it.
const installs = new Map();
function install(version, work) {
  if (!installs.has(version)) {
    const dir = path.join(work, `supabase-js-${version}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), '{ "private": true }\n');
    const args = ['install', `@supabase/supabase-js@${version}`, '--ignore-scripts', '--no-save'];
    args.push('--no-package-lock', '--no-audit', '--no-fund', '--prefix', dir);
    installs.set(
      version,
      run('npm', args, { env, timeout: 10 * MINUTE, maxBuffer: 64 << 20 }).then(() =>
        path.join(dir, 'node_modules'),
      ),
    );
  }
  return installs.get(version);
}

function lintInChild(dir, pin, out, statsBase) {
  return new Promise((resolve) => {
    const args = [
      '--max-old-space-size=8192',
      SELF,
      '--child',
      dir,
      '--project-dir',
      pin.projectDir,
      '--out',
      out,
    ];
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...env, ESLINT_PLUGIN_SUPABASE_STATS: statsBase },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    // The child writes its crash report first, so keep the head of stderr.
    let stderr = '';
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(0, 8000)));
    const timer = setTimeout(() => child.kill('SIGKILL'), 15 * MINUTE);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stderr: stderr.split(dir).join('<clone>') });
    });
  });
}

const repoName = (pin) => new URL(pin.url).pathname.slice(1);

async function measure(pin, work) {
  const name = repoName(pin).replace('/', '__');
  const dir = path.join(work, 'clones', name);
  const statsDir = path.join(work, 'stats', name);
  try {
    await clone(pin, dir);
    checkLicense(pin, dir);
    const modules = await install(pin.supabaseJs, work);
    cpSync(modules, path.join(dir, 'node_modules'), { recursive: true });
    mkdirSync(statsDir, { recursive: true });
    const out = path.join(statsDir, 'lint.json');
    const child = await lintInChild(dir, pin, out, path.join(statsDir, 'stats'));
    if (child.code !== 0 || !existsSync(out)) {
      const report = headLines(child.stderr, CRASH_LINES + 1 + PLUGIN_FRAMES).join('\n    ');
      throw new Error(`lint failed (exit ${child.code ?? child.signal}):\n    ${report}`);
    }
    const record = JSON.parse(readFileSync(out, 'utf8'));
    const skips = {};
    for (const f of readdirSync(statsDir).filter((f) => /^stats\.\d+\.json$/.test(f))) {
      for (const [k, v] of Object.entries(
        JSON.parse(readFileSync(path.join(statsDir, f), 'utf8')).skips,
      )) {
        if (v) skips[k] = (skips[k] ?? 0) + v;
      }
    }
    return { ...record, skips: sorted(skips) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(statsDir, { recursive: true, force: true });
  }
}

function compare(expected, actual) {
  const diffs = [];
  for (const kind of ['rules', 'skips']) {
    const keys = new Set([...Object.keys(expected[kind] ?? {}), ...Object.keys(actual[kind])]);
    for (const key of [...keys].sort()) {
      const want = expected[kind]?.[key] ?? 0;
      const got = actual[kind][key] ?? 0;
      if (want !== got) diffs.push(`${kind} ${key}: expected ${want}, got ${got}`);
    }
  }
  return diffs;
}

async function main() {
  const file = path.resolve(values.pins);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const only = values.only ? new Set(values.only.split(',')) : null;
  const pins = data.pins.filter((p) => !only || only.has(repoName(p)));
  if (only && pins.length !== only.size)
    throw new Error('--only names a repository that has no pin');
  if (!existsSync(path.join(ROOT, 'dist', 'index.js')))
    throw new Error('run `npm run build` first');

  const work = mkdtempSync(path.join(tmpdir(), 'supabase-corpus-'));
  let failed = 0;
  try {
    const queue = [...pins];
    const worker = async () => {
      for (let pin = queue.shift(); pin; pin = queue.shift()) {
        const started = Date.now();
        const secs = () => `${Math.round((Date.now() - started) / 1000)}s`;
        try {
          const actual = await measure(pin, work);
          if (values.update) {
            pin.expected = { rules: actual.rules, skips: actual.skips };
            console.log(`UPDATED ${repoName(pin)} files ${actual.files} ${secs()}`);
            continue;
          }
          const diffs = compare(pin.expected, actual);
          if (diffs.length) failed++;
          console.log(
            `${diffs.length ? 'FAIL' : 'PASS'} ${repoName(pin)} files ${actual.files} ${secs()}`,
          );
          for (const d of diffs) console.log(`  ${d}`);
        } catch (err) {
          failed++;
          const reason = err.stderr ? firstLine(err.stderr) : err.message;
          console.log(`FAIL ${repoName(pin)} ${secs()}\n  ${reason}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Number(values.jobs)) }, worker));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  if (values.update && !failed) writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  console.log(
    `corpus: ${pins.length - failed} of ${pins.length} pins ${values.update ? 'updated' : 'match'}`,
  );
  process.exitCode = failed ? 1 : 0;
}

if (values.child) {
  // Deep enough to reach the plugin's frames below a crash inside TypeScript.
  Error.stackTraceLimit = 100;
  try {
    await lintChild(
      path.resolve(values.child),
      values['project-dir'] ?? '.',
      path.resolve(values.out),
    );
  } catch (err) {
    // Node's own report of an uncaught error ends in the error's properties (AST nodes for a
    // rule crash), which hide the cause. Write the stack, which starts with the message.
    process.stderr.write(`${crashReport(err).join('\n')}\n`);
    process.exit(1);
  }
} else {
  await main();
}
