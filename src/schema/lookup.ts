import type { SupabaseSettings } from '../settings.js';
import type { SnapshotCache } from './cache.js';
import { projectForFile, type ProjectSkipReason } from './project.js';
import type { SchemaView } from './view.js';

/** Why a file has no schema: no project, or the engine threw on the project's replay. */
export type SchemaSkipReason = ProjectSkipReason | 'engine-error';

export type SchemaLookup =
  | { readonly view: SchemaView; readonly skip?: undefined }
  | { readonly view?: undefined; readonly skip: SchemaSkipReason };

/**
 * The schema of the project a linted file belongs to (§6.4). An engine exception is caught by the
 * cache once per project and kept until the project's inputs change, so every file of that project
 * is skipped with reason `engine-error` without another replay.
 */
export function schemaForFile(
  cache: SnapshotCache,
  filename: string,
  settings: Pick<SupabaseSettings, 'projectDir' | 'grantsLintConfig'>,
): SchemaLookup {
  const projectDir = projectForFile(filename, settings.projectDir);
  if (projectDir === undefined) return { skip: 'no-project' };
  const configFile = settings.grantsLintConfig;
  const result = cache.get({ projectDir, ...(configFile === undefined ? {} : { configFile }) });
  return result.view === undefined ? { skip: 'engine-error' } : { view: result.view };
}
