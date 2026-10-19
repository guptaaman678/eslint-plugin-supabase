# eslint-plugin-supabase

ESLint rules for the Supabase calls that fail without an error: queries that are never sent,
subscriptions that never fire, and reads that return nothing, flagged in your editor as you type.

[![npm](https://img.shields.io/npm/v/eslint-plugin-supabase)](https://www.npmjs.com/package/eslint-plugin-supabase)
[![npm provenance](https://img.shields.io/badge/npm-provenance-blue)](https://www.npmjs.com/package/eslint-plugin-supabase#provenance)
[![ci](https://github.com/guptaaman678/eslint-plugin-supabase/actions/workflows/ci.yml/badge.svg)](https://github.com/guptaaman678/eslint-plugin-supabase/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/guptaaman678/eslint-plugin-supabase/badge)](https://scorecard.dev/viewer/?uri=github.com/guptaaman678/eslint-plugin-supabase)
[![mutation testing](https://github.com/guptaaman678/eslint-plugin-supabase/actions/workflows/mutation.yml/badge.svg)](https://github.com/guptaaman678/eslint-plugin-supabase/actions/workflows/mutation.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

![ESLint reporting a voided insert that is never sent, and a realtime subscription to a table that is not in the supabase_realtime publication](./media/demo.gif)

Some rules read your code alone. The schema rules also replay your `supabase/migrations` and flag
the calls the resulting database can never serve. The plugin reads files only: no database
connection, no telemetry.

## Quick start

In a TypeScript project (a `tsconfig.json` that includes your source files) that uses
`@supabase/supabase-js`, on Node 22.13 or later:

```sh
npm install --save-dev eslint-plugin-supabase eslint @typescript-eslint/parser "typescript@>=5.8 <6.1"
```

Every rule reads TypeScript types, so the plugin needs typed linting (typescript-eslint's parser
with `projectService`). TypeScript 7 is not supported by typescript-eslint yet, hence the range.

```js
// eslint.config.mjs
import parser from '@typescript-eslint/parser';
import supabase from 'eslint-plugin-supabase';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['**/supabase/functions/**'],
    languageOptions: {
      parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  supabase.configs.recommended,
];
```

The `ignores` line keeps Deno edge functions, which your `tsconfig.json` does not include, out of
typed linting. If you already use typescript-eslint's typed configs (`recommendedTypeChecked`), add
`supabase.configs.recommended` after them. Then lint:

```sh
npx eslint .
```

A file like this one:

```ts
// src/todos.ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://example.supabase.co', 'sb_publishable_example');

export function addTodo(title: string) {
  void supabase.from('todos').insert({ title });
}
```

reports:

```text
  7:3  error  This Supabase query is lazy, so `void` discards it before it is sent and the request never happens. Use `await`, or call `.then()` to send it without waiting  supabase/no-unsent-query
```

## What it catches

- A query builder (or storage download) that is voided or left as a bare statement never sends the
  request: [`no-unsent-query`](docs/rules/no-unsent-query.md).
- `.subscribe()` without a status callback hides `CHANNEL_ERROR` and `TIMED_OUT`:
  [`subscribe-status-handler`](docs/rules/subscribe-status-handler.md).
- A `postgres_changes` subscription to a table outside the `supabase_realtime` publication reaches
  `SUBSCRIBED` and never fires: [`realtime-table-published`](docs/rules/realtime-table-published.md).
- A client read, filtered update or delete, or subscription on a table with row level security and
  no policy for the role returns or changes nothing, with no error:
  [`rls-readable`](docs/rules/rls-readable.md).
- A client call on a table the role holds no privilege for fails with `42501` (on new tables after
  the 2026-10-30 change, once the project records it with an opt-in migration or grants-lint's
  `since` setting), and a subscription to it receives nothing:
  [`table-granted`](docs/rules/table-granted.md).

## How the schema rules find your migrations

`realtime-table-published`, `rls-readable` and `table-granted` look for the nearest folder above
each linted file that has `supabase/migrations` (or the `projectDir` setting), and replay those
migrations with the [supabase-grants-lint](https://github.com/guptaaman678/supabase-grants-lint)
engine. They read grants-lint's own config (`grants-lint.config.json` or `package.json#grantsLint`),
so both tools replay the same database. The role of each call comes from the key the client was
created with: a publishable or anon key means `anon` or `authenticated`, a service role or secret
key means `service_role`, and any other key (such as `config.key`) is treated like a publishable
key unless the `unknownKey` setting is `"skip"`. A file with no migrations above it, a table name
that is not a literal or a client the plugin cannot trace is skipped, never guessed. Details:
[docs/how-it-works.md](docs/how-it-works.md).

If your migrations do not create your tables (they were made in the dashboard), the schema rules
have nothing to check and skip every call on them. Run `supabase db pull` once for a baseline
migration.

## Rules

<!-- begin auto-generated rules list -->

💼 Configurations enabled in.\
⚠️ Configurations set to warn in.\
✅ Set in the `recommended` configuration.\
💡 Manually fixable by [editor suggestions](https://eslint.org/docs/latest/use/core-concepts#rule-suggestions).\
💭 Requires [type information](https://typescript-eslint.io/linting/typed-linting).\
⚙️ Has configuration options.

| Name                                                               | Description                                                                             | 💼  | ⚠️  | 💡  | 💭  | ⚙️  |
| :----------------------------------------------------------------- | :-------------------------------------------------------------------------------------- | :-- | :-- | :-- | :-- | :-- |
| [no-unsent-query](docs/rules/no-unsent-query.md)                   | Disallow `void` and unsent Supabase query builders                                      | ✅  |     | 💡  | 💭  |     |
| [realtime-table-published](docs/rules/realtime-table-published.md) | Require Realtime `postgres_changes` tables to be in the publication                     | ✅  |     |     | 💭  | ⚙️  |
| [rls-readable](docs/rules/rls-readable.md)                         | Require a row level security policy for client reads, filtered writes and subscriptions | ✅  |     |     | 💭  | ⚙️  |
| [subscribe-status-handler](docs/rules/subscribe-status-handler.md) | Require a status callback on Supabase Realtime `subscribe()` calls                      |     | ✅  |     | 💭  | ⚙️  |
| [table-granted](docs/rules/table-granted.md)                       | Require the table privileges that client calls and subscriptions need                   | ✅  |     |     | 💭  | ⚙️  |

<!-- end auto-generated rules list -->

## Configuration

`recommended` turns on every rule (`subscribe-status-handler` as a warning) for `.ts`, `.tsx`,
`.mts` and `.cts` files and skips `supabase/functions` (Deno edge functions are not supported).
Everything else is optional, under `settings.supabase`:

- `projectDir`: the folder that holds `supabase/migrations`, when it is not above the linted files.
- `clients`: map your own client factories or files to a role, for example
  `{ callee: 'createAdminClient', role: 'service_role' }`.
- `defaultRoles`: the roles a publishable-key client can run as (`anon` and `authenticated`).
- `unknownKey`: whether a client whose key the plugin cannot classify uses `defaultRoles` or is
  skipped.
- `grantsLintConfig`: a grants-lint config file to use instead of grants-lint's own lookup.

To change a rule, add an object after `recommended` with its `files` and `ignores`
(`files: supabase.configs.recommended.files, ignores: supabase.configs.recommended.ignores`), so
ESLint finds the plugin for every file the object covers. The plugin is an ES module; a CommonJS
config imports it with `import()`. All settings, rule options, monorepos (`withProject`) and
`eslint --cache`:
[docs/configuration.md](docs/configuration.md).

## FAQ

"Does it connect to my database?", "Why does it need type information?", "Why did it flag my table
that works in production?": see the [FAQ](docs/faq.md).

## Works with supabase-grants-lint

[supabase-grants-lint](https://github.com/guptaaman678/supabase-grants-lint) checks the migrations
themselves and prints the `grant` that fixes a table. This plugin uses its engine and its config to
show the same problem at the line of client code that will break. They run independently; neither
needs the other installed by hand.

For the 1,000-row PostgREST limit, see [rowcap](https://github.com/anabecalab/rowcap).

Not affiliated with or endorsed by Supabase.

## License

[MIT](LICENSE)
