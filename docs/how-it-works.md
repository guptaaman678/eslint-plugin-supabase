# How it works

The plugin has two kinds of rules. The code rules (`no-unsent-query`, `subscribe-status-handler`)
decide from your code and its types alone. The schema rules (`realtime-table-published`,
`rls-readable`, `table-granted`) also read your migrations: for each Supabase call they work out
the table, the operation and the role the client runs as, and look them up in the database your
migrations build. Nothing connects to a database, and nothing leaves your machine.

## Finding Supabase calls by type

Every rule asks the TypeScript type checker what a value is, never what it is called. A client is
a value whose type is `SupabaseClient` from `@supabase/supabase-js` (or a class that extends it),
which covers `createClient` and `@supabase/ssr`'s `createBrowserClient` and `createServerClient`.
`client.schema(s)` returns a `PostgrestClient`, which counts as well. A query builder is one of the
lazy builder classes of `@supabase/postgrest-js`, or a storage download builder; a channel is a
`RealtimeChannel`. Subclasses, unions and intersections of these types count too.

A type matches when its class has the right name and is declared in the right package under
`node_modules/@supabase/`. The match does not depend on file names or lines inside those packages,
so it keeps working across supabase-js releases and with pnpm. This is why every rule needs type
information: a variable named `supabase` that is not a Supabase client is never reported, and a
client named anything else is still checked.

## Following the call chain

For a table operation, a schema rule starts at `client.from(table)` (or
`client.schema(s).from(table)`) and follows the chain to the operation: `select`, `insert`,
`update`, `upsert` or `delete`. It records the filters after `update` and `delete`, a `.select()`
chained after a write, and options such as `ignoreDuplicates` on `upsert`, because each changes
the privileges and policies the call needs. For Realtime, it reads the `schema`, `table` and
`event` of a `.on('postgres_changes', { ... })` subscription.

The table name can be a string literal, a template literal without expressions, or anything whose
TypeScript type is a string literal or a union of at most five. With a generated `Database` type,
the table name often keeps its literal type even when it passes through a variable. The schema
comes from `.schema('x')`, else from the `db.schema` option at the `createClient` call, else
`public`. A Realtime subscription takes its schema only from its own options.

## Which role the client runs as

