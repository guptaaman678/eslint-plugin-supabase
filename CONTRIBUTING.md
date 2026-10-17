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
| `npm run mutation:check`          | score at least 85 and every survivor explained in [Mutation notes](#mutation-notes)           |
| `npm run bench`                   | cold and warm lint timings on generated projects (§6.8 budgets)                               |
| `npm run pack-check`              | pack the tarball, install it into a throwaway project, lint a fixture app through it          |
| `npm run ci:local`                | every CI step on this machine, one PASS or FAIL line each (see [Local CI](#local-ci))         |
| `npm run corpus`                  | pinned corpus regression (see [Pinned corpus](#pinned-corpus)); run `npm run build` first     |

## Local CI

`.github/workflows/ci.yml` runs the full matrix (ubuntu, macOS and Windows,
Node 22, 24 and 26) and the `compat` job on every push to `main` and every
pull request; it can also be started by hand (`workflow_dispatch`).

To check a change before pushing, `npm run ci:local` runs the commands of every
CI job in CI order:
`npm ci`, `format:check`, `lint`, `typecheck`, `build`, the demo check,
`test:coverage`, `docs:check`, `pack-check` and the 12 `compat` cells. A failed
step does not stop the later ones; the script prints one PASS or FAIL line per
step and exits 1 if any failed. `npm run ci:local -- --skip-compat` leaves the
compat cells out (they install packages from npm, so they need the network and
take a few minutes). It covers only the operating system and Node version it
runs on.

## Pinned corpus

`tests/corpus/pins.json` pins 10 public projects (MIT or Apache-2.0 only) at
fixed commits, chosen so that between them they produce findings for several
rules and skips for several reasons. For each pin it records the finding count
per rule and the skip count per reason (the reasons of
`ESLINT_PLUGIN_SUPABASE_STATS`). `npm run corpus` sparse-clones each project
into a temporary folder, checks its license file, installs only
`@supabase/supabase-js` at the pinned version with install scripts disabled,
lints it with the built plugin and fails on any count that differs. It keeps
no source and deletes the clones.

`.github/workflows/corpus.yml` runs it weekly, on pushes to `main` that change
the pins or the script, on demand, and from `release.yml` before every release.
It does not run on ordinary pull requests. When a change is meant to move the
counts, run `npm run corpus -- --update`, review the diff of `pins.json` and
explain it in the pull request.

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

The CI `compat` job runs the same projects against the packed plugin with the
ends of the supported ranges: ESLint 9.15.0, 9.39.5 and the latest 10.x,
TypeScript 5.8.2 and the newest below 6.1, supabase-js 2.58.0 and the latest
2.x. Run one combination locally with
`node scripts/compat-check.mjs --eslint 9.15.0 --typescript 5.8.2 --supabase-js 2.58.0 --ssr 0.7.0`.
Migrations saved with CRLF line endings live in `tests/fixtures/schemas/crlf/`,
which `.gitattributes` keeps byte for byte.

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
   the rule's file, or record why the mutant is equivalent in
   [Mutation notes](#mutation-notes).
7. Add a changeset (`npx changeset`) describing the user-visible change.

## Mutation notes

`npm run mutation` mutates `src/rules`, `src/schema`, `src/roles` and
`src/supabase`; CI runs it in four parallel shards and
`npm run mutation:check` merges their reports. The check fails below a score
of 85, on a surviving mutant this table does not explain, and on a row that no
longer matches a survivor. A row matches on file, mutator, the first line of
the original code and the replacement (write `|` as `\|`). The CI run is the
record: on a busy local machine some mutants time out (counted as detected)
that survive on CI, so a local score can read higher than the real one.

Tests run per mutant only through `tests/stryker-name-filter.ts`: Stryker's
vitest runner joins describe and test titles with a space, vitest 5 joins them
with `" > "`, so without the filter no test runs and every mutant survives.

Every row below is an equivalent mutant (no input can tell it apart from the
original), or one Stryker cannot score, checked by hand as the row says.

| File                                    | Mutator               | Original                                                                               | Replacement                                                                              | Why it survives                                                                                                                                                                                                                |
| --------------------------------------- | --------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/rules/no-unsent-query.ts`          | ConditionalExpression | `expression.operator === 'void'`                                                       | `true`                                                                                   | Every other unary operator gives a boolean, number or string, never a query builder, so the floating check it skips would find nothing.                                                                                        |
| `src/rules/no-unsent-query.ts`          | LogicalOperator       | `expression.type === AST_NODE_TYPES.UnaryExpression && expression.operator === 'void'` | `expression.type === AST_NODE_TYPES.UnaryExpression \|\| expression.operator === 'void'` | As above: a unary expression is never a builder, and only a unary expression has the operator `void`.                                                                                                                          |
| `src/rules/no-unsent-query.ts`          | ConditionalExpression | `expression.type === AST_NODE_TYPES.UnaryExpression`                                   | `true`                                                                                   | Only a unary expression has the operator `void`.                                                                                                                                                                               |
| `src/rules/no-unsent-query.ts`          | ObjectLiteral         | `{`                                                                                    | `{}`                                                                                     | Static mutant (the whole rule object): the module throws while the test files import it, vitest collects no tests and Stryker reports a survivor with 0 tests run. Applied by hand, the rule's test file fails.                |
| `src/rules/no-unsent-query.ts`          | ConditionalExpression | `callee.type !== AST_NODE_TYPES.MemberExpression`                                      | `false`                                                                                  | Any other callee has no `property`, so the checker finds no symbol and `isRefinementMethod` ends the chain on the next line (the `same(q)` test).                                                                              |
| `src/rules/subscribe-status-handler.ts` | ObjectLiteral         | `{`                                                                                    | `{}`                                                                                     | Static mutant of the rule object, as for `no-unsent-query`.                                                                                                                                                                    |
| `src/rules/rls-readable.ts`             | ObjectLiteral         | `{`                                                                                    | `{}`                                                                                     | Static mutant of the rule object, as for `no-unsent-query`.                                                                                                                                                                    |
| `src/rules/table-granted.ts`            | ObjectLiteral         | `{`                                                                                    | `{}`                                                                                     | Static mutant of the rule object, as for `no-unsent-query`.                                                                                                                                                                    |
| `src/rules/realtime-table-published.ts` | ObjectLiteral         | `{`                                                                                    | `{}`                                                                                     | Static mutant of the rule object, as for `no-unsent-query`.                                                                                                                                                                    |
| `src/rules/rls-readable.ts`             | ConditionalExpression | `projectDir === undefined`                                                             | `true`                                                                                   | A per-file cache: looking the project up again for the same file gives the same directory.                                                                                                                                     |
| `src/rules/table-granted.ts`            | ConditionalExpression | `projectDir === undefined`                                                             | `true`                                                                                   | As for `rls-readable.ts`.                                                                                                                                                                                                      |
| `src/rules/table-granted.ts`            | StringLiteral         | `''`                                                                                   | `"Stryker was here!"`                                                                    | The separator of a join over at most one privilege is never written.                                                                                                                                                           |
| `src/rules/subscribe-status-handler.ts` | ConditionalExpression | `wrappers.size === 0`                                                                  | `false`                                                                                  | A shortcut: with no wrappers the loop below finds no name in the empty set.                                                                                                                                                    |
| `src/rules/subscribe-status-handler.ts` | ConditionalExpression | `parent.id.type === AST_NODE_TYPES.Identifier`                                         | `true`                                                                                   | A destructuring pattern has no `name`, so the binding is undefined either way.                                                                                                                                                 |
| `src/rules/subscribe-status-handler.ts` | OptionalChaining      | `parent?.type`                                                                         | `parent.type`                                                                            | A function node always has a parent.                                                                                                                                                                                           |
| `src/rules/subscribe-status-handler.ts` | ConditionalExpression | `key.type === AST_NODE_TYPES.Literal`                                                  | `true`                                                                                   | The `typeof key.value === 'string'` test after it is false for every other key type.                                                                                                                                           |
| `src/rules/subscribe-status-handler.ts` | ConditionalExpression | `default:`                                                                             | `default:`                                                                               | Emptying the `default` case falls out of the switch, and the function returns undefined anyway.                                                                                                                                |
| `src/rules/rls-readable.ts`             | ConditionalExpression | `default:`                                                                             | `default:`                                                                               | As above.                                                                                                                                                                                                                      |
| `src/supabase/calls.ts`                 | OptionalChaining      | `checker.getResolvedSignature(origin)?.declaration`                                    | `checker.getResolvedSignature(origin).declaration`                                       | TypeScript resolves every call and `new` expression to a signature (its "unknown" signature at worst), never to undefined.                                                                                                     |
| `src/supabase/calls.ts`                 | ConditionalExpression | `member.type !== AST_NODE_TYPES.MemberExpression`                                      | `false`                                                                                  | A parent that is not a member expression has no `object`, so `member.object !== node` ends the chain anyway.                                                                                                                   |
| `src/supabase/calls.ts`                 | ConditionalExpression | `member.object !== node`                                                               | `false`                                                                                  | A call is never the property of a non-computed member, and a computed one ends the chain on the next line.                                                                                                                     |
| `src/supabase/calls.ts`                 | LogicalOperator       | `member.type !== AST_NODE_TYPES.MemberExpression \|\| member.object !== node`          | `member.type !== AST_NODE_TYPES.MemberExpression && member.object !== node`              | Both sides are true for a parent that is not a member expression, and the other case ends on the next line, as in the two rows above.                                                                                          |
| `src/roles/resolve.ts`                  | OptionalChaining      | `checker.getResolvedSignature(origin)?.declaration`                                    | `checker.getResolvedSignature(origin).declaration`                                       | As for `calls.ts`.                                                                                                                                                                                                             |
| `src/roles/resolve.ts`                  | ConditionalExpression | `clients.length === 0`                                                                 | `false`                                                                                  | A shortcut: finding a mapping among none gives undefined too.                                                                                                                                                                  |
| `src/schema/inputs.ts`                  | CallExpression        | `files.push(listed.configFile);`                                                       | `;`                                                                                      | Every config file the engine can report (`package.json` with a `grantsLint` key, `grants-lint.config.json`, the explicit file) is already in `grantsLintConfigFiles`, so the push only adds a duplicate that the `Set` drops.  |
| `src/roles/glob.ts`                     | ConditionalExpression | `!compiled.has(glob)`                                                                  | `true`                                                                                   | A cache: compiling the glob again gives the same expression.                                                                                                                                                                   |
| `src/roles/glob.ts`                     | StringLiteral         | `'/'`                                                                                  | `""`                                                                                     | Turns Windows separators into `/`. On Linux, where Stryker runs, the relative path has none; the Windows test job fails without it.                                                                                            |
| `src/roles/resolve.ts`                  | StringLiteral         | `'/'`                                                                                  | `""`                                                                                     | Windows separators, as for `glob.ts`.                                                                                                                                                                                          |
| `src/roles/resolve.ts`                  | ConditionalExpression | `client.callee !== undefined`                                                          | `true`                                                                                   | `names` holds only strings, so `names.includes(undefined)` is false.                                                                                                                                                           |
| `src/roles/resolve.ts`                  | ConditionalExpression | `!ts.isIdentifier(name)`                                                               | `false`                                                                                  | The checker has no symbol for a callee that is not a name, so the result is `[undefined]`, which matches no `callee` setting, like `[]`.                                                                                       |
| `src/roles/resolve.ts`                  | ArrayDeclaration      | `[]`                                                                                   | `["Stryker was here"]`                                                                   | Matters only for a `callee` setting of that text, which has spaces and so is no function's name. Covers both such mutants in `calleeNames` and `keyKind` (the latter reads index 1, absent either way).                        |
| `src/roles/resolve.ts`                  | ConditionalExpression | `kind === undefined`                                                                   | `true`                                                                                   | A per-factory cache: following the factory again gives the same kind.                                                                                                                                                          |
| `src/roles/resolve.ts`                  | CallExpression        | `factoryKinds.set(declaration, kind);`                                                 | `;`                                                                                      | As above.                                                                                                                                                                                                                      |
| `src/roles/resolve.ts`                  | CallExpression        | `seen.add(declaration);`                                                               | `;`                                                                                      | Without it a recursive factory is followed until `MAX_FACTORY_HOPS`, which also gives undefined, and one undefined return decides nothing, so the result is the same (the `recursion` test).                                   |
| `src/roles/resolve.ts`                  | ConditionalExpression | `origin === undefined`                                                                 | `false`                                                                                  | Covers both such mutants in `returnedKeyKind`: `getResolvedSignature(undefined)` gives undefined, so `inner` is undefined whenever `origin` is, and the `inner === undefined` test decides.                                    |
| `src/roles/resolve.ts`                  | ConditionalExpression | `ts.isFunctionDeclaration(declaration) \|\|`                                           | `true`                                                                                   | A call resolves to one of the four function kinds or to a signature without a body. The one other kind with a body, a constructor, is reached only by `super()`, and returns no client, so the result is undefined either way. |
| `src/schema/cache.ts`                   | ConditionalExpression | `fingerprint === entry.fingerprint`                                                    | `false`                                                                                  | A shortcut: the content hash compared next is equal whenever the fingerprint is, so the cached result is returned either way.                                                                                                  |
| `src/schema/engine.ts`                  | BooleanLiteral        | `true`                                                                                 | `false`                                                                                  | A compile-time check that the engine's snapshot type and the plugin's copy match; `npm run typecheck` fails on the mutant.                                                                                                     |
| `src/schema/view.ts`                    | ArrayDeclaration      | `[]`                                                                                   | `["Stryker was here"]`                                                                   | A string has no `permissive` flag, so the filter returns an empty list again.                                                                                                                                                  |

## Commits and releases

This project uses [Conventional Commits](https://www.conventionalcommits.org/)
and [Changesets](https://github.com/changesets/changesets). Every
user-visible change needs a changeset (`npx changeset`); internal-only changes
do not. Releases follow SemVer and stay `0.x` until the project's stability
promise is published.

### How a release happens

`.github/workflows/release.yml` runs on every push to `main`. While changesets
are pending it opens or updates a "chore: version packages" pull request that
bumps the version and writes the changelog. A pull request opened with the
workflow's own token starts no workflows, so CI does not run on it by itself:
close and reopen it (or push a commit to its branch) to run CI before merging.

Once that pull request is merged, `scripts/release-state.mjs` decides what
happens:

- **0.1.0 is published by hand.** The workflow skips it. The maintainer
  publishes it from a fresh clone of `main` at the merge commit (`npm ci`,
  `npm run build`, `npm pkg delete publishConfig.provenance`,
  `npm publish --access public`), pushes the tag `v0.1.0` and creates the
  GitHub release. 0.1.0 therefore carries no provenance attestation.
- **Every later version is staged.** The workflow runs
  `npm stage publish --provenance --access public` through npm trusted
  publishing (OIDC, no token; the trusted publisher allows staging only) and
  pushes the tag `vX.Y.Z`. The version is not live until the maintainer
  approves it on npmjs.com (or with `npm stage approve`) using the security
  key. Then the maintainer creates the GitHub release from the changelog entry.
- A version that is already live or already tagged is never staged again.
  `npm view` cannot see a staged version, so the tag is what prevents a second
  stage. If a staged version is rejected, delete its tag before releasing again.

## Maintenance policy

TODO(T13.2): this section is filled in when the project's maintenance policy
(triage order and response targets, how a confirmed false positive becomes a
regression fixture, rule ID and removal policy, scope boundaries) is written.
Until then, security reports go through private vulnerability reporting (see
`SECURITY.md`), not public issues.
