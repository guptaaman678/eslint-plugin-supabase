import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// Spec T6.2: 0.1.0 is published by hand, so merging its Version Packages PR runs no publish step;
// 0.1.1 and later are staged on npm and tagged. The test runs scripts/release-state.mjs the way
// the workflow does (writing $GITHUB_OUTPUT) and evaluates each release.yml step's `if:` against
// those outputs.

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'scripts', 'release-state.mjs');
const workflow = readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8');
/** The workflow without its comment lines, which name the things it must not use. */
const code = workflow
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

interface Step {
  name: string;
  id?: string;
  if?: string;
  text: string;
}

/** The steps of the release job, each with its raw text, name, id and condition. */
function releaseSteps(): Step[] {
  const body = code.slice(code.indexOf('\n    steps:\n'));
  return body
    .split(/\n {6}- /)
    .slice(1)
    .map((text) => ({
      name:
        /^name: (.+)$/m.exec(text)?.[1] ??
        /uses: (\S+)/.exec(text)?.[1] ??
        /run: (.+)$/m.exec(text)?.[1] ??
        '',
      id: /^ {8}id: (\S+)$/m.exec(text)?.[1],
      if: /^ {8}if: (.+)$/m.exec(text)?.[1],
      text,
    }));
}

type Outputs = Record<string, Record<string, string>>;

/** Evaluates `steps.<id>.outputs.<key> == '<value>'` terms joined by `&&`; no condition runs. */
function runs(step: Step, outputs: Outputs): boolean {
  if (step.if === undefined) return true;
  return step.if.split('&&').every((term) => {
    const match = /^\s*steps\.([\w-]+)\.outputs\.([\w-]+) == '([^']*)'\s*$/.exec(term);
    if (!match) throw new Error(`unsupported condition: ${term}`);
    const [, id, key, value] = match as unknown as [string, string, string, string];
    return (outputs[id]?.[key] ?? '') === value;
  });
}

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs the state script with explicit facts, as GitHub Actions would, and reads its outputs. */
function state(args: string[]): {
  status: number | null;
  outputs: Record<string, string>;
  stderr: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'release-state-'));
  temps.push(dir);
  const file = join(dir, 'output.txt');
  writeFileSync(file, '');
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: file },
  });
  const outputs = Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  return { status: result.status, outputs, stderr: result.stderr };
}

/** The names of the steps that run after a push to main with the given changesets and facts. */
function plan(hasChangesets: 'true' | 'false', facts: string[]): Step[] {
  const outputs: Outputs = { changesets: { 'has-changesets': hasChangesets } };
  const ran: Step[] = [];
  for (const step of releaseSteps()) {
    if (!runs(step, outputs)) continue;
    ran.push(step);
    if (step.id === 'state') {
      const result = state(facts);
      expect(result.status, result.stderr).toBe(0);
      outputs.state = result.outputs;
    }
  }
  return ran;
}

const publishes = (step: Step) => /\bnpm (stage )?publish\b/.test(step.text);
const tags = (step: Step) => /\bgit tag\b/.test(step.text);

