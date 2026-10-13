---
'eslint-plugin-supabase': patch
---

`rls-readable` no longer reports a table whose policies a migration creates, alters or drops inside a `do` block. The replay cannot read the block, so the table's policies are unknown: the rule skips the call (reason `policy-uncertain`), and with `reportUnresolved` it names the migration file and line of the block.
