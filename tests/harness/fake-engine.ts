import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Engine, ReplayInputs, ReplayProjectOptions } from '../../src/schema/engine-api.js';
import type { SchemaSnapshot } from '../../src/schema/snapshot.js';
import { fakeMembership, fakeSnapshot } from './fake-snapshot.js';

export interface FakeEngine extends Engine {
  /** `replayProjectSync` calls so far. */
  replays: number;
}

/**
 * A stand-in for `supabase-grants-lint/engine` with grants-lint's default lookup: migrations are
 * `supabase/migrations/*.sql` in name order, the config is `configFile` or
 * `grants-lint.config.json`. A config that is not JSON throws, as a bad config does.
 */
export function fakeEngine(version = '0.0.0-fake'): FakeEngine {
  const configOf = (options: ReplayProjectOptions): string | null => {
    if (options.configFile !== undefined)
      return path.resolve(options.projectDir, options.configFile);
    const file = path.join(options.projectDir, 'grants-lint.config.json');
    return existsSync(file) ? file : null;
  };

  const engine: FakeEngine = {
    version,
    replays: 0,
    listReplayInputs(options): ReplayInputs {
      const dir = path.join(options.projectDir, 'supabase', 'migrations');
      if (statSync(dir, { throwIfNoEntry: false })?.isDirectory() !== true) {
        throw new Error(`Migrations directory not found: ${dir}`);
      }
      const configFile = configOf(options);
      if (configFile !== null) JSON.parse(readFileSync(configFile, 'utf8'));
      const migrations = readdirSync(dir)
        .filter((name) => name.endsWith('.sql'))
        .sort()
        .map((name) => path.join(dir, name));
      return { projectDir: options.projectDir, configFile, migrations };
    },
    replayProjectSync(options): SchemaSnapshot {
      const inputs = engine.listReplayInputs(options);
      engine.replays++;
      return fakeSnapshot({ meta: { engineVersion: version, files: inputs.migrations.length } });
    },
    publicationMembership: fakeMembership,
  };
  return engine;
}
