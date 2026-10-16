# Require Realtime `postgres_changes` tables to be in the publication

📝 Require Realtime `postgres_changes` tables to be in the publication.

💼 This rule is enabled in the ✅ `recommended` config.

💭 This rule requires [type information](https://typescript-eslint.io/linting/typed-linting).

<!-- end auto-generated rule header -->

Supabase Realtime sends `postgres_changes` events only for tables in the `supabase_realtime`
publication. A subscription to a table outside it still connects: the channel reaches
`SUBSCRIBED`, no error reaches the `subscribe()` callback, and no event ever arrives. The app
looks fine and simply never updates.

## Rule details

This rule reads your migrations (through the `supabase-grants-lint` engine, the same replay
grants-lint runs) and reports a `.on('postgres_changes', { schema, table })` subscription when the
table is created in your migrations but never added to the publication there, by table, by
schema (`for tables in schema`) or through `for all tables`. A table that is added and later
dropped from the publication is reported too.

The rule reads types, so it finds the channel when it is held in a variable or returned by a
helper. A `table` given as a union of string literals is checked member by member.

Examples of **incorrect** code for this rule:

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://example.supabase.co', 'sb_publishable_example');

// No migration adds public.todos to supabase_realtime.
supabase
  .channel('todos')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, (payload) => {
    console.log(payload);
  })
  .subscribe((status) => console.log(status));
```

Fix it in a migration:

```sql
alter publication supabase_realtime add table public.todos;
```

Examples of **correct** code for this rule:

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://example.supabase.co', 'sb_publishable_example');

// A migration runs `alter publication supabase_realtime add table public.messages;`.
supabase
  .channel('messages')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
    console.log(payload);
  })
  .subscribe((status) => console.log(status));
```

### Tables published from the dashboard

The check is against your migrations. A table you added to the publication in the dashboard
(Database > Replication) after your last `supabase db pull` is published in that project, but not
in any environment built from your migrations: the local stack, preview branches and a new project
all miss it, and the subscription is silent there. Add the table in a migration, or, if you rely on
the dashboard on purpose, list it in `ignoreTables` with the reason. A first `supabase db pull`
writes `alter publication "supabase_realtime" add table only ...` for every table that was a member
at the time, so tables published before the pull are already in your migrations.

### Publication changes inside `do` blocks

Some projects add tables to the publication inside a `do` block, for example in a loop that
checks `pg_publication_tables` first. The replay does not run PL/pgSQL, so from that block on it
cannot tell which tables are members. Subscriptions to tables whose membership depends on the
block are skipped, not reported (reason `publication-uncertain`). A table added or dropped by a
plain statement after the block, or a later full `drop publication` and `create publication`, is
known again. With `reportUnresolved`, the rule names the migration file and line of the block.

The fix is to replace the block with plain statements:

```sql
-- Instead of a do block that loops over table names:
alter publication supabase_realtime add table public.todos, public.messages;
```

### What else can keep events away

- **Row level security and grants.** Realtime checks each subscriber's access to every change. A
  table in the publication still sends nothing to a role that cannot read it. The `rls-readable`
  and `table-granted` rules check subscriptions for that.
- **Filters.** Two filter pitfalls also reach `SUBSCRIBED` and then deliver nothing: a filtered
  `DELETE` subscription on a column outside the table's replica identity, and a `filter` the
  server rejects. This rule does not check filters; a later rule (working name
  `realtime-filter-valid`) will.

A status callback does not catch any of these, since the error goes to the channel's `system`
events. See [`subscribe-status-handler`](./subscribe-status-handler.md).

### Not checked

The rule skips, and counts in its statistics, a subscription it cannot resolve: a `schema` or
`table` that is not a string literal (or a union of at most five), `schema: '*'` or no `table`
(every table of a schema), a file with no `supabase/migrations` folder above it, and a replay that
fails. It also skips a table that no migration creates, and a view (only tables can be published),
unless `reportUnknownTables` is set. Set `reportUnresolved` to report skipped subscriptions.

## Options

<!-- begin auto-generated rule options list -->

| Name                  | Description                                                                                                                           | Type     | Default             | Required |
| :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------ | :------- | :------------------ | :------- |
| `ignoreTables`        | Tables not to check, each with the reason (for example, published from the dashboard on purpose).                                     | Object[] | `[]`                |          |
| `publication`         | The publication Realtime reads changes from.                                                                                          | String   | `supabase_realtime` |          |
| `reason`              | In an `ignoreTables` entry: why the table is not checked.                                                                             | String   |                     | Yes      |
| `reportUnknownTables` | Also report subscriptions to tables that no migration creates, instead of skipping them.                                              | Boolean  | `false`             |          |
| `reportUnresolved`    | Report subscriptions the rule cannot check (dynamic names, no project, membership changed in a `do` block), instead of skipping them. | Boolean  | `false`             |          |
| `table`               | In an `ignoreTables` entry: `schema.table`, or `table` in schema `public`.                                                            | String   |                     | Yes      |

<!-- end auto-generated rule options list -->

### `publication`

The publication Realtime reads from. The default, `supabase_realtime`, is the one Supabase
Realtime uses.

### `ignoreTables`

Tables not to check, each with a reason, like grants-lint's suppressions. Write `schema.table`,
or `table` for schema `public`.

```js
// eslint.config.js
export default [
  // ...typed linting and supabase.configs.recommended, then:
  {
    files: supabase.configs.recommended.files,
    ignores: supabase.configs.recommended.ignores,
    rules: {
      'supabase/realtime-table-published': [
        'error',
        { ignoreTables: [{ table: 'public.todos', reason: 'Published from the dashboard' }] },
      ],
    },
  },
];
```

Examples of **correct** code with `{ "ignoreTables": [{ "table": "public.todos", "reason": "Published from the dashboard" }] }`:

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://example.supabase.co', 'sb_publishable_example');

supabase
  .channel('todos')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, (payload) => {
    console.log(payload);
  })
  .subscribe((status) => console.log(status));
```

### `reportUnknownTables`

Also report a subscription to a table that no migration creates (or to a view), instead of
skipping it. Useful when every table should come from migrations.

### `reportUnresolved`

Report each subscription the rule skipped, with the reason and what would make it checkable.

## When not to use it

Turn it off if your project manages the publication outside migrations on purpose (only from the
dashboard, or with scripts the migrations do not include) and every environment is set up that
way. For a few such tables, prefer `ignoreTables`.
