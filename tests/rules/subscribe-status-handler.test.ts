import type { InvalidTestCase, ValidTestCase } from '@typescript-eslint/rule-tester';
import {
  subscribeStatusHandler,
  type MessageId,
  type Options,
} from '../../src/rules/subscribe-status-handler.js';
import { createRuleTester } from '../harness/rule-tester.js';

const HEADER = [
  "import { createClient, type RealtimeChannel } from '@supabase/supabase-js';",
  "const supabase = createClient('http://localhost:54321', 'sb_publishable_test');",
  "const channel: RealtimeChannel = supabase.channel('room');",
  '',
].join('\n');

const code = (body: string): string => HEADER + body;

const changes =
  "supabase.channel('todos').on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, (payload) => payload)";

/** A case with `count` reports (all `noStatusCallback`), optionally with `allowWrappers`. */
function invalid(
  body: string,
  allowWrappers?: string[],
  count = 1,
): InvalidTestCase<MessageId, [Options]> {
  return {
    code: code(body),
    ...(allowWrappers === undefined ? {} : { options: [{ allowWrappers }] }),
    errors: Array.from({ length: count }, () => ({ messageId: 'noStatusCallback' as const })),
  };
}

function wrapped(body: string, allowWrappers: string[]): ValidTestCase<[Options]> {
  return { code: code(body), options: [{ allowWrappers }] };
}

createRuleTester().run('subscribe-status-handler', subscribeStatusHandler, {
  valid: [
    // A callback that declares a parameter sees the status.
    code(
      'channel.subscribe((status) => {\n  if (status !== "SUBSCRIBED") console.error(status);\n});',
    ),
    code('channel.subscribe((status, err) => {\n  if (err) console.error(status, err);\n});'),
    code(`${changes}.subscribe((status) => console.log(status));`),
    code(
      'function onStatus(status: string) {\n  console.log(status);\n}\nchannel.subscribe(onStatus);',
    ),
    code('channel.subscribe((...args) => console.log(args));'),
    code('channel.subscribe(function (status) {\n  console.log(status);\n}, 10000);'),
    // Overloads: one of them declares a parameter.
    code(
      'function overloaded(): void;\nfunction overloaded(status: string): void;\nfunction overloaded(status?: string) {\n  console.log(status);\n}\nchannel.subscribe(overloaded);',
    ),
    // A helper forwarding an optional callback that declares a parameter.
    code(
      'export function join(onStatus?: (status: string) => void) {\n  return channel.subscribe(onStatus);\n}',
    ),
    // Types that cannot be told: `any`, a spread.
    code('declare const anything: any;\nchannel.subscribe(anything);'),
    code(
      "declare const args: Parameters<RealtimeChannel['subscribe']>;\nchannel.subscribe(...args);",
    ),
    // Not a Supabase channel, or not `subscribe`.
    'const store = { subscribe() {} };\nstore.subscribe();',
    'class RealtimeChannel {\n  subscribe() {}\n}\nnew RealtimeChannel().subscribe();',
    'declare function subscribe(): void;\nsubscribe();',
    code('void channel.unsubscribe();'),
    'const handlers = [() => 1];\nhandlers[0]();',
    // `allowWrappers`: calls inside the named helpers' bodies, at any depth.
    wrapped('export function listenSafely(ch: RealtimeChannel) {\n  return ch.subscribe();\n}', [
      'listenSafely',
    ]),
    wrapped(
      'export const joinChannel = (ch: RealtimeChannel) =>\n  new Promise((resolve) => {\n    resolve(ch.subscribe());\n  });',
      ['joinChannel'],
    ),
    wrapped(
      'export const helpers = {\n  join(ch: RealtimeChannel) {\n    return ch.subscribe();\n  },\n};',
      ['join'],
    ),
    wrapped(
      "export const helpers = {\n  'join-room': (ch: RealtimeChannel) => ch.subscribe(),\n};",
      ['join-room'],
    ),
    wrapped(
      'export class Rooms {\n  join(ch: RealtimeChannel) {\n    return ch.subscribe();\n  }\n  leave = (ch: RealtimeChannel) => ch.subscribe(() => undefined);\n}',
      ['join', 'leave'],
    ),
    wrapped(
      'export const helpers: Record<string, unknown> = {};\nhelpers.join = function (ch: RealtimeChannel) {\n  return ch.subscribe();\n};\nlet joinAll;\njoinAll = () => channel.subscribe();\nexport { joinAll };',
      ['join', 'joinAll'],
    ),
    wrapped('export const join = function joinRoom() {\n  return channel.subscribe();\n};', [
      'joinRoom',
    ]),
  ],
  invalid: [
    // No callback.
    invalid("supabase.channel('room').subscribe();"),
    invalid('channel.subscribe();'),
    invalid(`${changes}.subscribe();`),
    invalid('channel?.subscribe();'),
    invalid('channel.subscribe(undefined, 10000);'),
    invalid('// @ts-expect-error: null is not a callback\nchannel.subscribe(null);'),
    // A callback that declares no parameters cannot see the status.
    invalid("channel.subscribe(() => console.log('joined'));"),
    invalid("channel.subscribe(function () {\n  console.log('joined');\n});"),
    invalid("function onJoined() {\n  console.log('joined');\n}\nchannel.subscribe(onJoined);"),
    invalid(
      "function onJoined(this: void) {\n  console.log('joined');\n}\nchannel.subscribe(onJoined);",
    ),
    invalid(
      'export function join(onJoined?: () => void) {\n  return channel.subscribe(onJoined);\n}',
    ),
    // In a `forEach` body and inside an async function.
    invalid(
      "const rooms = ['a', 'b'];\nrooms.forEach((room) => {\n  supabase.channel(room).subscribe();\n});",
    ),
    invalid(
      'export async function join() {\n  await Promise.resolve();\n  channel.subscribe();\n}',
    ),
    // `allowWrappers` names other helpers, or the call is outside the helper.
    invalid('export function join() {\n  return channel.subscribe();\n}', ['listenSafely']),
    invalid(
      'export function listenSafely(ch: RealtimeChannel) {\n  return ch.subscribe((status) => status);\n}\nchannel.subscribe();',
      ['listenSafely'],
    ),
    invalid(
      "const key = 'join';\nexport const helpers = {\n  [key]: () => channel.subscribe(),\n  1: () => channel.subscribe(),\n};",
      ['join', '1'],
      2,
    ),
    invalid(
      'export class Rooms {\n  #join() {\n    return channel.subscribe();\n  }\n  #leave = () => channel.subscribe();\n  run() {\n    this.#join();\n    this.#leave();\n  }\n}',
      ['#join', 'join', '#leave', 'leave'],
      2,
    ),
    invalid(
      "const helpers: Record<string, () => void> = {};\nconst key = 'join';\nhelpers[key] = () => {\n  channel.subscribe();\n};",
      ['join'],
    ),
    invalid(
      'export default function () {\n  return channel.subscribe();\n}\n[() => channel.subscribe()].forEach((f) => f());',
      ['default'],
      2,
    ),
    // supabase-js 2.58.0's channel.
    {
      code: "import { createClient } from 'supabase-js-2-58';\nconst old = createClient('http://localhost:54321', 'sb_publishable_test');\nold.channel('room').subscribe();",
      errors: [{ messageId: 'noStatusCallback', line: 3 }],
    },
  ],
});
