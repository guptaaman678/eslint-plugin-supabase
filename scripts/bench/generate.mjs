// Deterministic generator for the benchmark's synthetic projects (§6.8): migrations and a
// 200-file TypeScript app. No randomness: the same arguments always write the same bytes.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Source files per app, `src/lib/supabase.ts` included. */
export const SOURCE_FILES = 200;

/** Migrations `0, 1, 2` of every five create a table; `3` and `4` alter an earlier one. */
const isTable = (i) => i % 5 < 3;

/** The tables a project of `count` migrations creates. */
export function tablesOf(count) {
  const tables = [];
  for (let i = 0; i < count; i++) if (isTable(i)) tables.push(`t${i}`);
  return tables;
}

function migration(i) {
  if (isTable(i)) {
    const t = `t${i}`;
    const lines = [
      `create table public.${t} (`,
      '  id bigint generated always as identity primary key,',
      '  user_id uuid not null default auth.uid(),',
      '  title text not null,',
      '  body text,',
      '  created_at timestamptz not null default now()',
      ');',
      '',
      `alter table public.${t} enable row level security;`,
      '',
      `create policy "${t} owners read" on public.${t}`,
      '  for select to authenticated using (auth.uid() = user_id);',
      '',
      `create policy "${t} owners add" on public.${t}`,
      '  for insert to authenticated with check (auth.uid() = user_id);',
      '',
      `create index ${t}_user_idx on public.${t} (user_id);`,
    ];
    if (i % 4 === 0) lines.push('', `alter publication supabase_realtime add table public.${t};`);
    if (i % 3 === 0) lines.push('', `revoke all on table public.${t} from anon;`);
    return lines;
  }
  if (i % 5 === 3) {
    const t = `t${i - 3}`;
    return [
      `alter table public.${t} add column updated_at timestamptz;`,
      '',
      `create or replace function public.touch_${i}() returns trigger`,
      'language plpgsql as $$',
      'begin',
      '  new.updated_at = now();',
      '  return new;',
      'end;',
      '$$;',
      '',
      `create trigger ${t}_touch before update on public.${t}`,
      `  for each row execute function public.touch_${i}();`,
    ];
  }
  const t = `t${i - 4}`;
  return [
    `create policy "${t} owners change" on public.${t}`,
    '  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);',
    '',
    `grant select on table public.${t} to anon;`,
    '',
    `create policy "${t} public read" on public.${t}`,
    '  for select to anon using (true);',
  ];
}

/** Writes `count` migrations into `<projectDir>/supabase/migrations`. */
export function writeMigrations(projectDir, count) {
  const dir = path.join(projectDir, 'supabase', 'migrations');
  mkdirSync(dir, { recursive: true });
  const files = [];
  for (let i = 0; i < count; i++) {
    const file = path.join(dir, `${20260101000000 + i}_step_${i}.sql`);
    writeFileSync(file, `${migration(i).join('\n')}\n`);
    files.push(file);
  }
  return files;
}

function sourceFile(k, tables) {
  const a = tables[k % tables.length];
  const b = tables[(k * 7 + 3) % tables.length];
  const lines = [
    "import { supabase } from '../lib/supabase';",
    '',
    `export interface Row${k} {`,
    '  id: number;',
    '  title: string;',
    '}',
    '',
    `export async function list${k}() {`,
    `  const { data, error } = await supabase.from('${a}').select('id, title').limit(50);`,
    '  if (error) throw error;',
    '  return data;',
    '}',
    '',
    `export async function add${k}(title: string) {`,
    `  const { error } = await supabase.from('${b}').insert({ title });`,
    '  return error;',
    '}',
    '',
    `export async function remove${k}(id: number) {`,
    `  const { error } = await supabase.from('${a}').delete().eq('id', id);`,
    '  if (error) throw error;',
    '}',
    '',
    `export function titles${k}(rows: Row${k}[]): string[] {`,
    '  const out: string[] = [];',
    '  for (const row of rows) {',
    '    if (row.title.length > 0) out.push(row.title.trim());',
    '  }',
    '  return out.sort((x, y) => x.localeCompare(y));',
    '}',
  ];
  if (k % 10 === 0) {
    lines.push(
      '',
      `export function watch${k}(onChange: () => void) {`,
      '  return supabase',
      `    .channel('feed-${k}')`,
      `    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: '${a}' }, onChange)`,
      '    .subscribe((status) => {',
      "      if (status === 'CHANNEL_ERROR') console.error(status);",
      '    });',
      '}',
    );
  }
  return `${lines.join('\n')}\n`;
}

const CLIENT = [
  "import { createClient } from '@supabase/supabase-js';",
  '',
  'export const supabase = createClient(',
  '  process.env.SUPABASE_URL!,',
  '  process.env.SUPABASE_ANON_KEY!,',
  ');',
  '',
].join('\n');

/** The two ESLint configs: `base` is typescript-eslint alone, `full` adds the plugin. */
function config(withPlugin, probeFile) {
  return [
    "import tseslint from 'typescript-eslint';",
    ...(withPlugin ? ["import supabase from 'eslint-plugin-supabase';"] : []),
    `import probe from ${JSON.stringify(pathToFileURL(probeFile).href)};`,
    '',
    'export default [',
    "  { ignores: ['*.mjs', 'supabase/**'] },",
    '  ...tseslint.configs.recommendedTypeChecked,',
    '  {',
    '    languageOptions: {',
    '      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },',
    '    },',
    '  },',
    "  { files: ['**/*.ts'], plugins: { probe }, rules: { 'probe/order': 'error' } },",
    ...(withPlugin ? ['  supabase.configs.recommended,'] : []),
    '];',
    '',
  ].join('\n');
}

/**
 * Writes an app with `migrations` migrations and `SOURCE_FILES` source files. The app queries
 * tables of the first 100 migrations, so apps of 100 and 500 migrations share their sources.
 */
export function writeApp(appDir, migrations, probeFile) {
  mkdirSync(path.join(appDir, 'src', 'lib'), { recursive: true });
  mkdirSync(path.join(appDir, 'src', 'features'), { recursive: true });
  writeFileSync(
    path.join(appDir, 'package.json'),
    `${JSON.stringify({ name: `bench-app-${migrations}`, private: true, type: 'module' }, null, 2)}\n`,
  );
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022', 'DOM'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
    include: ['src/**/*.ts'],
  };
  writeFileSync(path.join(appDir, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`);
  writeFileSync(path.join(appDir, 'eslint.base.mjs'), config(false, probeFile));
  writeFileSync(path.join(appDir, 'eslint.full.mjs'), config(true, probeFile));
  writeFileSync(path.join(appDir, 'src', 'lib', 'supabase.ts'), CLIENT);
  const tables = tablesOf(Math.min(migrations, 100));
  for (let k = 0; k < SOURCE_FILES - 1; k++) {
    writeFileSync(path.join(appDir, 'src', 'features', `f${k}.ts`), sourceFile(k, tables));
  }
  return writeMigrations(appDir, migrations);
}
