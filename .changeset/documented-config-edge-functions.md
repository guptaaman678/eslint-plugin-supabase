---
'eslint-plugin-supabase': patch
---

The documented configs now lint a project with edge functions and `.js` files without errors: the typed-linting block ignores `**/supabase/functions/**`, and every rule override uses the `files` and `ignores` of `recommended`, since an override for every file stops ESLint with `Could not find plugin "supabase"` on a `.js` file. The docs also say that the schema rules check nothing when your migrations do not create your tables, and to run `supabase db pull` for a baseline.
