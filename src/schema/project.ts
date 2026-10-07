import { statSync } from 'node:fs';
import path from 'node:path';

/** The folder whose presence marks a Supabase project directory. */
export const MIGRATIONS_DIR = path.join('supabase', 'migrations');

/** Why a file has no project; rules skip with this reason. */
export type ProjectSkipReason = 'no-project';

function hasMigrations(dir: string): boolean {
  return (
    statSync(path.join(dir, MIGRATIONS_DIR), { throwIfNoEntry: false })?.isDirectory() === true
  );
}

/** The nearest directory at or above `start` that contains `supabase/migrations`. */
export function findProjectDir(start: string): string | undefined {
  let dir = path.resolve(start);
  for (;;) {
    if (hasMigrations(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * The Supabase project a linted file belongs to (§6.4): `settings.supabase.projectDir` when set
 * (already absolute), else the nearest ancestor of the file that contains `supabase/migrations`,
 * so code in `apps/web` finds migrations at a monorepo's root. `undefined` means no project:
 * the schema rules skip the file (reason `no-project`).
 */
export function projectForFile(
  filename: string,
  projectDir: string | undefined,
): string | undefined {
  return projectDir ?? findProjectDir(path.dirname(filename));
}
