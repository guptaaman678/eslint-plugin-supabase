# Require the table privileges that client calls and subscriptions need

📝 Require the table privileges that client calls and subscriptions need.

💼 This rule is enabled in the ✅ `recommended` config.

💭 This rule requires [type information](https://typescript-eslint.io/linting/typed-linting).

<!-- end auto-generated rule header -->

Before row level security is even looked at, Postgres checks that the role holds the table
privilege the statement needs. A client call whose role lacks it fails with error 42501
(permission denied). A Realtime subscription fails more quietly: it connects, and then receives no
data.

## Rule details

This rule reads your migrations (through the `supabase-grants-lint` engine, the same replay
grants-lint runs) and reports a call when **no** role the client can run as holds every privilege
the call needs:

| Call                                           | Needs                    |
| :--------------------------------------------- | :----------------------- |
| `select()` (with or without `count` or `head`) | select                   |
| `insert(...)`                                  | insert                   |
| `insert(...).select()`                         | insert, select           |
| `update(...)` or `delete()` with a filter      | update or delete, select |
| `update(...)` or `delete()` without a filter   | update or delete         |
| either of those with `.select()`               | update or delete, select |
| `upsert(...)` (merge, the default)             | insert, update, select   |
| `upsert(..., { ignoreDuplicates: true })`      | insert, select           |
| a Realtime `postgres_changes` subscription     | select                   |

A filter reads rows, so a filtered write needs select, and the statement the Data API runs for an
upsert needs select in both forms. When
`ignoreDuplicates` is not a literal, the rule checks only what both upsert forms need (insert and
select). A privilege counts when it is granted to the role or to `public`, on the whole table or
on some of its columns, as in grants-lint.

A subscription on a table the role cannot select from does not fail with 42501: its insert and
update events arrive with an `Unauthorized` error and no data, and a filtered subscription is
rejected after it reports `SUBSCRIBED`, which only a `system` listener sees.

The client's role comes from how it is created: a client created with a publishable or anon key
runs as `anon` or `authenticated` (the default role set, `settings.supabase.defaultRoles`), and a
client created with a service role or secret key runs as `service_role`. The service role bypasses
row level security but not grants, so its calls are checked too. A call is reported only when no
role in the set passes; the message names the role that misses the fewest privileges, and the
grant that would fix it. Map your own client factories with
[`settings.supabase.clients`](../configuration.md#clients).

Examples of **incorrect** code for this rule:

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://example.supabase.co', 'sb_publishable_example');

// The migrations revoke every privilege on public.audit_log from anon and authenticated,
// then grant select back to authenticated.
export async function logEntry(entry: string) {
  await supabase.from('audit_log').insert({ entry }); // fails with 42501
}
```

Fix it in a migration, with the privileges your app needs:

```sql
grant insert on public.audit_log to authenticated;
```

Examples of **correct** code for this rule:

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://example.supabase.co', 'sb_publishable_example');
const admin = createClient('https://example.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY!);

// authenticated holds select on public.audit_log.
export async function loadEntries() {
  const { data } = await supabase.from('audit_log').select();
  return data;
}

// service_role holds insert on public.audit_log.
export async function logEntry(entry: string) {
  await admin.from('audit_log').insert({ entry });
}
```

### The 2026-10-30 grants change

Supabase has announced that from 2026-10-30 it stops granting Data API access to new tables in
`public` automatically. Before that date, or before a project opts in early (a migration that
revokes those default privileges, or grants-lint's `since` setting), the replayed default
privileges usually grant every table privilege to `anon`, `authenticated` and `service_role`, so
this rule rarely fires on those tables. After it, a new table gets no grant until a migration adds
one. That is where this rule finds most problems: a call on such a table fails with 42501, and a
subscription on it fails silently.

### Relation to grants-lint

[grants-lint](https://github.com/guptaaman678/supabase-grants-lint) checks your migrations: it
reports tables that your migrations leave without the grants the Data API needs. This rule uses
the same replay and checks your code instead: it reports each call that needs a privilege the
migrations do not grant. Run grants-lint on your migrations, and this rule on the code that calls
them.

### Not checked

- `.rpc()` calls (the `execute` privilege on functions) are not checked in v0.1.
- An insert that leaves out a `serial` or `bigserial` column also needs `usage` on the column's
  sequence. That is not checked in v0.1. Identity columns need nothing.
- A column grant counts as held even when it does not cover the columns the call uses.

The rule skips, and counts in its statistics, a call it cannot resolve: a `schema` or `table` that
is not a string literal (or a union of at most five), an operation not chained to `.from()`, a
subscription with no `table`, a client it cannot trace to the call that created it (including a
client from your own factory when that factory can also return a value it cannot trace, such as
a client a test installs), a client whose
key is neither visibly publishable nor service role when `settings.supabase.unknownKey` is `skip`,
a file with no `supabase/migrations` folder above it, a replay that fails, and a table that no
migration creates. Set `reportUnresolved` to report skipped calls.

## Options

<!-- begin auto-generated rule options list -->

| Name               | Description                                                                                                                                        | Type     | Default | Required |
| :----------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- | :------- | :------ | :------- |
| `ignoreTables`     | Tables not to check, each with the reason (for example, granted outside the migrations).                                                           | Object[] | `[]`    |          |
| `reason`           | In an `ignoreTables` entry: why the table is not checked.                                                                                          | String   |         | Yes      |
| `reportUnresolved` | Report calls the rule cannot check (dynamic names, untraceable clients, no project, tables the migrations never create), instead of skipping them. | Boolean  | `false` |          |
| `table`            | In an `ignoreTables` entry: `schema.table`, or `table` in schema `public`.                                                                         | String   |         | Yes      |

<!-- end auto-generated rule options list -->

### `ignoreTables`

Tables not to check, each with a reason, like grants-lint's suppressions. Write `schema.table`,
or `table` for schema `public`.

```js
// eslint.config.js
export default [
  {
    rules: {
      'supabase/table-granted': [
        'error',
        {
          ignoreTables: [{ table: 'public.audit_log', reason: 'Granted by hand in production' }],
        },
      ],
    },
  },
];
```

Examples of **correct** code with `{ "ignoreTables": [{ "table": "public.audit_log", "reason": "Granted by hand in production" }] }`:

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://example.supabase.co', 'sb_publishable_example');

export async function logEntry(entry: string) {
  await supabase.from('audit_log').insert({ entry });
}
```

### `reportUnresolved`

Report each call the rule skipped, with the reason and what would make it checkable.

## When not to use it

Turn it off if your grants are not in your migrations (for example, made only from the dashboard
or by a script outside them), since every call would look ungranted. For a few such tables,
prefer `ignoreTables`.
