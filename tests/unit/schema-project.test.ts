import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findProjectDir, projectForFile } from '../../src/schema/project.js';

const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'supabase-project-')));

function dir(...parts: string[]): string {
  const full = path.join(root, ...parts);
  mkdirSync(full, { recursive: true });
  return full;
}

// A monorepo with migrations at its root, code in apps/, and a nested second project.
dir('mono', 'supabase', 'migrations');
dir('mono', 'apps', 'web', 'src', 'components', 'deep');
dir('mono', 'apps', 'api', 'supabase', 'migrations');
dir('mono', 'apps', 'api', 'src');
// `supabase/migrations` as a file is not a project; `supabase` alone is not either.
dir('fake', 'supabase');
writeFileSync(path.join(root, 'fake', 'supabase', 'migrations'), '');
dir('half', 'supabase', 'functions');
dir('none', 'src');

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('project discovery (§6.4)', () => {
  it('finds migrations at a monorepo root from code in apps/', () => {
    const file = path.join(root, 'mono', 'apps', 'web', 'src', 'app.ts');
    expect(projectForFile(file, undefined)).toBe(path.join(root, 'mono'));
  });

  it('finds the project from a deeply nested file', () => {
    const file = path.join(root, 'mono', 'apps', 'web', 'src', 'components', 'deep', 'x.tsx');
    expect(projectForFile(file, undefined)).toBe(path.join(root, 'mono'));
  });

  it('finds the project from a file at the project root', () => {
    expect(projectForFile(path.join(root, 'mono', 'index.ts'), undefined)).toBe(
      path.join(root, 'mono'),
    );
  });

  it('takes the nearest project when projects nest', () => {
    const file = path.join(root, 'mono', 'apps', 'api', 'src', 'db.ts');
    expect(projectForFile(file, undefined)).toBe(path.join(root, 'mono', 'apps', 'api'));
  });

  it('prefers settings.supabase.projectDir over discovery', () => {
    const file = path.join(root, 'mono', 'apps', 'api', 'src', 'db.ts');
    expect(projectForFile(file, path.join(root, 'mono'))).toBe(path.join(root, 'mono'));
    expect(projectForFile(file, path.join(root, 'none'))).toBe(path.join(root, 'none'));
  });

  it('finds no project without a supabase/migrations directory', () => {
    expect(projectForFile(path.join(root, 'none', 'src', 'a.ts'), undefined)).toBeUndefined();
    expect(projectForFile(path.join(root, 'fake', 'a.ts'), undefined)).toBeUndefined();
    expect(projectForFile(path.join(root, 'half', 'a.ts'), undefined)).toBeUndefined();
  });

  it('stops at the filesystem root', () => {
    expect(findProjectDir(path.parse(root).root)).toBeUndefined();
  });

  it('resolves a relative start directory', () => {
    const relative = path.relative(process.cwd(), path.join(root, 'mono', 'apps'));
    expect(findProjectDir(relative)).toBe(path.join(root, 'mono'));
  });
});
