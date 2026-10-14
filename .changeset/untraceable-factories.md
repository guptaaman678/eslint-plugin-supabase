---
'eslint-plugin-supabase': patch
---

A client from your own factory is now skipped (reason `unknown-client`) when the factory can also return a value the plugin cannot trace, such as a test seam (`client = c` in a setter, or `if (factoryForTests) return factoryForTests();`), and so is a client returned by calling a function parameter, a `let` or a property (`getClient()`). Before, such calls took the default roles, so `rls-readable` reported reads and writes of service role clients. Map such a factory in `settings.supabase.clients` to have its calls checked.
