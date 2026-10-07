import path from 'node:path';
import type { ESLint, Linter } from 'eslint';
import type { Engine } from '../schema/engine-api.js';
import { migrationsHash } from '../schema/inputs.js';
import { findProjectDir } from '../schema/project.js';
import { NAMESPACE } from '../meta.js';
import { createRecommended } from './recommended.js';

/** Options of `withProject`. */
export interface ProjectOptions {
  /** The directory holding `supabase/migrations`, relative to the working directory. */
  readonly projectDir: string;
  /** A grants-lint config file to use instead of grants-lint's own lookup. */
  readonly grantsLintConfig?: string;
  /** The files this project's code lives in; default every TypeScript file. */
  readonly files?: Linter.Config['files'];
}

/**
 * `settings.supabase.migrationsHash` for the project discovered from `cwd`, the one project
 * `recommended` covers (ADR-012 item 2). `undefined` when `cwd` is in no Supabase project.
 */
export function discoveredHash(engine: Engine, cwd: string): string | undefined {
  const projectDir = findProjectDir(cwd);
  return projectDir === undefined ? undefined : migrationsHash(engine, { projectDir });
}

/**
 * The `withProject({ projectDir })` helper: `recommended` for one Supabase project, with its
 * `projectDir` and a `migrationsHash` so that `eslint --cache` forgets results when the project's
 * migrations, grants-lint config or engine version change (ADR-012). Call it once per project in
 * a monorepo, with `files` limited to that project's code.
 */
export function createWithProject(
  plugin: ESLint.Plugin,
  engine: Engine,
  cwd: () => string = () => process.cwd(),
): (options: ProjectOptions) => Linter.Config {
  return (options) => {
    const base = cwd();
    const configFile =
      options.grantsLintConfig === undefined
        ? undefined
        : path.resolve(base, options.grantsLintConfig);
    const hash = migrationsHash(engine, {
      projectDir: path.resolve(base, options.projectDir),
      ...(configFile === undefined ? {} : { configFile }),
    });
    const recommended = createRecommended(plugin);
    return {
      ...recommended,
      name: `${NAMESPACE}/project:${options.projectDir}`,
      files: options.files ?? recommended.files,
      settings: {
        [NAMESPACE]: {
          projectDir: options.projectDir,
          ...(options.grantsLintConfig === undefined
            ? {}
            : { grantsLintConfig: options.grantsLintConfig }),
          migrationsHash: hash,
        },
      },
    };
  };
}
