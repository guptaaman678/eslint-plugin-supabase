# Require a status callback on Supabase Realtime `subscribe()` calls

📝 Require a status callback on Supabase Realtime `subscribe()` calls.

⚠️ This rule _warns_ in the ✅ `recommended` config.

💭 This rule requires [type information](https://typescript-eslint.io/linting/typed-linting).

<!-- end auto-generated rule header -->

`channel.subscribe()` joins a Realtime channel in the background. Whether the join worked is
reported only to the callback you pass it: `SUBSCRIBED` when the channel joined, `CHANNEL_ERROR`
when the server refused it, `TIMED_OUT` when no reply came, and `CLOSED` when the channel shut.
Without a callback, or with one that takes no arguments, a channel that never joins looks exactly
like a quiet one: no error is thrown and no promise rejects, the events simply never arrive.

## Rule details

This rule reports a `subscribe()` call on a Supabase `RealtimeChannel` when:

- it has no callback (`channel.subscribe()`, or only a timeout);
- its callback declares no parameters (`channel.subscribe(() => setReady(true))`), so it runs
  for every status alike and cannot tell `SUBSCRIBED` from `CHANNEL_ERROR`.

The rule reads types, so it finds the channel when it is held in a variable or returned by a
helper, and it ignores other objects with a `subscribe()` method. A callback passed by name is
checked through its type. A callback whose type the rule cannot tell (`any`, a spread) is not
reported.

Examples of **incorrect** code for this rule:

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://example.supabase.co', 'sb_publishable_example');

// No callback: CHANNEL_ERROR and TIMED_OUT go unnoticed.
supabase
  .channel('todos')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, (payload) => {
    console.log(payload);
  })
  .subscribe();

// The callback declares no parameters, so it cannot see the status.
const room = supabase.channel('room');
room.subscribe(() => console.log('connected'));
```

Examples of **correct** code for this rule:

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://example.supabase.co', 'sb_publishable_example');

supabase
  .channel('todos')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, (payload) => {
    console.log(payload);
  })
  .subscribe((status, err) => {
    if (status === 'SUBSCRIBED') return;
    console.error(`Realtime channel todos: ${status}`, err);
  });
```

### What a status callback cannot see

Two common Realtime failures still reach `SUBSCRIBED`, so a status callback alone does not catch
them:

- a table that is not in the `supabase_realtime` publication (the `realtime-table-published`
  rule checks this against your migrations);
- a `filter` that the server rejects.

In both cases the server sends its error to the channel's `system` events, which supabase-js does
not pass to the `subscribe()` callback. To see them, listen for them with
`.on('system', {}, (payload) => { ... })`, or, with supabase-js 2.117 or later and a recent
Realtime server, create the channel with
`supabase.channel(name, { config: { postgres_changes_options: { wait: true } } })`. Then
`SUBSCRIBED` waits until the server has set up the `postgres_changes` subscription, and a failure
reaches the callback as `CHANNEL_ERROR`.

## Options

<!-- begin auto-generated rule options list -->

| Name            | Description                                                                                                                     | Type     | Default |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------------ | :------- | :------ |
| `allowWrappers` | Names of project helpers that already check the subscription status. `.subscribe()` calls inside their bodies are not reported. | String[] | `[]`    |

<!-- end auto-generated rule options list -->

### `allowWrappers`

Names of project helpers that already check the subscription status. A `subscribe()` call
inside the body of a function with one of these names (a function declaration, a function
assigned to a variable or a property, or an object or class method) is not reported. Calls to
the helpers are fine as they are, since the helper is not a `RealtimeChannel`.

```js
// eslint.config.js
export default [
  {
    rules: {
      'supabase/subscribe-status-handler': ['warn', { allowWrappers: ['subscribeWithWatchdog'] }],
    },
  },
];
```

Examples of **correct** code with `{ "allowWrappers": ["subscribeWithWatchdog"] }`:

```ts
import type { RealtimeChannel } from '@supabase/supabase-js';

// The helper checks the channel's state itself, so its bare `subscribe()` is not reported.
export function subscribeWithWatchdog(channel: RealtimeChannel, onError: (state: string) => void) {
  channel.subscribe();
  setTimeout(() => {
    if (channel.state !== 'joined') onError(channel.state);
  }, 10_000);
  return channel;
}
```

## When not to use it

Keep it on wherever your app relies on Realtime events. A channel that only sends broadcast
messages and never listens may not need a status callback; disable the rule for that line with an
`eslint-disable-next-line` comment, or list your own helper in `allowWrappers`.
