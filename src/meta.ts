import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface PackageMeta {
  name: string;
  version: string;
}

// This module sits one level below the package root, as `dist/index.js` does after bundling,
// so the same relative URL finds package.json from source and from the build.
const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageMeta;

export const PACKAGE_NAME = pkg.name;
export const PACKAGE_VERSION = pkg.version;
export const NAMESPACE = 'supabase';
export const REPO_URL = 'https://github.com/guptaaman678/eslint-plugin-supabase';