describe('release state', () => {
  it('runs no publish or tag step when the 0.1.0 Version Packages PR is merged', () => {
    const ran = plan('false', ['--version', '0.1.0', '--live', 'false', '--tagged', 'false']);
    expect(ran.map((step) => step.name)).toContain('Work out the release state');
    expect(ran.filter(publishes)).toEqual([]);
    expect(ran.filter(tags)).toEqual([]);
  });

  it('records why 0.1.0 is skipped', () => {
    const { outputs } = state(['--version', '0.1.0', '--live', 'false', '--tagged', 'false']);
    expect(outputs).toEqual({
      version: '0.1.0',
      live: 'false',
      tagged: 'false',
      stage: 'false',
      reason: 'hand-published',
    });
  });

  it('stages 0.1.1 on npm with provenance and then tags it', () => {
    const ran = plan('false', ['--version', '0.1.1', '--live', 'false', '--tagged', 'false']);
    const stage = ran.findIndex(publishes);
    const tag = ran.findIndex(tags);
    expect(stage).toBeGreaterThan(-1);
    expect(tag).toBeGreaterThan(stage);
    expect(ran[stage]?.text).toContain('npm stage publish --provenance --access public');
    expect(ran[tag]?.text).toContain('git tag "v${{ steps.state.outputs.version }}"');
    expect(ran[tag]?.text).toContain('git push origin "v${{ steps.state.outputs.version }}"');
  });

  it.each([
    [
      '0.1.0 after the hand publish',
      ['--version', '0.1.0', '--live', 'true', '--tagged', 'true'],
      'hand-published',
    ],
    [
      '0.1.1 staged and awaiting approval',
      ['--version', '0.1.1', '--live', 'false', '--tagged', 'true'],
      'tagged',
    ],
    ['0.1.1 approved', ['--version', '0.1.1', '--live', 'true', '--tagged', 'true'], 'live'],
    [
      '0.1.1 live but untagged',
      ['--version', '0.1.1', '--live', 'true', '--tagged', 'false'],
      'live',
    ],
  ])('does not stage %s', (_, facts, reason) => {
    expect(state(facts).outputs).toMatchObject({ stage: 'false', reason });
    const ran = plan('false', facts);
    expect(ran.filter(publishes)).toEqual([]);
    expect(ran.filter(tags)).toEqual([]);
  });

  it('only versions while changesets are pending', () => {
    const ran = plan('true', ['--version', '0.1.1', '--live', 'false', '--tagged', 'false']);
    expect(ran.map((step) => step.name)).not.toContain('Work out the release state');
    expect(ran.filter(publishes)).toEqual([]);
    expect(ran.filter(tags)).toEqual([]);
  });

  it('rejects a fact that is not true or false', () => {
    const result = state(['--version', '0.1.1', '--live', 'yes', '--tagged', 'false']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--live must be true or false, got yes');
  });
});

describe('release.yml', () => {
  const steps = releaseSteps();
  const changesets = steps.find((step) => step.id === 'changesets');

  it('pins changesets/action v2 by commit SHA and pushes with the git CLI', () => {
    expect(changesets?.text).toMatch(/uses: changesets\/action@[0-9a-f]{40} # v2\.\d+\.\d+/);
    expect(changesets?.text).toContain('push-with-git-cli: true');
    expect(changesets?.text).not.toMatch(/publish(-script)?:/);
  });

  it('reads the v2 output name has-changesets, never hasChangesets', () => {
    expect(code).toContain("steps.changesets.outputs.has-changesets == 'false'");
    expect(code).not.toContain('hasChangesets');
  });

  it('pins every action by commit SHA', () => {
    const uses = [...workflow.matchAll(/uses: (\S+)/g)].map((match) => match[1] ?? '');
    const remote = uses.filter((use) => !use.startsWith('./'));
    expect(remote.length).toBeGreaterThan(0);
    for (const use of remote) expect(use).toMatch(/@[0-9a-f]{40}$/);
    expect(uses.filter((use) => use.startsWith('./'))).toEqual(['./.github/workflows/corpus.yml']);
  });

  it('runs the pinned corpus regression before the release job', () => {
    expect(workflow).toMatch(
      /\n {2}corpus:\n {4}uses: \.\/\.github\/workflows\/corpus\.yml\n {4}permissions:\n {6}contents: read\n/,
    );
    expect(workflow).toMatch(/\n {2}release:\n {4}needs: corpus\n/);
  });

  it('publishes only through npm stage on Node 24, with OIDC and no token', () => {
    expect(code).toContain("node-version: '24'");
    expect(code).not.toMatch(/registry-url|NODE_AUTH_TOKEN|NPM_TOKEN/);
    const publishLines = code.split('\n').filter((line) => /\bnpm (stage )?publish\b/.test(line));
    expect(publishLines.map((line) => line.trim())).toEqual([
      'npm stage publish --provenance --access public',
    ]);
  });

  it('grants write permissions on the release job only', () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n\njobs:/m);
    expect(workflow).toMatch(
      /\n {2}release:\n {4}needs: corpus\n {4}runs-on: ubuntu-latest\n {4}permissions:\n {6}id-token: write\n {6}contents: write\n {6}pull-requests: write\n/,
    );
    expect(workflow.match(/: write/g)).toHaveLength(3);
  });
});
