---
'eslint-plugin-supabase': minor
---

New rule `table-granted` (error in `recommended`): reports a table call or a Realtime `postgres_changes` subscription when no role the client can run as (including `service_role`) holds every table privilege it needs in your migrations, so the call fails with 42501 or the subscription receives no data. Writes that return rows or filter, and every upsert, also need select; a merge upsert needs update, `ignoreDuplicates: true` does not. Grants to `public` and column grants count. The message names the missing privileges and the grant that fixes them. Options `ignoreTables` and `reportUnresolved`.
