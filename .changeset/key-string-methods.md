---
'eslint-plugin-supabase': patch
---

A client's key read through a string method without arguments, such as `process.env.SUPABASE_SERVICE_ROLE_KEY!.trim()`, is now classified by the name it is called on. Before, such a service role client was treated as a client-role client, so `rls-readable` reported its reads and writes.
