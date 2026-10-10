// Heap retained by one project's snapshot, the object the plugin's cache holds, measured in a
// fresh process: heap after a full collection with the snapshot alive, minus heap before it.
// Usage: node --expose-gc memory-run.mjs <projectDir> <out>
import { writeFileSync } from 'node:fs';
import { listReplayInputs, loadEngine, replayProjectSync } from 'supabase-grants-lint/engine';

const [projectDir, out] = process.argv.slice(2);
await loadEngine();
// A first replay warms the parser, so its lazily built state is not counted as the snapshot's.
listReplayInputs({ projectDir });
replayProjectSync({ projectDir });
globalThis.gc();
const before = process.memoryUsage().heapUsed;
const snapshot = replayProjectSync({ projectDir });
globalThis.gc();
const after = process.memoryUsage().heapUsed;
writeFileSync(
  out,
  JSON.stringify({
    retainedBytes: after - before,
    jsonBytes: JSON.stringify(snapshot).length,
    relations: snapshot.relations.length,
  }),
);
