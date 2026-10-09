---
'eslint-plugin-supabase': minor
---

New rule `realtime-table-published` (error in `recommended`): reports a Realtime `postgres_changes` subscription to a table that your migrations never add to the `supabase_realtime` publication, so it connects and never receives an event. Options `publication`, `ignoreTables`, `reportUnknownTables` and `reportUnresolved`. Membership changed inside a `do` block is skipped, not reported.
