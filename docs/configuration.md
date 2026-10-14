# Configuration

## Requirements

- Node `^22.13.0 || >=24`.
- `eslint` `^9.15.0 || ^10.0.0`, `typescript` `>=5.8.0 <6.1.0` and `@typescript-eslint/parser`
  `^8.58.0`.
- Typed linting. Every rule reads TypeScript types, so the files the plugin checks need
  typescript-eslint's parser with type information (`parserOptions.projectService`). Without it,
  typescript-eslint stops with an error that explains how to turn it on.

## The `recommended` config

```js
// eslint.config.js (in a package with "type": "module")
import parser from '@typescript-eslint/parser';
import supabase from 'eslint-plugin-supabase';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  supabase.configs.recommended,
];
```

If you already use typescript-eslint's typed configs (`recommendedTypeChecked` with
`projectService`), add `supabase.configs.recommended` after them.

`recommended` turns on every rule (`subscribe-status-handler` as a warning, the others as errors)
for `**/*.ts`, `**/*.tsx`, `**/*.mts` and `**/*.cts`, and ignores `**/supabase/functions/**`
(Deno edge functions need a different TypeScript setup and are not supported). It also sets
`settings.supabase.migrationsHash` for the project found from ESLint's working directory, so
`eslint --cache` stays correct (see [Caching](#caching-and---cache)).

To change one rule, add a config object after it:

```js
export default [
  // ...typed linting as above
  supabase.configs.recommended,
  {
    rules: {
      'supabase/subscribe-status-handler': ['error', { allowWrappers: ['subscribeOrThrow'] }],
    },
  },
];
```

## ES modules only, and CommonJS configs

The plugin is an ES module. It loads its SQL parser once, with a top-level `await`, before ESLint
runs any rule, so the rules can read your migrations synchronously. A module with a top-level
`await` cannot be loaded with `require()`.

- `eslint.config.js` in a `"type": "module"` package, `eslint.config.mjs` and `eslint.config.ts`
  import the plugin as usual.
- A CommonJS `eslint.config.cjs` (or `eslint.config.js` without `"type": "module"`) exports a
  Promise instead. ESLint 9.15 and later wait for it:

```js
// eslint.config.cjs
module.exports = import('eslint-plugin-supabase').then(({ default: supabase }) => [
  supabase.configs.recommended,
]);
```

A plain `require('eslint-plugin-supabase')` fails with an error that shows this form.

## Settings

The plugin reads `settings.supabase`. Every key is optional. An unknown key is a config error that
names the key (with a "did you mean" hint), and so is a value of the wrong type.

| Key                | Type                           | Default                                                                 |
| ------------------ | ------------------------------ | ----------------------------------------------------------------------- |
| `projectDir`       | string                         | the nearest folder above the linted file that has `supabase/migrations` |
| `grantsLintConfig` | string (path)                  | grants-lint's own lookup                                                |
| `clients`          | `[{ module?, callee?, role }]` | `[]`                                                                    |
| `defaultRoles`     | role or role[]                 | `["anon", "authenticated"]`                                             |
| `unknownKey`       | `"default"` or `"skip"`        | `"default"`                                                             |
| `migrationsHash`   | string                         | set by `recommended` or `withProject`                                   |

Relative paths are resolved against ESLint's working directory. A role is one of `anon`,
`authenticated` and `service_role`.

### `projectDir`

The folder that holds `supabase/migrations`. Without it, the plugin looks for the nearest folder
above each linted file that has `supabase/migrations`, which covers a monorepo with code in
`apps/web` and migrations at the root. A file with no such folder above it is not checked by the
schema rules (`realtime-table-published`, `rls-readable`, `table-granted`).

### `grantsLintConfig`

A grants-lint config file to use instead of grants-lint's own lookup (`grants-lint.config.json`,
then `package.json#grantsLint`, in the project folder). The file must exist.

The settings that change how migrations are replayed (`migrations`, `schemas`, `since`,
`platformDefaults`, `platformRevokeAtSince`, `migrationRole`, `clientRoles`, `serviceRole`,
`autoRls` and `platformPublications`) belong to grants-lint and are read only from its config, so
the plugin and grants-lint always replay the same database. Putting one of them in
`settings.supabase` is a config error that says where it goes.

### `clients`

Which role a Supabase client runs as decides what the schema rules check: `rls-readable` skips
`service_role` clients (they bypass row level security), and `table-granted` checks the privileges
of whichever role the client can run as. The plugin follows each client back to the call that
created it (through imports, `const` aliases and `await`), then takes the first answer from this
list:

1. a `clients` entry that matches;
2. a key argument whose name says service role, service key or secret key (`/service[_-]?role/i`,
   `/service[_-]?key/i`, `/secret[_-]?key/i`), or a literal that starts with `sb_secret_`:
   `service_role`;
3. a key argument whose name says anon or publishable (`/anon[_-]?key|publishable/i`), or a
   literal that starts with `sb_publishable_`: `defaultRoles`;
4. any other key: `defaultRoles`, or skipped when `unknownKey` is `"skip"`;
5. a client the plugin cannot trace (a function parameter, a `let`, an object property, the result
   of calling one of these, such as `getClient()` where `getClient` is a parameter, or `new` of a
   class that is not supabase-js's, such as a `Proxy`): skipped.

A key's name is the variable or property it is read from (`process.env.SUPABASE_SERVICE_ROLE_KEY`,
`serviceKey`), or the string a helper is called with (`Deno.env.get('SUPABASE_ANON_KEY')`,
`getEnv('SUPABASE_SERVICE_ROLE_KEY')`).

When the client comes from your own factory function, such as `createAdminClient()`, steps 2 and 3
read the clients that function returns: every `return` (and an arrow's expression body), through
`const` aliases, `await` and up to three of your own factories deep. A module-level `let` that the
function returns (a lazily created client) counts every value assigned to it. Both branches of a
returned `cond ? client : null` count. `null` and `undefined` returns are ignored. If every returned client has a key that steps 2 and 3 classify the
same way, that answer is used. If any returned value cannot be traced (step 5), for example a
test seam such as a setter that stores a client it is given (`client = c`) or a branch that
returns `testMake()` when a test sets it, the call is skipped as in step 5, since the factory may return a
client with any role. Otherwise step 4 applies. A `clients` entry still wins, so map such a
factory to have its calls checked.

Only names and key prefixes in your source are read. The plugin never reads `.env` files and never
decodes, logs or prints a key.

An entry matches by `module`, `callee`, or both, and gives `role` (one role or a list):

- `module`: a glob, relative to the project folder, for the file that creates the client, or the
  file that declares your own factory function. `**` matches across folders, `*` and `?` stay
  within one folder, and `{a,b}` gives alternatives.
- `callee`: the name of the factory that creates the client, for example your own
  `createAdminClient`. An imported factory matches by its declared name too.

```js
{
  settings: {
    supabase: {
      clients: [
        // Your own factory that wraps createClient with the secret key.
        { callee: 'createAdminClient', role: 'service_role' },
        // Server components: always a signed-in user.
        { module: 'src/lib/supabase/server.ts', role: 'authenticated' },
        // A public widget that never signs in.
        { module: 'src/widgets/**/*.{ts,tsx}', role: 'anon' },
      ],
    },
  },
}
```

Entries are tried in order, and the first match wins.

### `defaultRoles`

The roles a client with a publishable (or anon) key can run as. A browser client may or may not be
signed in, so the default is both, and a call is reported only when **neither** role passes. Set it
to `"authenticated"` if your app always signs users in before it queries.

### `unknownKey`

What to do with a client whose key is neither visibly a publishable key nor visibly a service role
key, for example `createClient(url, config.key)`. `"default"` treats it as `defaultRoles`, since in
client code that is what such a key almost always is. `"skip"` skips its calls instead.

### `migrationsHash`

A hash of everything the replay reads: migration file names, sizes and modification times, the
grants-lint config, and the `supabase-grants-lint` version. `recommended` and `withProject` set it
for you. You only write it yourself if you build the settings by hand.

## Rule options

Each rule page lists its options. The schema rules share two:

- `ignoreTables`: `[{ table, reason }]`, tables not to check, each with a required reason.
- `reportUnresolved` (default `false`): also report the calls the rule skipped because it could not
  resolve them (a dynamic table name, a client it cannot trace, a file outside any Supabase
  project), for when you want full coverage.

## Monorepos and other project folders: `withProject`

With one Supabase project, `recommended` is enough, wherever the migrations are, as long as ESLint
runs from that project's folder or below it. For several Supabase projects in one repository, or a
project the working directory is not inside, use `supabase.withProject` once per project, in place
of `recommended`:

```js
export default [
  // ...typed linting as above
  supabase.withProject({ projectDir: 'apps/web', files: ['apps/web/**/*.{ts,tsx}'] }),
  supabase.withProject({
    projectDir: 'apps/admin',
    files: ['apps/admin/**/*.ts'],
    grantsLintConfig: 'apps/admin/grants-lint.config.json',
  }),
];
```

`withProject` takes `projectDir` (required, the folder that holds `supabase/migrations`, relative
to the working directory), `grantsLintConfig` (optional) and `files` (optional, default every
TypeScript file). It returns `recommended` with those settings and that project's
`migrationsHash`.

## Caching and `--cache`

The schema rules replay your migrations once per ESLint thread, keep the result in memory, and
replay again only when a migration or the grants-lint config changes. An editor therefore sees a
new migration within a fraction of a second.

`eslint --cache` is different: ESLint skips a file whose content and config did not change, and it
does not know that a TypeScript file's result depends on your migrations. `migrationsHash` is the
fix. It is part of the config, so when a migration changes, the config changes and ESLint lints
every file again. `recommended` computes it for the project found from the working directory;
`withProject` computes it for its own project. If you lint a project that neither covers (for
example, `recommended` run from a folder outside the project, with `projectDir` set by hand), do
not use `--cache`, or use `withProject`.

Under `--concurrency N`, each worker thread replays the migrations once and keeps its own copy, so
memory for the schema is N times one copy. [How it works](./how-it-works.md#performance) has the
measured times and memory.

## Skip statistics

Set `ESLINT_PLUGIN_SUPABASE_STATS` to a path, and every ESLint thread writes how many Supabase
calls it saw and how many it skipped, by reason, to `<path>.<threadId>.json` when it exits. This is
the only file the plugin ever writes.
