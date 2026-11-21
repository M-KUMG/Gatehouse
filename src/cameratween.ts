// A smooth zoom-and-move of the camera (the zoom buttons, "fit everything",
// reset to 100%). Like camerapan.ts it runs on animation frames only while a
// move is in progress, so an idle grid costs nothing, and anything else that
// moves the camera meanwhile (a press, the wheel, loading a project) ends it on
// the next frame; cancel() ends it at once. With reduced motion it jumps.
// The in-between views come from camerafit.ts.

import type { Camera } from './camera';
import { browserClock, prefersReducedMotion, type PanClock } from './camerapan';
import { cameraOf, interpolateView, viewOf, type CenterZoom } from './camerafit';
import type { ViewSize } from './camerareveal';

export const TWEEN_MS = 240;

export class CameraTween {
  private handle = 0;
  private from: CenterZoom = { cx: 0, cy: 0, zoom: 1 };
  private target: CenterZoom = { cx: 0, cy: 0, zoom: 1 };
  private start = 0;
  private duration = TWEEN_MS;
  /** What this tween last set, to notice someone else moving the camera. */
  private last: Camera = { x: 0, y: 0, zoom: 1 };

  constructor(
    private readonly camera: Camera,
    /** Size of the canvas in CSS pixels. */
    private readonly size: () => ViewSize,
    /** Called after each camera change (redraw, follow overlays). */
    private readonly moved: () => void,
    private readonly clock: PanClock = browserClock,
    private readonly instant: () => boolean = prefersReducedMotion,
  ) {}

  get active(): boolean {
    return this.handle !== 0;
  }

  /** Go to `target` smoothly. Nothing happens while the canvas has no size. */
  to(target: CenterZoom, duration = TWEEN_MS): void {
    const view = this.size();
    if (!(view.width > 0 && view.height > 0)) return;
    this.cancel();
    if (duration <= 0 || this.instant()) {
      this.apply(target, view);
      this.moved();
      return;
    }
    this.from = viewOf(this.camera, view);
    this.target = target;
    this.duration = duration;
    this.start = this.clock.now();
    this.last = { ...this.camera };
    this.handle = this.clock.request(this.step);
  }

  /** Stop where the camera is now. */
  cancel(): void {
    if (this.handle !== 0) this.clock.cancel(this.handle);
    this.handle = 0;
  }

  private apply(state: CenterZoom, view: ViewSize): void {
    const next = cameraOf(state, view);
    this.camera.x = next.x;
    this.camera.y = next.y;
    this.camera.zoom = next.zoom;
    this.last = { ...next };
  }

  private step = (now: number): void => {
    this.handle = 0;
    const cam = this.camera;
    if (cam.x !== this.last.x || cam.y !== this.last.y || cam.zoom !== this.last.zoom) return; // moved by someone else: let go
    const view = this.size();
    if (!(view.width > 0 && view.height > 0)) return;
    const t = Math.min(1, (now - this.start) / this.duration);
    this.apply(t >= 1 ? this.target : interpolateView(this.from, this.target, t), view);
    if (t < 1) this.handle = this.clock.request(this.step);
    this.moved();
  };
}
