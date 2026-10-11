// Lints the demo project with the built plugin (`npm run build` first), prints the results with
// project-relative paths and checks that they are exactly the two problems the demo shows: a
// `void`-ed insert and a subscription to a table that is not in the realtime publication.
// `npm run demo:check` runs it; `media/demo.tape` records it for the README.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const cwd = path.dirname(fileURLToPath(import.meta.url));
const eslint = new ESLint({ cwd });
const results = (await eslint.lintFiles(['src'])).map((result) => ({
  ...result,
  filePath: path.relative(cwd, result.filePath).split(path.sep).join('/'),
}));
process.stdout.write(format(results));

/** ESLint's stylish layout, with each message wrapped below its rule so a recording stays narrow. */
function format(lintResults) {
  const color = !process.env.NO_COLOR;
  const paint = (code, text) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
  const lines = [];
  for (const result of lintResults) {
    if (result.messages.length === 0) continue;
    lines.push('', paint('4', result.filePath));
    for (const { line, column, severity, ruleId, message } of result.messages) {
      const level = severity === 2 ? paint('31', 'error') : paint('33', 'warning');
      lines.push(`  ${paint('2', `${line}:${column}`)}  ${level}  ${paint('2', ruleId)}`);
      lines.push(...wrap(message, 76).map((text) => `    ${text}`));
    }
  }
  const count = lintResults.reduce((sum, result) => sum + result.messages.length, 0);
  lines.push('', paint('1', `${count} problem${count === 1 ? '' : 's'}`), '');
  return lines.join('\n');
}

function wrap(text, width) {
  const out = [''];
  for (const word of text.split(' ')) {
    const last = out[out.length - 1];
    if (last && last.length + word.length + 1 > width) out.push(word);
    else out[out.length - 1] = last ? `${last} ${word}` : word;
  }
  return out;
}

const expected = [
  {
    file: 'src/chat.ts',
    line: 4,
    ruleId: 'supabase/no-unsent-query',
    message: 'This Supabase query is lazy, so `void` discards it before it is sent',
  },
  {
    file: 'src/chat.ts',
    line: 8,
    ruleId: 'supabase/realtime-table-published',
    message: '`public.messages` is not in the `supabase_realtime` publication in your migrations',
  },
];
const actual = results.flatMap((result) =>
  result.messages.map((message) => ({ file: result.filePath, ...message })),
);
const problems = [];
if (actual.length !== expected.length) {
  problems.push(`expected ${expected.length} messages, got ${actual.length}`);
}
for (const want of expected) {
  const found = actual.some(
    (got) =>
      got.file === want.file &&
      got.line === want.line &&
      got.ruleId === want.ruleId &&
      got.severity === 2 &&
      got.message.startsWith(want.message),
  );
  if (!found) problems.push(`missing ${want.ruleId} at ${want.file}:${want.line}`);
}
if (problems.length > 0) {
  process.stderr.write(`demo check: FAIL\n${problems.map((p) => `  ${p}\n`).join('')}`);
  process.exitCode = 1;
} else {
  process.stdout.write(`demo check: OK (${expected.length} messages)\n`);
}
