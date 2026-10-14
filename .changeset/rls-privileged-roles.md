---
'eslint-plugin-supabase': patch
---

`rls-readable` now considers, for a read, update or delete, only the roles that hold every table privilege the call needs. When no role holds them, the call fails with error 42501 rather than returning nothing, so `table-granted` reports it and `rls-readable` no longer reports it a second time as a silent no-op.
