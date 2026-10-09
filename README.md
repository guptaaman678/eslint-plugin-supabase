# eslint-plugin-supabase

ESLint rules that catch Supabase mistakes that TypeScript cannot: unsent query builders, missing
realtime subscribe status handlers, unpublished realtime tables, and RLS or grant mismatches, all
found by reading your migrations, not by calling your database.

Not affiliated with or endorsed by Supabase.

## Status

Pre-release. Nothing is published to npm yet; see the project's
[CHANGELOG](./CHANGELOG.md) for what has shipped.

## Installation

```sh
npm install --save-dev eslint-plugin-supabase
```

Peer dependency ranges (`eslint`, `typescript`, `@typescript-eslint/parser`) are still provisional
and will be finalized before the first rule ships.

## Usage

```js
// eslint.config.js
import supabase from 'eslint-plugin-supabase';

export default [supabase.configs.recommended];
```

## Rules

<!-- begin auto-generated rules list -->

💼 Configurations enabled in.\
⚠️ Configurations set to warn in.\
✅ Set in the `recommended` configuration.\
💡 Manually fixable by [editor suggestions](https://eslint.org/docs/latest/use/core-concepts#rule-suggestions).\
💭 Requires [type information](https://typescript-eslint.io/linting/typed-linting).\
⚙️ Has configuration options.

| Name                                                               | Description                                                        | 💼  | ⚠️  | 💡  | 💭  | ⚙️  |
| :----------------------------------------------------------------- | :----------------------------------------------------------------- | :-- | :-- | :-- | :-- | :-- |
| [no-unsent-query](docs/rules/no-unsent-query.md)                   | Disallow `void` and unsent Supabase query builders                 | ✅  |     | 💡  | 💭  |     |
| [subscribe-status-handler](docs/rules/subscribe-status-handler.md) | Require a status callback on Supabase Realtime `subscribe()` calls |     | ✅  |     | 💭  | ⚙️  |

<!-- end auto-generated rules list -->

## License

MIT
