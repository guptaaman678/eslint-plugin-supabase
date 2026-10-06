import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface PackageMeta {
  name: string;
  version: string;
}

const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageMeta;

const plugin = {
  meta: {
    name: pkg.name,
    version: pkg.version,
    namespace: 'supabase',
  },
  rules: {},
  configs: {},
};

plugin.configs = {
  recommended: {
    name: 'supabase/recommended',
    plugins: { supabase: plugin },
    rules: {},
  },
};

export default plugin;
