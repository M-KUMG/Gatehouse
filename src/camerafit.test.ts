import { describe, expect, it } from 'vitest';
import type { Camera } from './camera';
import { FIT_MAX_ZOOM, cameraOf, expandRect, fitTarget, interpolateView, stepZoom, viewOf } from './camerafit';

const view = { width: 800, height: 600 };
const rect = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });

describe('stepZoom', () => {
  it('steps up and down through the levels', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(0.5, 1)).toBe(0.67);
    expect(stepZoom(2, -1)).toBe(1.5);
  });

  it('goes to the next level from a zoom between levels', () => {
    expect(stepZoom(1.1, 1)).toBe(1.25);
    expect(stepZoom(1.1, -1)).toBe(1);
    expect(stepZoom(0.9, 1)).toBe(1);
  });

  it('stays at the limits', () => {
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(0.25, -1)).toBe(0.25);
  });

  it('treats a zoom a hair off a level as that level', () => {
    expect(stepZoom(1.001, 1)).toBe(1.25);
    expect(stepZoom(0.999, -1)).toBe(0.75);
  });
});

describe('viewOf and cameraOf', () => {
  it('are each other\'s inverse', () => {
    const cam: Camera = { x: 120, y: -40, zoom: 1.5 };
    const back = cameraOf(viewOf(cam, view), view);
    expect(back.x).toBeCloseTo(cam.x);
    expect(back.y).toBeCloseTo(cam.y);
    expect(back.zoom).toBeCloseTo(cam.zoom);
  });
});

describe('fitTarget', () => {
  it('shows the whole rectangle, centred, with room around it', () => {
    const t = fitTarget(rect(0, 0, 1000, 500), view, 50);
    expect(t).not.toBeNull();
    if (!t) return;
    // Width is the limit: (800 - 100) / 1000 = 0.7
    expect(t.zoom).toBeCloseTo(0.7);
    expect(t.cx).toBeCloseTo(500);
    expect(t.cy).toBeCloseTo(250);
    const cam = cameraOf(t, view);
    expect((0 - cam.x) * cam.zoom).toBeGreaterThanOrEqual(50 - 0.001);
    expect((1000 - cam.x) * cam.zoom).toBeLessThanOrEqual(750 + 0.001);
  });

  it('does not blow a small part up past the fit limit', () => {
    const t = fitTarget(rect(100, 100, 40, 40), view);
    expect(t?.zoom).toBe(FIT_MAX_ZOOM);
  });

  it('does not zoom out past the camera minimum', () => {
    expect(fitTarget(rect(0, 0, 100000, 100000), view)?.zoom).toBe(0.25);
  });

  it('gives null for an empty rectangle or a canvas with no size', () => {
    expect(fitTarget(rect(5, 5, 0, 0), view)).toBeNull();
    expect(fitTarget(rect(0, 0, 100, 100), { width: 0, height: 0 })).toBeNull();
  });
});

describe('expandRect', () => {
  it('grows to contain points and never shrinks', () => {
    const r = expandRect(rect(10, 10, 20, 20), [{ x: 0, y: 15 }, { x: 25, y: 60 }, { x: 15, y: 15 }]);
    expect(r).toEqual({ left: 0, top: 10, right: 30, bottom: 60 });
  });

  it('leaves the rectangle alone without points', () => {
    expect(expandRect(rect(1, 2, 3, 4), [])).toEqual(rect(1, 2, 3, 4));
  });
});

describe('interpolateView', () => {
  const a = { cx: 0, cy: 0, zoom: 1 };
  const b = { cx: 100, cy: -50, zoom: 4 };

  it('starts and ends exactly at the two views', () => {
    expect(interpolateView(a, b, 0)).toEqual(a);
    const end = interpolateView(a, b, 1);
    expect(end.cx).toBeCloseTo(100);
    expect(end.cy).toBeCloseTo(-50);
    expect(end.zoom).toBeCloseTo(4);
  });

  it('zooms by an even factor: halfway in time is the geometric middle', () => {
    expect(interpolateView(a, b, 0.5).zoom).toBeCloseTo(2);
  });
});
