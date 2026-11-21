// Tests for electron/closeflow.cjs (closing a window with unsaved changes) with fake timers.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { CHANNEL, createCloseFlow } = require('./closeflow.cjs');

let calls;
let flow;
beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  flow = createCloseFlow({
    send: () => calls.push('send'),
    fallback: () => calls.push('fallback'),
    forceClose: () => calls.push('close'),
    waitMs: 1000,
  });
});
afterEach(() => vi.useRealTimers());

describe('close flow', () => {
  it('asks the page, and closes only when the page answers close', () => {
    flow.request();
    expect(calls).toEqual(['send']);
    flow.ack();
    vi.advanceTimersByTime(5000);
    expect(calls).toEqual(['send']); // an acknowledged page may take as long as it likes
    flow.answer('close');
    expect(calls).toEqual(['send', 'close']);
    expect(flow.state).toBe('idle');
  });

  it('keeps the window when the page answers stay (or anything else)', () => {
    flow.request();
    flow.ack();
    flow.answer('stay');
    expect(calls).toEqual(['send']);
    flow.request();
    flow.ack();
    flow.answer('whatever');
    expect(calls).toEqual(['send', 'send']);
  });

  it('falls back to the system dialog when the page never acknowledges', () => {
    flow.request();
    vi.advanceTimersByTime(999);
    expect(calls).toEqual(['send']);
    vi.advanceTimersByTime(2);
    expect(calls).toEqual(['send', 'fallback']);
    expect(flow.state).toBe('idle');
  });

  it('a second close request while one is open does nothing, and stray messages are ignored', () => {
    flow.answer('close'); // nothing asked yet
    flow.ack();
    expect(calls).toEqual([]);
    flow.request();
    flow.request();
    expect(calls).toEqual(['send']);
    flow.ack();
    flow.request();
    expect(calls).toEqual(['send']);
  });

  it('can ask again after an answer', () => {
    flow.request();
    flow.ack();
    flow.answer('stay');
    flow.request();
    expect(calls).toEqual(['send', 'send']);
  });

  it('uses the channel names the preload has written out', () => {
    const preload = fs.readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');
    for (const name of Object.values(CHANNEL)) expect(preload).toContain(`'${name}'`);
  });
});
