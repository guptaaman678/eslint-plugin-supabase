// Lints the project in the working directory through the ESLint Node API, as a user's script
// would, and prints each linted file (relative, with `/` separators) and its messages as JSON.
// `tests/e2e/projects.test.ts` runs it in a fresh process per project, so the plugin loads once
// per thread and writes its stats file at exit, as in a real run. `scripts/compat-check.mjs`
// runs it under older ESLint versions too, which reject the `concurrency` option (added in
// 9.34.0), so `off` leaves the option out.
import path from 'node:path';
import { ESLint } from 'eslint';

const [concurrency = 'off'] = process.argv.slice(2);
const cwd = process.cwd();
const eslint = new ESLint({
  cwd,
  ...(concurrency === 'off' ? {} : { concurrency: Number(concurrency) }),
});
const results = await eslint.lintFiles(['.']);

const files = {};
for (const result of results.sort((a, b) => a.filePath.localeCompare(b.filePath))) {
  const file = path.relative(cwd, result.filePath).split(path.sep).join('/');
  files[file] = result.messages.map(({ line, column, ruleId, severity, message }) => ({
    line,
    column,
    ruleId,
    severity,
    message,
  }));
}
process.stdout.write(`${JSON.stringify(files, null, 2)}\n`);
