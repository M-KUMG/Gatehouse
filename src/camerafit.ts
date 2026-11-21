// Zoom buttons and "fit everything", as plain numbers (no DOM): the steps the
// plus and minus buttons go through, which view shows a rectangle with some
// breathing room, and the in-between views of a smooth zoom. A "view" here is the
// world point in the middle of the canvas plus the zoom (camera.ts has the
// top-left based Camera); cameratween.ts runs the animation.

import { MAX_ZOOM, MIN_ZOOM, clampZoom, type Camera } from './camera';
import { centeredCamera, easeInOut, type ViewSize, type WorldRect } from './camerareveal';

/** The levels the plus and minus buttons step through (the first and last are the camera's limits). */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** Screen pixels of free space "fit" leaves around everything. */
export const FIT_PADDING = 64;
/** Fit never zooms in past this, so a single small part is not blown up to fill the grid. */
export const FIT_MAX_ZOOM = 2;

/** The center of the canvas in world units, and the zoom. */
export interface CenterZoom {
  cx: number;
  cy: number;
  zoom: number;
}

/** The next level above (direction 1) or below (-1) `zoom`; at the ends it stays at the limit. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const eps = 0.005;
  if (direction > 0) return ZOOM_STEPS.find((s) => s > zoom + eps) ?? MAX_ZOOM;
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    const level = ZOOM_STEPS[i];
    if (level !== undefined && level < zoom - eps) return level;
  }
  return MIN_ZOOM;
}

export function viewOf(cam: Camera, view: ViewSize): CenterZoom {
  return { cx: cam.x + view.width / 2 / cam.zoom, cy: cam.y + view.height / 2 / cam.zoom, zoom: cam.zoom };
}

/** The camera (top-left based) that shows `state` in a canvas of size `view`. */
export function cameraOf(state: CenterZoom, view: ViewSize): Camera {
  return { x: state.cx - view.width / 2 / state.zoom, y: state.cy - view.height / 2 / state.zoom, zoom: state.zoom };
}

/**
 * The view that shows the whole rectangle with `padding` pixels around it,
 * centred, never zoomed past `maxZoom` and never outside the camera's limits.
 * Null when the rectangle or the canvas has no size.
 */
export function fitTarget(rect: WorldRect, view: ViewSize, padding = FIT_PADDING, maxZoom = FIT_MAX_ZOOM): CenterZoom | null {
  const w = rect.right - rect.left;
  const h = rect.bottom - rect.top;
  if (!(w > 0 && h > 0 && view.width > 0 && view.height > 0)) return null;
  const availW = Math.max(1, view.width - 2 * padding);
  const availH = Math.max(1, view.height - 2 * padding);
  const zoom = clampZoom(Math.min(availW / w, availH / h, maxZoom));
  const centre = centeredCamera(rect, view, zoom);
  return { cx: centre.x + view.width / 2 / zoom, cy: centre.y + view.height / 2 / zoom, zoom };
}

/** The rectangle grown to also contain `points` (world units). */
export function expandRect(rect: WorldRect, points: readonly { x: number; y: number }[]): WorldRect {
  const out = { ...rect };
  for (const p of points) {
    out.left = Math.min(out.left, p.x);
    out.top = Math.min(out.top, p.y);
    out.right = Math.max(out.right, p.x);
    out.bottom = Math.max(out.bottom, p.y);
  }
  return out;
}

/** The view at progress `t` (0..1) between two views: eased, the zoom changes by a constant factor per step so it feels even. */
export function interpolateView(from: CenterZoom, to: CenterZoom, t: number): CenterZoom {
  const e = easeInOut(t);
  return {
    cx: from.cx + (to.cx - from.cx) * e,
    cy: from.cy + (to.cy - from.cy) * e,
    zoom: from.zoom * Math.pow(to.zoom / from.zoom, e),
  };
}
