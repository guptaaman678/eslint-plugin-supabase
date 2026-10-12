---
'eslint-plugin-supabase': minor
---

Fewer false positives found on real projects. A client made by your own factory function (such as `createAdminClient()`, a local helper or a lazily created singleton) now takes its role from the key of the clients the factory returns, up to three factories deep. Key names matching `/service[_-]?key/i` count as service role, and a helper called with a string (`getEnv('SUPABASE_SERVICE_ROLE_KEY')`) is classified by that string. A client wrapped in `new Proxy(...)` or another non-Supabase class is skipped instead of being checked with the default roles. `no-unsent-query` no longer reports a statement that refines a builder variable in place, such as `if (done) query.eq('done', true);`.
