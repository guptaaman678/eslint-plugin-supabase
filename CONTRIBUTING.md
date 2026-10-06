# Contributing

Thanks for considering a contribution to `eslint-plugin-supabase`.

## Setup

```
git clone https://github.com/guptaaman678/eslint-plugin-supabase.git
cd eslint-plugin-supabase
npm ci
npm run build
npm test
```

Node `>=22` is required (`.nvmrc` pins the version used in development).

## Commands

| Command                           | Purpose                                                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm run build`                   | build the plugin with tsup                                                                    |
| `npm test`                        | run the vitest suite                                                                          |
| `npm run test:watch`              | run tests in watch mode                                                                       |
| `npm run test:coverage`           | run tests with coverage                                                                       |
| `npm run lint`                    | ESLint (including `eslint-plugin-eslint-plugin` on the rules)                                 |
| `npm run typecheck`               | `tsc --noEmit` in strict mode                                                                 |
| `npm run format` / `format:check` | Prettier                                                                                      |
| `npm run docs` / `docs:check`     | `eslint-doc-generator`: keeps the README rules table and doc headers in step with rule `meta` |
| `npm run mutation`                | Stryker mutation testing                                                                      |
| `npm run bench`                   | cold and warm lint timings on generated projects (§6.8 budgets)                               |
| `npm run pack-check`              | pack the tarball, install it into a throwaway project, lint a fixture app through it          |

## Typed fixtures

Rule tests use `@typescript-eslint/rule-tester` under vitest, against the typed
fixture project at `tests/fixtures/ts/` (its own `tsconfig.json`, real
`supabase-js` types from devDependencies). Schema-aware cases point
`settings.supabase.projectDir` at `tests/fixtures/schemas/<case>/`, a
synthetic Supabase project (`supabase/migrations/*.sql`) using fixture table
names such as `todos`, `orders`, `messages`, `audit_log` or `scores`, never
anything from a real project.

Every rule has typed valid and invalid cases, and one case for every
exemption its docs page names. Rule logic is also unit-tested against
snapshot fakes of the schema view, independent of the rule-tester suites.
Whole synthetic projects live under `tests/e2e/projects/<app>/` and are
linted through the ESLint Node API with exact expected messages.

Coverage thresholds: 100% lines and branches on `src/rules`, `src/schema`,
`src/roles` and `src/supabase`; 95% overall (`npm run test:coverage`).

## How to add a rule

1. Read the rule's semantics in `docs/rules/` (or draft the page first if the
   rule does not exist yet).
2. Implement `src/rules/<rule>.ts` using `src/util/create-rule.ts`. A rule
   reads the schema view (`src/schema/view.ts`) and the call-chain analysis
   (`src/supabase/calls.ts`); it never mutates either.
3. Register the rule in `src/index.ts` (and in `src/configs/recommended.ts` if
   it belongs in the recommended config).
4. Add fixtures: at least one failing case, one passing case, and one case
   for every exemption or edge condition named in the rule's spec.
5. Add `docs/rules/<rule>.md` with the same sections as the other pages. Run
   `npm run docs` to regenerate the README rules table and doc headers from
   the rule's `meta`, and check the result with `npm run docs:check`.
6. Run `npm run mutation` and either add a test for every surviving mutant in
   the rule's file, or record why the mutant is equivalent in a "Mutation
   notes" section (see T5.2).
7. Add a changeset (`npx changeset`) describing the user-visible change.

## Commits and releases

This project uses [Conventional Commits](https://www.conventionalcommits.org/)
and [Changesets](https://github.com/changesets/changesets). Every
user-visible change needs a changeset (`npx changeset`); internal-only changes
do not. Releases follow SemVer and stay `0.x` until the project's stability
promise is published.

## Maintenance policy

TODO(T13.2): this section is filled in when the project's maintenance policy
(triage order and response targets, how a confirmed false positive becomes a
regression fixture, rule ID and removal policy, scope boundaries) is written.
Until then, security reports go through private vulnerability reporting (see
`SECURITY.md`), not public issues.
