# Security policy

## Supported versions

`eslint-plugin-supabase` is a static analysis ESLint plugin: it opens no
network connection and reads only files inside the linted project
(migrations, `supabase/config.toml`, `grants-lint.config.json` or
`package.json#grantsLint`, and the plugin's own settings). It writes nothing,
except a stats file when the user sets `ESLINT_PLUGIN_SUPABASE_STATS`.
Security fixes are released against the latest `0.x` minor version. Once
1.0.0 ships, the latest major version receives security fixes.

| Version    | Supported |
| ---------- | --------- |
| latest 0.x | yes       |
| older 0.x  | no        |

## Reporting a vulnerability

Please do not open a public issue for a security report. Use [GitHub's
private vulnerability reporting](https://github.com/guptaaman678/eslint-plugin-supabase/security/advisories/new)
for this repository.

Include, where possible: the version affected, the minimal migration SQL and
lint target that reproduces the issue, and the impact you expect (for
example, a false negative that would hide a real RLS or realtime problem).

You should expect a first response within 7 days. Confirmed vulnerabilities
are fixed in a patch release and credited in the release notes unless you ask
otherwise.

## Scope

In scope: the ESLint plugin and its rules, as published from this
repository, including how it resolves and reads project configuration. Out
of scope: the Supabase platform itself, `supabase-grants-lint` (its own
repository has its own security policy), and any file outside the linted
project.
