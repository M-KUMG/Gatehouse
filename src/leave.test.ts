import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAVE_MS, leave, type Leavable } from './leave';

function fake(connected = true): Leavable & { classes: string[]; removed: number } {
  const el = {
    isConnected: connected,
    inert: false,
    classes: [] as string[],
    removed: 0,
    classList: { add: (n: string) => el.classes.push(n) },
    remove: () => {
      el.removed++;
      el.isConnected = false;
    },
  };
  return el;
}

describe('leave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('marks the element as leaving, makes it inert and removes it after the exit animation', () => {
    const el = fake();
    leave(el, false);
    expect(el.classes).toEqual(['gh-leaving']);
    expect(el.inert).toBe(true);
    expect(el.removed).toBe(0);
    vi.advanceTimersByTime(LEAVE_MS + 1);
    expect(el.removed).toBe(1);
  });

  it('removes it at once for reduced motion, and ignores an element that is already gone', () => {
    const el = fake();
    leave(el, true);
    expect(el.removed).toBe(1);
    expect(el.classes).toEqual([]);
    const gone = fake(false);
    leave(gone, false);
    vi.advanceTimersByTime(LEAVE_MS * 2);
    expect(gone.removed).toBe(0);
  });
});
