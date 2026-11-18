// A short smooth pan of the camera (position only, the zoom is never touched).
// It runs on animation frames only while a pan is in progress, so the grid's
// own render loop stays idle when nothing moves. Anything else that moves the
// camera meanwhile (middle-mouse pan, wheel zoom, zoom reset, loading a
// project) ends the pan on the next frame, and cancel() ends it at once (the
// grid calls it on a press or wheel).

import { easeInOut } from './camerareveal';
import type { Camera, Point } from './camera';

export const PAN_MS = 200;

/** Where frames and time come from; replaced in tests. */
export interface PanClock {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
  now(): number;
}

const browserClock: PanClock = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
  now: () => performance.now(),
};

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class CameraPan {
  private handle = 0;
  private from: Point = { x: 0, y: 0 };
  private to: Point = { x: 0, y: 0 };
  private start = 0;
  private duration = PAN_MS;
  private zoom = 1;
  /** What this pan last set, to notice someone else moving the camera. */
  private last: Point = { x: 0, y: 0 };

  constructor(
    private readonly camera: Camera,
    /** Called after each camera change (redraw, follow overlays). */
    private readonly moved: () => void,
    private readonly clock: PanClock = browserClock,
    private readonly instant: () => boolean = prefersReducedMotion,
  ) {}

  get active(): boolean {
    return this.handle !== 0;
  }

  /** Move the camera to (x, y) smoothly. The same target while already on its way there is left alone. */
  panTo(x: number, y: number, duration = PAN_MS): void {
    if (this.active && this.to.x === x && this.to.y === y) return;
    this.cancel();
    const cam = this.camera;
    if (duration <= 0 || this.instant()) {
      cam.x = x;
      cam.y = y;
      this.moved();
      return;
    }
    this.from = { x: cam.x, y: cam.y };
    this.to = { x, y };
    this.last = { x: cam.x, y: cam.y };
    this.zoom = cam.zoom;
    this.duration = duration;
    this.start = this.clock.now();
    this.handle = this.clock.request(this.step);
  }

  /** Stop where the camera is now. */
  cancel(): void {
    if (this.handle !== 0) this.clock.cancel(this.handle);
    this.handle = 0;
  }

  private step = (now: number): void => {
    this.handle = 0;
    const cam = this.camera;
    if (cam.x !== this.last.x || cam.y !== this.last.y || cam.zoom !== this.zoom) return; // moved by someone else: let go
    const t = Math.min(1, (now - this.start) / this.duration);
    if (t >= 1) {
      cam.x = this.to.x;
      cam.y = this.to.y;
    } else {
      const e = easeInOut(t);
      cam.x = this.from.x + (this.to.x - this.from.x) * e;
      cam.y = this.from.y + (this.to.y - this.from.y) * e;
      this.handle = this.clock.request(this.step);
    }
    this.last = { x: cam.x, y: cam.y };
    this.moved();
  };
}
