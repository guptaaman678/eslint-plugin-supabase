#!/usr/bin/env node
// Works out what release.yml does once the Version Packages PR is merged (no changesets left):
// stage the version on npm and tag it, or nothing. 0.1.0 is published by hand (CONTRIBUTING.md),
// so the workflow never stages it. A staged version is not visible to `npm view` until a
// maintainer approves it, so the tag `v<version>` is what stops a second stage on later pushes.
//
// Usage: node scripts/release-state.mjs [--version <v>] [--live true|false] [--tagged true|false]
// Without flags it reads package.json, asks the registry whether <name>@<version> is live and
// looks for the tag in the local clone. It prints the state as JSON and, under GitHub Actions,
// appends `version`, `live`, `tagged`, `stage` and `reason` to $GITHUB_OUTPUT.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Versions the maintainer publishes by hand; the workflow never stages them. */
export const HAND_PUBLISHED = new Set(['0.1.0']);

/**
 * @param {{ version: string, live: boolean, tagged: boolean }} facts
 * @returns {{ version: string, live: boolean, tagged: boolean, stage: boolean, reason: string }}
 */
export function releaseState({ version, live, tagged }) {
  let reason = 'stage';
  if (HAND_PUBLISHED.has(version)) reason = 'hand-published';
  else if (live) reason = 'live';
  else if (tagged) reason = 'tagged';
  return { version, live, tagged, stage: reason === 'stage', reason };
}

function run(command, args) {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function flag(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function bool(value, name) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false, got ${String(value)}`);
}

function main(args) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const version = flag(args, '--version') ?? pkg.version;
  const live =
    flag(args, '--live') === undefined
      ? run('npm', ['view', `${pkg.name}@${version}`, 'version'])
      : bool(flag(args, '--live'), '--live');
  const tagged =
    flag(args, '--tagged') === undefined
      ? run('git', [
          '-C',
          root,
          'rev-parse',
          '--verify',
          '--quiet',
          `refs/tags/v${version}^{commit}`,
        ])
      : bool(flag(args, '--tagged'), '--tagged');
  const state = releaseState({ version, live, tagged });
  console.log(JSON.stringify(state));
  if (process.env.GITHUB_OUTPUT) {
    const lines = Object.entries(state).map(([key, value]) => `${key}=${String(value)}`);
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
