# How it works

## Performance

The schema rules (`realtime-table-published`, `rls-readable`, `table-granted`) replay your migrations once per ESLint thread, keep the result in memory, and reuse it for every file. At most every 250 ms they compare the migrations' listing, sizes and modification times, and replay again only when the contents changed. Under `--concurrency N`, every worker thread builds its own snapshot, so the costs below are per thread.

`npm run bench` measures this on generated projects: a 200-file TypeScript app linted with typescript-eslint's `recommendedTypeChecked`, with 100 and 500 migrations, with `--concurrency off` and `4`. Each figure is the median of 3 runs on an Apple M4 (10 cores, 16 GB), Node 22.16.0, macOS 26.5, on 2026-10-12.

| Measure                                                      | 100 migrations    | 500 migrations    | Budget                       |
| ------------------------------------------------------------ | ----------------- | ----------------- | ---------------------------- |
| First file that needs the schema (replay), slowest thread    | 86 ms             | 288 ms            | 300 ms (100), 1,000 ms (500) |
| Every other file, median / p95                               | 0.57 ms / 1.43 ms | 0.54 ms / 1.37 ms | 2 ms / 10 ms (100)           |
| Plugin rule time on `eslint .`, over typescript-eslint alone | 9.6%              | 24.7%             |                              |
| The same, without the first replay of each thread            | 4.5%              | 5.8%              | 10%                          |
| Heap held per thread, plugin loaded and schema cached        | 12 MB             | 12 MB             | 30 MB (500)                  |

On this generated app, typescript-eslint takes about 1.1 to 1.2 s per thread, so the one replay per thread is most of the plugin's share. The share budget therefore leaves out each thread's first replay, which has its own budget in the first row; with that replay included, the share is 24.7% at 500 migrations. Of the heap figure, the cached snapshot of 500 migrations is under 1 MB; the rest is the plugin and its SQL parser, loaded once per thread.
