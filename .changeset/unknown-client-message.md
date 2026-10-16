---
'eslint-plugin-supabase': patch
---

The `reportUnresolved` message for a skipped `unknown-client` call now suggests `settings.supabase.clients` only when the client comes from your own factory, which an entry can map. For a client that is itself a function parameter, a `let` or a property, no entry can reach it, and the message says how to have the call checked instead.
