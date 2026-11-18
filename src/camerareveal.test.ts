import { describe, expect, it } from 'vitest';
import type { Camera } from './camera';
import { cellBoxToWorld, centeredCamera, easeInOut, isFullyVisible, revealTarget, type ViewSize, type WorldRect } from './camerareveal';

const view: ViewSize = { width: 800, height: 600 };
const cam = (x = 0, y = 0, zoom = 1): Camera => ({ x, y, zoom });
const rect = (left: number, top: number, w: number, h: number): WorldRect => ({ left, top, right: left + w, bottom: top + h });

describe('cellBoxToWorld', () => {
  it('scales cells to world units', () => {
    expect(cellBoxToWorld({ col: 2, row: 3, cols: 4, rows: 5 }, 20)).toEqual({ left: 40, top: 60, right: 120, bottom: 160 });
  });
});

describe('isFullyVisible', () => {
  it('is true inside, also touching the edges without a margin', () => {
    expect(isFullyVisible(cam(), view, rect(100, 100, 200, 100))).toBe(true);
    expect(isFullyVisible(cam(), view, rect(0, 0, 800, 600))).toBe(true);
  });

  it('is false when partly outside on any side', () => {
    expect(isFullyVisible(cam(), view, rect(-1, 100, 100, 100))).toBe(false);
    expect(isFullyVisible(cam(), view, rect(100, -1, 100, 100))).toBe(false);
    expect(isFullyVisible(cam(), view, rect(701, 100, 100, 100))).toBe(false);
    expect(isFullyVisible(cam(), view, rect(100, 501, 100, 100))).toBe(false);
  });

  it('is false when fully outside', () => {
    expect(isFullyVisible(cam(), view, rect(2000, 2000, 100, 100))).toBe(false);
    expect(isFullyVisible(cam(), view, rect(-500, -500, 100, 100))).toBe(false);
  });

  it('keeps the margin to the edges in screen pixels, whatever the zoom', () => {
    expect(isFullyVisible(cam(), view, rect(5, 100, 100, 100), 8)).toBe(false);
    expect(isFullyVisible(cam(), view, rect(8, 100, 100, 100), 8)).toBe(true);
    // At zoom 2, 4 world units are 8 pixels.
    expect(isFullyVisible(cam(0, 0, 2), view, rect(3, 100, 50, 50), 8)).toBe(false);
    expect(isFullyVisible(cam(0, 0, 2), view, rect(4, 100, 50, 50), 8)).toBe(true);
  });

  it('follows the camera position and zoom', () => {
    const r = rect(1000, 1000, 100, 100);
    expect(isFullyVisible(cam(900, 900), view, r)).toBe(true);
    expect(isFullyVisible(cam(900, 900, 4), view, r)).toBe(false); // 400 px wide, but starts at 400 px: right edge at 800 is ok, bottom at 800 is not
    expect(isFullyVisible(cam(900, 900, 0.25), view, r)).toBe(true);
  });

  it('is false for a rectangle larger than the view, even when it covers it', () => {
    expect(isFullyVisible(cam(), view, rect(-100, -100, 1000, 800))).toBe(false);
  });
});

describe('centeredCamera', () => {
  it('puts the rectangle centre in the middle of the view', () => {
    const c = centeredCamera(rect(1000, 500, 200, 100), view, 1);
    expect(c).toEqual({ x: 1100 - 400, y: 550 - 300 });
  });

  it('accounts for the zoom', () => {
    const c = centeredCamera(rect(1000, 500, 200, 100), view, 2);
    expect(c).toEqual({ x: 1100 - 200, y: 550 - 150 });
    const z = centeredCamera(rect(1000, 500, 200, 100), view, 0.5);
    expect(z).toEqual({ x: 1100 - 800, y: 550 - 600 });
  });

  it('centres a rectangle larger than the view too', () => {
    const c = centeredCamera(rect(0, 0, 2000, 1500), { width: 400, height: 300 }, 1);
    expect(c).toEqual({ x: 1000 - 200, y: 750 - 150 });
  });
});

describe('revealTarget', () => {
  it('does not move for a rectangle fully inside', () => {
    expect(revealTarget(cam(), view, rect(100, 100, 200, 100))).toBeNull();
  });

  it('centres a rectangle fully outside, keeping the zoom', () => {
    const t = revealTarget(cam(0, 0, 2), view, rect(3000, 2000, 100, 60));
    expect(t).toEqual({ x: 3050 - 200, y: 2030 - 150 });
  });

  it('centres a rectangle that is cut off', () => {
    const t = revealTarget(cam(), view, rect(750, 100, 100, 100));
    expect(t).toEqual({ x: 800 - 400, y: 150 - 300 });
  });

  it('centres a rectangle that is inside but closer to the edge than the margin', () => {
    expect(revealTarget(cam(), view, rect(3, 100, 100, 100), 8)).not.toBeNull();
    expect(revealTarget(cam(), view, rect(3, 100, 100, 100), 0)).toBeNull();
  });

  it('centres a rectangle larger than the view, then stays put', () => {
    const small: ViewSize = { width: 300, height: 200 };
    const big = rect(0, 0, 800, 600);
    const t = revealTarget(cam(), small, big);
    expect(t).toEqual({ x: 400 - 150, y: 300 - 100 });
    expect(t && revealTarget(cam(t.x, t.y), small, big)).toBeNull();
  });

  it('works at the zoom limits', () => {
    for (const zoom of [0.25, 4]) {
      const r = rect(5000, 5000, 100, 60);
      const t = revealTarget(cam(0, 0, zoom), view, r);
      expect(t).not.toBeNull();
      if (t) expect(isFullyVisible(cam(t.x, t.y, zoom), view, r)).toBe(true);
    }
  });

  it('gives null for a view without size', () => {
    expect(revealTarget(cam(), { width: 0, height: 0 }, rect(5000, 5000, 100, 100))).toBeNull();
  });
});

describe('easeInOut', () => {
  it('runs from 0 to 1, monotonic, clamped', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 20; i++) {
      const v = easeInOut(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
