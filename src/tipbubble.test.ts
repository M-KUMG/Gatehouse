import { describe, expect, it } from 'vitest';
import { placeBubble, preferredVerticalSide } from './tipbubble';

const viewport = { width: 1000, height: 600 };
const bubble = { width: 120, height: 28 };
const anchor = { left: 800, top: 200, width: 90, height: 60 };

describe('placeBubble', () => {
  it('goes left of the anchor, centred vertically, by default', () => {
    const p = placeBubble(anchor, bubble, viewport);
    expect(p).toEqual({ x: 800 - 10 - 120, y: 200 + 30 - 14, side: 'left' });
  });

  it('flips to the right when there is no room on the left', () => {
    const p = placeBubble({ left: 40, top: 200, width: 90, height: 60 }, bubble, viewport);
    expect(p.side).toBe('right');
    expect(p.x).toBe(40 + 90 + 10);
  });

  it('stays on the preferred side when neither side fits, clamped inside the viewport', () => {
    const p = placeBubble({ left: 20, top: 200, width: 90, height: 60 }, bubble, { width: 200, height: 600 });
    expect(p.x).toBeGreaterThanOrEqual(6);
    expect(p.x + bubble.width).toBeLessThanOrEqual(200 - 6);
  });

  it('keeps the bubble inside the viewport vertically', () => {
    expect(placeBubble({ ...anchor, top: 0, height: 10 }, bubble, viewport).y).toBe(6);
    expect(placeBubble({ ...anchor, top: 590, height: 10 }, bubble, viewport).y).toBe(600 - 6 - 28);
  });

  it('honours a preference for the right side', () => {
    const p = placeBubble({ left: 100, top: 200, width: 90, height: 60 }, bubble, viewport, 'right');
    expect(p.side).toBe('right');
    expect(p.x).toBe(100 + 90 + 10);
  });
});

describe('placeBubble above and below', () => {
  const button = { left: 300, top: 100, width: 30, height: 30 };

  it('goes below the anchor, centred horizontally', () => {
    const p = placeBubble(button, bubble, viewport, 'below', 8);
    expect(p).toEqual({ x: 300 + 15 - 60, y: 100 + 30 + 8, side: 'below' });
  });

  it('goes above the anchor when asked', () => {
    const p = placeBubble({ ...button, top: 300 }, bubble, viewport, 'above', 8);
    expect(p).toEqual({ x: 255, y: 300 - 8 - 28, side: 'above' });
  });

  it('flips to the other side when there is no room', () => {
    expect(placeBubble({ ...button, top: 10 }, bubble, viewport, 'above').side).toBe('below');
    expect(placeBubble({ ...button, top: 570 }, bubble, viewport, 'below').side).toBe('above');
  });

  it('is kept inside the viewport horizontally', () => {
    expect(placeBubble({ ...button, left: 0 }, bubble, viewport, 'below').x).toBe(6);
    expect(placeBubble({ ...button, left: 990 }, bubble, viewport, 'below').x).toBe(1000 - 6 - 120);
  });
});

describe('preferredVerticalSide', () => {
  it('prefers below, but above for controls in the lower third', () => {
    expect(preferredVerticalSide({ left: 0, top: 20, width: 30, height: 30 }, viewport)).toBe('below');
    expect(preferredVerticalSide({ left: 0, top: 500, width: 30, height: 30 }, viewport)).toBe('above');
  });
});
