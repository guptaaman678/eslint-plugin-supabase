---
'eslint-plugin-supabase': minor
---

Resolve the role each Supabase client runs as: `settings.supabase.clients` entries by module glob or factory name, then service-role and secret key names or `sb_secret_` literals, then anon and publishable names or `sb_publishable_` literals, then `defaultRoles` (or a skip with `unknownKey: "skip"`). Clients with no traceable origin are skipped. Skips are counted, and `ESLINT_PLUGIN_SUPABASE_STATS=<path>` writes them to `<path>.<threadId>.json` at exit. A `clients[].module` glob with an unclosed `{` is now a settings error.
