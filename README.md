# eslint-plugin-supabase

ESLint rules that catch Supabase mistakes that TypeScript cannot: unsent query builders, missing
realtime subscribe status handlers, unpublished realtime tables, and RLS or grant mismatches, all
found by reading your migrations, not by calling your database.

Not affiliated with or endorsed by Supabase.

## Status

Pre-release. No rules are published yet (this is the package scaffold); see the project's
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

| Name |
| :--- |

<!-- end auto-generated rules list -->

## License

MIT
