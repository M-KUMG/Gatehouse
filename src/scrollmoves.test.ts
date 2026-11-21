import { describe, expect, it } from 'vitest';
import { scrollMovesAnchor } from './scrollmoves';

// Tiny stand-ins for DOM nodes: only `contains` is used.
const node = (...inside: object[]) => ({ contains: (n: unknown) => inside.includes(n as object) });

describe('scrollMovesAnchor', () => {
  const button = {};

  it('is true for a scroll of something that contains the anchor (its window or the page)', () => {
    expect(scrollMovesAnchor(node(button) as unknown as Node, button as Node)).toBe(true);
  });

  it('is false for a scroll somewhere else, like the serial console output scrolling itself', () => {
    expect(scrollMovesAnchor(node({}) as unknown as Node, button as Node)).toBe(false);
  });

  it('is true when it cannot tell (no target, a target without contains, no anchor)', () => {
    expect(scrollMovesAnchor(null, button as Node)).toBe(true);
    expect(scrollMovesAnchor({} as EventTarget, button as Node)).toBe(true);
    expect(scrollMovesAnchor(node() as unknown as Node, null)).toBe(true);
  });
});
