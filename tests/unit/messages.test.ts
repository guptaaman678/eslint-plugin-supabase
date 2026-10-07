import { describe, expect, it } from 'vitest';
import plugin from '../../src/index.js';

const EM_DASH = String.fromCharCode(0x2014);

// G7 and spec Phase 4 step 5: no em dash in any rule message or description.
describe.each(Object.entries(plugin.rules))('rule %s', (_, rule) => {
  const messages = Object.entries(rule.meta?.messages ?? {});

  it('has messages', () => {
    expect(messages.length).toBeGreaterThan(0);
  });

  it.each(messages)('message %s has no em dash', (_, message) => {
    expect(message).not.toContain(EM_DASH);
  });

  it('has a description without an em dash', () => {
    expect(rule.meta?.docs?.description).toBeTruthy();
    expect(rule.meta?.docs?.description).not.toContain(EM_DASH);
  });
});
