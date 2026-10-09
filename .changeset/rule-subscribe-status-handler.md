---
'eslint-plugin-supabase': minor
---

Add `supabase/subscribe-status-handler` (warn in `recommended`): reports a Realtime `channel.subscribe()` call with no status callback, or with a callback that declares no parameters, so `CHANNEL_ERROR`, `TIMED_OUT` and `CLOSED` go unnoticed. Option `allowWrappers` names project helpers that already check the status.
