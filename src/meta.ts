import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface PackageMeta {
  name: string;
  version: string;
  dependencies: { 'supabase-grants-lint': string };
}

// This module sits one level below the package root, as `dist/index.js` does after bundling,
// so the same relative URL finds package.json from source and from the build.
const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageMeta;

export const PACKAGE_NAME = pkg.name;
export const PACKAGE_VERSION = pkg.version;
/** The `supabase-grants-lint` versions this plugin works with. */
export const ENGINE_RANGE = pkg.dependencies['supabase-grants-lint'];
export const NAMESPACE = 'supabase';
export const REPO_URL = 'https://github.com/guptaaman678/eslint-plugin-supabase';
