---
'eslint-plugin-supabase': minor
---

Add `supabase/no-unsent-query` (error in `recommended`): reports a lazy Supabase query builder or storage download that is discarded with `void` or left as a bare statement, so the request is never sent. Two suggestions: `await` (inside async functions) and `.then()`.
