// Setup file for `npm run mutation` only (vitest.mutation.config.ts).
//
// For each mutant, Stryker's vitest runner (10.0.0) selects the covering tests with a name
// pattern built from each test's describe and test titles joined by a space. Vitest 5 matches
// that pattern against the full name joined by " > ", so every test inside a `describe` was
// skipped, zero tests ran, and every mutant was reported as surviving. This lets each space in
// the pattern also match " > ". A space inside a title still matches itself, so the filter can
// only select more tests than Stryker asked for, never fewer.
interface WorkerState {
  config: { testNamePattern?: RegExp | string };
}

const state = (globalThis as { __vitest_worker__?: WorkerState }).__vitest_worker__;
const pattern = state?.config.testNamePattern;
if (state && pattern !== undefined) {
  const source = typeof pattern === 'string' ? pattern : pattern.source;
  const flags = typeof pattern === 'string' ? '' : pattern.flags;
  state.config.testNamePattern = new RegExp(source.replaceAll(' ', '(?: | > )'), flags);
}
