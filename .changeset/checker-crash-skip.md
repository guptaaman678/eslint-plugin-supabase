---
'eslint-plugin-supabase': patch
---

When the TypeScript checker throws while typing one expression (TypeScript 6.0.3 can, inside its module-specifier code), the rules skip that expression instead of stopping the lint of the whole file.
