import { describe, expect, it } from 'vitest';
import type { Camera } from './camera';
import { CameraPan, type PanClock } from './camerapan';

/** Frames run only when the test says so. */
function manualClock(): PanClock & { time: number; frame(at: number): void; pending(): boolean } {
  let next = 1;
  let callback: ((now: number) => void) | null = null;
  let handle = 0;
  return {
    time: 0,
    request(cb) {
      callback = cb;
      handle = next++;
      return handle;
    },
    cancel(h) {
      if (h === handle) callback = null;
    },
    now() {
      return this.time;
    },
    frame(at) {
      this.time = at;
      const cb = callback;
      callback = null;
      cb?.(at);
    },
    pending() {
      return callback !== null;
    },
  };
}

function setup(instant = false) {
  const camera: Camera = { x: 0, y: 0, zoom: 1 };
  const clock = manualClock();
  let moves = 0;
  const pan = new CameraPan(camera, () => moves++, clock, () => instant);
  return { camera, clock, pan, moves: () => moves };
}

describe('CameraPan', () => {
  it('moves the camera in steps and ends exactly on the target, then stops asking for frames', () => {
    const { camera, clock, pan, moves } = setup();
    pan.panTo(100, 50, 200);
    expect(pan.active).toBe(true);
    clock.frame(100);
    expect(camera.x).toBeGreaterThan(0);
    expect(camera.x).toBeLessThan(100);
    expect(camera.x / 100).toBeCloseTo(camera.y / 50);
    expect(clock.pending()).toBe(true);
    clock.frame(250);
    expect(camera).toEqual({ x: 100, y: 50, zoom: 1 });
    expect(clock.pending()).toBe(false);
    expect(pan.active).toBe(false);
    expect(moves()).toBe(2);
  });

  it('never changes the zoom', () => {
    const { camera, clock, pan } = setup();
    camera.zoom = 2;
    pan.panTo(100, 100, 100);
    clock.frame(50);
    clock.frame(200);
    expect(camera.zoom).toBe(2);
    expect(camera.x).toBe(100);
  });

  it('jumps at once when instant (reduced motion) or the duration is 0', () => {
    const a = setup(true);
    a.pan.panTo(10, 20);
    expect(a.camera).toEqual({ x: 10, y: 20, zoom: 1 });
    expect(a.clock.pending()).toBe(false);
    expect(a.moves()).toBe(1);
    const b = setup();
    b.pan.panTo(5, 6, 0);
    expect(b.camera).toEqual({ x: 5, y: 6, zoom: 1 });
    expect(b.clock.pending()).toBe(false);
  });

  it('cancel() stops where it is', () => {
    const { camera, clock, pan } = setup();
    pan.panTo(100, 0, 200);
    clock.frame(100);
    const x = camera.x;
    pan.cancel();
    expect(pan.active).toBe(false);
    expect(clock.pending()).toBe(false);
    clock.frame(300);
    expect(camera.x).toBe(x);
  });

  it('lets go when something else moves or zooms the camera', () => {
    const a = setup();
    a.pan.panTo(100, 0, 200);
    a.clock.frame(50);
    a.camera.x = 500; // e.g. a middle-mouse pan
    a.clock.frame(100);
    expect(a.camera.x).toBe(500);
    expect(a.pan.active).toBe(false);
    expect(a.clock.pending()).toBe(false);

    const b = setup();
    b.pan.panTo(100, 0, 200);
    b.clock.frame(50);
    const x = b.camera.x;
    b.camera.zoom = 2; // wheel zoom
    b.clock.frame(100);
    expect(b.camera.x).toBe(x);
    expect(b.pan.active).toBe(false);
  });

  it('leaves a pan to the same target alone and restarts for a new one', () => {
    const { camera, clock, pan } = setup();
    pan.panTo(100, 0, 200);
    clock.frame(100);
    const x = camera.x;
    pan.panTo(100, 0, 200); // same target: no restart
    clock.frame(150);
    expect(camera.x).toBeGreaterThan(x);
    pan.panTo(-100, 0, 200); // new target: from here
    clock.frame(400);
    expect(camera.x).toBe(-100);
  });
});
