---
'eslint-plugin-supabase': patch
---

`rls-readable` no longer treats the tables of a `supabase db pull` baseline as having RLS on from the `ensure_rls` trigger. The trigger's function in a baseline now counts from the next migration file, so tables in the baseline keep the RLS state their own statements give, and tables created by later migrations still get RLS from the trigger. Requires `supabase-grants-lint` `^0.3.2`.
