# FAQ

## Does it connect to my database?

No. The plugin opens no network connection and sends no telemetry. It reads only files in your
project: your migrations, the grants-lint config (`grants-lint.config.json` or
`package.json#grantsLint`) and your ESLint config. It never reads `.env` files and never decodes or
prints a key. The schema rules learn your schema by replaying your migrations locally
([How it works](./how-it-works.md#the-schema-snapshot)). The only file it ever writes is the
optional statistics file you ask for with `ESLINT_PLUGIN_SUPABASE_STATS`.

## Why does it need type information?

To know which values are Supabase clients, query builders and Realtime channels without guessing
from names. `supabase.from('todos').select()` and `db.from('todos').select()` look the same to a
rule that reads only syntax, and so does a `.subscribe()` on a Realtime channel and on an RxJS
observable. With types, the plugin checks every Supabase call whatever its variable is called, and
never reports code that only looks like Supabase. Types also let it read table names that pass
through variables, as long as their type is a string literal.

Enable typed linting with typescript-eslint's `parserOptions.projectService`
([Configuration](./configuration.md#requirements)).

## How is it different from splinter?

[splinter](https://github.com/supabase/splinter) is Supabase's database linter, behind the
Security and Performance Advisors in the dashboard. It runs SQL against a live database and reports
problems in the database itself, such as a table in `public` without row level security. It does
not read your application code.

This plugin reads your application code and checks each Supabase call against the database your
migrations build. It answers a different question: not "is this table set up safely?" but "will
this call, from this client, actually work?" For example, a table with row level security on and
no policy is a deliberate pattern when every read goes through a function; splinter notes the
missing policy whether or not any code reads the table, while this plugin reports only a client
call that would return no rows.

## How is it different from grants-lint?

[grants-lint](https://github.com/guptaaman678/supabase-grants-lint) (`supabase-grants-lint`, by
the same author) lints your migrations: it finds the tables the Data API cannot reach once new
tables stop getting automatic grants, and prints the `grant` that fixes each, before any code is
involved. This plugin uses grants-lint's engine to replay the same migrations with the same config,
then checks the calls your code makes: whether the role a client runs as holds the privileges a
call needs (`table-granted`), whether a policy lets it see rows (`rls-readable`), and whether a
subscribed table is in the Realtime publication (`realtime-table-published`).

Use both: grants-lint in CI on your migrations, and this plugin in your editor and CI on the code
that calls them. They never disagree about the schema, because they share one replay.

## How is it different from typescript-eslint's `no-floating-promises`?

`no-floating-promises` checks promises, and a Supabase query builder is a thenable, not a promise.
In its default setup, a forgotten builder is not reported at all. With `checkThenables: true` it
reports one, but its first suggestion is `void`, which discards the builder before the request is
sent. `no-unsent-query` reports both the forgotten builder and the `void` one, and suggests `await`
or `.then()` instead. Keep `no-floating-promises` on for everything else.
[no-unsent-query](./rules/no-unsent-query.md#how-this-relates-to-typescript-eslint) has the
details.

## How is it different from rowcap?

[rowcap](https://github.com/anabecalab/rowcap) (`eslint-plugin-rowcap`) checks a different
Supabase pitfall: by default the Data API returns at most 1,000 rows, so a `.select()` without a
limit silently stops at the cap and still succeeds. rowcap reports those queries, and `.range()`
without `.order()`. This plugin does not check row limits. Use rowcap for that; the two plugins do
not overlap.

## Why did it flag my table that works in production?

The schema rules check the database your migrations build, not your production database. Usually
the difference is a change made in the dashboard and never pulled into a migration:

- the table was added to the Realtime publication under Database > Replication;
- a policy or a grant was created in the SQL editor or the dashboard;
- row level security was turned on or off by hand.

Production has the change; your migrations do not. A fresh environment built from your migrations
(the local stack, a preview branch, a new project) will fail the same way the rule says, so the
report is real for those environments. Capture the change in a migration (`supabase db pull`, or
write the statement the message suggests) and the report goes away.

Other causes:

- **The client role.** The plugin assumes a client with a publishable key may run as `anon` or
  `authenticated`, and reports only when neither role passes. If a client really runs as the
  service role (for example through your own factory), map it in
  [`settings.supabase.clients`](./configuration.md#clients).
- **A `do` block or a function.** The replay does not run plpgsql. A policy or grant created
  inside a `do` block is not seen ([Limitations](./how-it-works.md#limitations)).
- **A deliberate exception.** If a table is meant to fail for that client, add it to the rule's
  `ignoreTables` option with a reason.

If none of these explains it, please open an issue with the migration statements and the call
(with your own table names replaced if you prefer).
