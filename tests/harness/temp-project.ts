import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A throwaway Supabase project on disk, for cache and hash tests. */
export class TempProject {
  readonly dir: string;

  constructor(migrations: Readonly<Record<string, string>> = { '0001_init.sql': INIT_SQL }) {
    this.dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'supabase-cache-')));
    mkdirSync(this.migrationsDir, { recursive: true });
    for (const [name, sql] of Object.entries(migrations)) this.migration(name, sql);
  }

  get migrationsDir(): string {
    return path.join(this.dir, 'supabase', 'migrations');
  }

  /** Writes a file under the project and returns its absolute path. */
  write(relative: string, content: string): string {
    const file = path.join(this.dir, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    return file;
  }

  migration(name: string, sql: string): string {
    return this.write(path.join('supabase', 'migrations', name), sql);
  }

  /** Moves a file's modification time by `seconds` without touching its content. */
  touch(relative: string, seconds = 10): void {
    const file = path.join(this.dir, relative);
    const { atime, mtime } = statSync(file);
    utimesSync(file, atime, new Date(mtime.getTime() + seconds * 1000));
  }

  /** Sets every listed file's modification time to one fixed instant. */
  pin(relatives: readonly string[], when = new Date('2026-01-01T00:00:00Z')): void {
    for (const relative of relatives) utimesSync(path.join(this.dir, relative), when, when);
  }

  remove(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

export const INIT_SQL = 'create table public.todos (id bigint primary key);\n';
