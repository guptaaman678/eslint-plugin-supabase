# Require a row level security policy for client reads, filtered writes and subscriptions

📝 Require a row level security policy for client reads, filtered writes and subscriptions.

💼 This rule is enabled in the ✅ `recommended` config.

💭 This rule requires [type information](https://typescript-eslint.io/linting/typed-linting).

<!-- end auto-generated rule header -->

With row level security (RLS) on, Postgres shows a role only the rows a policy lets it see. A
table with RLS on and no policy for the role does not refuse the request: a `select` returns an
empty list, a filtered `update` or `delete` changes nothing, and both come back with no error. The
code looks right, the request succeeds, and the data never appears or never changes.

## Rule details

This rule reads your migrations (through the `supabase-grants-lint` engine, the same replay
grants-lint runs) and, for a call by a client that runs as `anon` or `authenticated`, reports:

- a read (`select`, with or without `count` or `head`) when no role the client can run as has a
  select policy;
- a filtered `update` or `delete` (with or without `.select()`) when no role has an update (or
  delete) policy, **or** no role has a select policy: the filter reads rows, so Postgres applies
  the select policies too, and without one the filter finds nothing;
- an unfiltered `update` or `delete` when no role has an update (or delete) policy;
- a Realtime `postgres_changes` subscription for `INSERT`, `UPDATE` or `*` events when no role has
  a select policy. Realtime applies RLS to each subscriber: insert and update events are dropped,
  and delete events arrive with only the primary key.

A policy counts when it is permissive, its command is the one needed or `all`, its roles include
the role or `public`, and its `using` is not literally `false`. Restrictive policies only narrow
what permissive ones admit, so a table with restrictive policies alone admits nothing.

The client's role comes from how it is created: a client created with a publishable or anon key
runs as `anon` or `authenticated` (the default role set, `settings.supabase.defaultRoles`), and a
client created with a service role or secret key bypasses RLS and is never reported. A call is
reported only when **no** role in the set passes, so a table readable by `authenticated` alone is
fine for a client that may be signed in. For a read, update or delete, only the roles that hold
every table privilege the call needs count (the same privileges `table-granted` checks): when no
role holds them, the call fails with error 42501 instead of returning nothing, so `table-granted`
reports it and this rule does not. Map your own client factories with
[`settings.supabase.clients`](../configuration.md#clients).

Examples of **incorrect** code for this rule:

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://example.supabase.co', 'sb_publishable_example');

// public.orders has row level security on and no policy in the migrations.
export async function loadOrders() {
  const { data } = await supabase.from('orders').select();
  return data; // always []
}

export async function clearTotal(id: number) {
  await supabase.from('orders').update({ total: 0 }).eq('id', id); // changes nothing
}
```

Fix it in a migration, with the policies your app needs:

```sql
create policy "owners read" on public.orders
  for select to authenticated
  using (auth.uid() = user_id);

create policy "owners update" on public.orders
  for update to authenticated
  using (auth.uid() = user_id);
```

Examples of **correct** code for this rule:

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://example.supabase.co', 'sb_publishable_example');
const admin = createClient('https://example.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY!);

// public.scores has select and update policies for authenticated.
export async function loadScores() {
  const { data } = await supabase.from('scores').select();
  return data;
}

export async function resetScore(id: number) {
  await supabase.from('scores').update({ points: 0 }).eq('id', id);
}

// The service role bypasses row level security.
export async function loadAllOrders() {
  const { data } = await admin.from('orders').select();
  return data;
}

// Inserts and upserts are not checked: without a policy they fail with an error (42501).
export async function addOrder() {
  await supabase.from('orders').insert({ total: 1 });
}
```

### Tables with RLS from the `ensure_rls` trigger

Supabase offers an opt-in event trigger, `ensure_rls`, that turns RLS on for every new table in
`public`. The replay follows it: a table created while the trigger exists has RLS on even with no
`enable row level security` statement, and the message says "RLS is on via the `ensure_rls`
trigger". A first `supabase db pull` keeps the trigger's function `public.rls_auto_enable()` but
not the trigger itself, so the replay also treats the trigger as present from the migration file
after the one that defines that function (grants-lint's `autoRls` setting, default `"auto"`;
`"off"` counts only explicit statements). Tables in that same file, such as the pulled baseline's
own tables, keep the RLS state their own statements give: a dump writes `enable row level
security` for every table that has RLS on, so a table without it had RLS off when it was pulled. Note
that a local stack or a preview branch built from such migrations lacks the trigger unless a
migration creates it, so RLS can be on in production and off locally for the same table.

### Policies created inside `do` blocks

Some projects create policies inside a `do` block, for example only if the policy does not exist
yet. The replay does not run plpgsql, so a table whose policies a `do` block creates, alters or
drops (with RLS on) is skipped, not reported (reason `policy-uncertain`). A block that builds the
table name at run time makes every table's policies unknown from that point. The mark stays until
the table is dropped. With `reportUnresolved`, the rule names the migration file and line of the
block. To have such a table checked, write its policies as plain statements:

```sql
-- Instead of a do block that creates the policy only if it is missing:
drop policy if exists "orders are readable" on public.orders;
create policy "orders are readable" on public.orders
  for select to authenticated using (true);
```

### Reads through functions

A table with RLS on and no policy is a common, deliberate pattern when every read goes through a
`security definer` function or a server-side client. Such tables are never reported, because the
rule checks only direct client calls: an `.rpc()` call is not checked, and neither is a service
role client.

### Not checked

- `insert(...)`, `insert(...).select()` and every `upsert`: without the policies they need, they
  fail loudly with error 42501, so they are not silent failures. Grants are checked by
  `table-granted`.
- A read, update or delete that no role in the set holds the privileges for: it fails loudly
  with error 42501, which `table-granted` reports.
- Views: RLS applies to the tables a view reads only when the view is `security_invoker`, so
  views are skipped (reason `view`).
- Tables without RLS pass.

The rule skips, and counts in its statistics, a call it cannot resolve: a `schema` or `table` that
is not a string literal (or a union of at most five), an operation not chained to `.from()`, a
subscription with no `table` or a non-literal `event`, a client it cannot trace to the call that
created it (including a client from your own factory when that factory can also return a value
it cannot trace, such as a client a test installs), a client whose key is neither visibly publishable nor service role when
`settings.supabase.unknownKey` is `skip`, a file with no `supabase/migrations` folder above it, a
replay that fails, a table that no migration creates, and a table whose policies a `do` block
changes. Set `reportUnresolved` to report skipped calls.

## Options

<!-- begin auto-generated rule options list -->

| Name               | Description                                                                                                           | Type     | Default | Required |
| :----------------- | :-------------------------------------------------------------------------------------------------------------------- | :------- | :------ | :------- |
| `ignoreTables`     | Tables not to check, each with the reason (for example, read only through a server-side client).                      | Object[] | `[]`    |          |
| `reason`           | In an `ignoreTables` entry: why the table is not checked.                                                             | String   |         | Yes      |
| `reportUnresolved` | Report calls the rule cannot check (dynamic names, untraceable clients, no project, views), instead of skipping them. | Boolean  | `false` |          |
| `table`            | In an `ignoreTables` entry: `schema.table`, or `table` in schema `public`.                                            | String   |         | Yes      |

<!-- end auto-generated rule options list -->

### `ignoreTables`

Tables not to check, each with a reason, like grants-lint's suppressions. Write `schema.table`,
or `table` for schema `public`.

```js
// eslint.config.js
export default [
  {
    rules: {
      'supabase/rls-readable': [
        'error',
        {
          ignoreTables: [
            { table: 'public.orders', reason: 'Policies are added by hand in production' },
          ],
        },
      ],
    },
  },
];
```

Examples of **correct** code with `{ "ignoreTables": [{ "table": "public.orders", "reason": "Policies are added by hand in production" }] }`:

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://example.supabase.co', 'sb_publishable_example');

export async function loadOrders() {
  const { data } = await supabase.from('orders').select();
  return data;
}
```

### `reportUnresolved`

Report each call the rule skipped, with the reason and what would make it checkable.

## When not to use it

Turn it off if your policies are not in your migrations (for example, created only from the
dashboard), since every read would look unprotected. For a few such tables, prefer
`ignoreTables`.