Row level security and grants depend on the role, so the schema rules find the call that created
the client (through imports, `const` aliases and `await`) and read the name of its key argument: a
publishable or anon key means `anon` or `authenticated`, a service role or secret key means
`service_role`. Only names and key prefixes in the source text are read; key values are never
decoded. Your own client factories can be mapped in the settings. [Configuration](./configuration.md#clients)
has the full order and the settings.

## The schema snapshot

The schema rules read the database your migrations build, not the live database. The
[`supabase-grants-lint`](https://github.com/guptaaman678/supabase-grants-lint) engine replays
`supabase/migrations` in order, parsing each statement with Postgres's own parser (`libpg-query`),
and returns a snapshot: every table and view with its row level security state, its privileges per
role (at table or column level) and its policies, plus sequences and publications. It is the same
replay grants-lint runs, with the same config file, so the two tools never disagree.

The replay models what Supabase sets up before your first migration: the default privileges for
`anon`, `authenticated` and `service_role` (and the change of those defaults on 2026-10-30, per
grants-lint's `since` setting), the empty `supabase_realtime` publication, and the opt-in
`ensure_rls` event trigger that turns row level security on for new tables in `public`.

The plugin loads the SQL parser once, when ESLint loads the plugin, and then replays
synchronously inside each rule, in the same thread, for the command line and the editor alike.
That is why the plugin must be loaded as an ES module ([Configuration](./configuration.md#es-modules-only-and-commonjs-configs)).

## When a call is skipped

A rule that cannot resolve something does not guess and does not report. It skips the call and
counts it, by reason: a table or schema name that is not a literal, a subscription to every table,
a client it cannot trace, a file with no Supabase project above it, a table no migration creates,
a view, a publication or a table's policies changed inside a `do` block, or a replay that fails. Set a schema rule's
`reportUnresolved` option to report these calls, or set `ESLINT_PLUGIN_SUPABASE_STATS` to count
them ([Configuration](./configuration.md#skip-statistics)).

## Limitations

- **Changes made in the dashboard.** The snapshot is what your migrations build. A table added to
  the Realtime publication, a policy or a grant created in the dashboard after your last
  `supabase db pull` is not in your migrations, so the rules can report a call that works in
  production. The report is still worth reading: a fresh environment built from your migrations
  (the local stack, a preview branch) lacks that change too. Pull the change into a migration
  (`supabase db pull` or `supabase db diff`) and the report goes away.
- **Dynamic names.** A table, schema or event computed at run time (a `string` variable, a
  function parameter, a union of more than five names) is skipped.
- **Clients the plugin cannot trace.** A client passed in as a function parameter, kept in a `let`,
  read from an object property, returned by calling a parameter or wrapped in a `Proxy` is
  skipped, and so is a client from your own factory when the factory can also return such a value
  (a test seam), unless the factory is mapped in `settings.supabase.clients`.
- **Code in `do` blocks and functions.** The replay does not run plpgsql. A publication changed
  inside a `do` block makes that publication's membership unknown, and `realtime-table-published`
  skips it. A policy created, altered or dropped inside a `do` block makes that table's policies
  unknown (every table's, when the block builds the table name at run time), and `rls-readable`
  skips the table. Grants and row level security changed inside a `do` block, and anything changed
  inside a function body, are not seen.
- **RPC.** `.rpc()` calls are checked by `no-unsent-query`, but not against the schema.
- **Column grants.** A role that holds a privilege on some columns counts as holding it. Whether
  those columns cover the ones a call uses is not checked.
- **Deno edge functions.** Code under `supabase/functions/` needs a Deno TypeScript setup and is
  ignored by `recommended`.

## Performance

The schema rules (`realtime-table-published`, `rls-readable`, `table-granted`) replay your migrations once per ESLint thread, keep the result in memory, and reuse it for every file. At most every 250 ms they compare the migrations' listing, sizes and modification times, and replay again only when the contents changed. Under `--concurrency N`, every worker thread builds its own snapshot, so the costs below are per thread.

`npm run bench` measures this on generated projects: a 200-file TypeScript app linted with typescript-eslint's `recommendedTypeChecked`, with 100 and 500 migrations, with `--concurrency off` and `4`. Each figure is the median of 3 runs on an Apple M4 (10 cores, 16 GB), Node 22.16.0, macOS 26.5, on 2026-10-12.

| Measure                                                      | 100 migrations    | 500 migrations    | Budget                       |
| ------------------------------------------------------------ | ----------------- | ----------------- | ---------------------------- |
| First file that needs the schema (replay), slowest thread    | 86 ms             | 288 ms            | 300 ms (100), 1,000 ms (500) |
| Every other file, median / p95                               | 0.57 ms / 1.43 ms | 0.54 ms / 1.37 ms | 2 ms / 10 ms (100)           |
| Plugin rule time on `eslint .`, over typescript-eslint alone | 9.6%              | 24.7%             |                              |
| The same, without the first replay of each thread            | 4.5%              | 5.8%              | 10%                          |
| Heap held per thread, plugin loaded and schema cached        | 12 MB             | 12 MB             | 30 MB (500)                  |

On this generated app, typescript-eslint takes about 1.1 to 1.2 s per thread, so the one replay per thread is most of the plugin's share. The share budget therefore leaves out each thread's first replay, which has its own budget in the first row; with that replay included, the share is 24.7% at 500 migrations. Of the heap figure, the cached snapshot of 500 migrations is under 1 MB; the rest is the plugin and its SQL parser, loaded once per thread.
