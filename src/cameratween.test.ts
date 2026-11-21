import { describe, expect, it } from 'vitest';
import type { Camera } from './camera';
import { CameraTween, TWEEN_MS } from './cameratween';
import type { PanClock } from './camerapan';

/** A clock the test drives by hand. */
function fakeClock() {
  let time = 0;
  let next = 1;
  const pending = new Map<number, (now: number) => void>();
  const clock: PanClock = {
    request: (cb) => {
      pending.set(next, cb);
      return next++;
    },
    cancel: (h) => void pending.delete(h),
    now: () => time,
  };
  return {
    clock,
    advance(ms: number): void {
      time += ms;
      const callbacks = [...pending.values()];
      pending.clear();
      for (const cb of callbacks) cb(time);
    },
    get pending(): number {
      return pending.size;
    },
  };
}

const size = { width: 800, height: 600 };

function setup(instant = false) {
  const cam: Camera = { x: 0, y: 0, zoom: 1 };
  const fake = fakeClock();
  let moves = 0;
  const tween = new CameraTween(cam, () => size, () => void moves++, fake.clock, () => instant);
  return { cam, fake, tween, moves: () => moves };
}

describe('CameraTween', () => {
  it('ends exactly on the target after the duration', () => {
    const { cam, fake, tween } = setup();
    tween.to({ cx: 1000, cy: 500, zoom: 2 });
    fake.advance(TWEEN_MS + 1);
    expect(cam.zoom).toBeCloseTo(2);
    expect(cam.x + size.width / 2 / cam.zoom).toBeCloseTo(1000);
    expect(cam.y + size.height / 2 / cam.zoom).toBeCloseTo(500);
    expect(tween.active).toBe(false);
  });

  it('is part way in the middle of the duration and keeps asking for frames', () => {
    const { cam, fake, tween } = setup();
    tween.to({ cx: 400, cy: 300, zoom: 4 });
    fake.advance(TWEEN_MS / 2);
    expect(cam.zoom).toBeGreaterThan(1);
    expect(cam.zoom).toBeLessThan(4);
    expect(tween.active).toBe(true);
    expect(fake.pending).toBe(1);
  });

  it('jumps at once with reduced motion', () => {
    const { cam, tween, moves } = setup(true);
    tween.to({ cx: 400, cy: 300, zoom: 2 });
    expect(cam.zoom).toBe(2);
    expect(tween.active).toBe(false);
    expect(moves()).toBe(1);
  });

  it('lets go when something else moves the camera', () => {
    const { cam, fake, tween } = setup();
    tween.to({ cx: 400, cy: 300, zoom: 4 });
    fake.advance(60);
    cam.zoom = 1.234; // e.g. the mouse wheel
    fake.advance(60);
    expect(cam.zoom).toBe(1.234);
    expect(tween.active).toBe(false);
  });

  it('stops where it is on cancel', () => {
    const { cam, fake, tween } = setup();
    tween.to({ cx: 400, cy: 300, zoom: 4 });
    fake.advance(60);
    const here = cam.zoom;
    tween.cancel();
    fake.advance(500);
    expect(cam.zoom).toBe(here);
  });

  it('does nothing while the canvas has no size', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 1 };
    const fake = fakeClock();
    const tween = new CameraTween(cam, () => ({ width: 0, height: 0 }), () => undefined, fake.clock, () => false);
    tween.to({ cx: 10, cy: 10, zoom: 2 });
    expect(tween.active).toBe(false);
    expect(cam.zoom).toBe(1);
  });
});
