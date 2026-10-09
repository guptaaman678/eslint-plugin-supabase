---
'eslint-plugin-supabase': minor
---

New rule `rls-readable` (error in `recommended`): reports a read, a filtered update or delete, or a Realtime `postgres_changes` subscription by an `anon` or `authenticated` client on a table that has row level security on and no policy admitting the call in your migrations, so it returns or changes nothing with no error. A filtered update or delete also needs a select policy. Service role clients, inserts, upserts and views are not reported. Options `ignoreTables` and `reportUnresolved`.
