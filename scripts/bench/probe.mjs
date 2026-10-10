// A benchmark-only ESLint plugin. Its rule reports nothing: it records, per thread, the order
// in which files are linted, and at exit writes that order and the thread's heap after a full
// garbage collection to `$BENCH_PROBE_DIR/<threadId>.json`. Run with `--expose-gc`.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { threadId } from 'node:worker_threads';

const files = [];
let hooked = false;

function write() {
  const dir = process.env.BENCH_PROBE_DIR;
  if (dir === undefined || dir === '') return;
  globalThis.gc?.();
  const heapUsed = process.memoryUsage().heapUsed;
  writeFileSync(path.join(dir, `${threadId}.json`), JSON.stringify({ threadId, files, heapUsed }));
}

export default {
  meta: { name: 'bench-probe' },
  rules: {
    order: {
      meta: { type: 'problem', schema: [] },
      create(context) {
        files.push(context.filename);
        if (!hooked) {
          hooked = true;
          process.once('exit', write);
        }
        return {};
      },
    },
  },
};
