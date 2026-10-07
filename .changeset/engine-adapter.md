---
'eslint-plugin-supabase': minor
---

Read the database your migrations build through `supabase-grants-lint`'s engine (new dependency `supabase-grants-lint` `^0.3.0`), so the schema rules and grants-lint never disagree. Add `supabase.withProject({ projectDir })` for monorepos and custom project directories. `recommended` recomputes its `migrationsHash` at each config evaluation. The plugin loads its SQL parser with a top-level await, so `require()` of the plugin now fails with a message that shows the CommonJS form that works: `module.exports = import('eslint-plugin-supabase').then(({ default: supabase }) => [supabase.configs.recommended]);`.
