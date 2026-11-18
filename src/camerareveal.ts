// Bringing a part into view, as plain numbers (no DOM): is a rectangle fully
// inside the visible area of the grid, and which camera position centres it at
// the current zoom. Used when a board is picked in the File explorer; the
// smooth movement itself is camerapan.ts. Rectangles are in world units
// (see camera.ts), the viewport is the canvas size in CSS pixels.

import type { Camera, Point } from './camera';
import type { CellBox } from './model';

/** A rectangle in world units. */
export interface WorldRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Size of the visible area (the canvas) in CSS pixels. */
export interface ViewSize {
  width: number;
  height: number;
}

/** Screen pixels of free space a part must keep to the edges to count as "in view". */
export const REVEAL_MARGIN = 8;

/** A cell box as a world rectangle (`cellSize` world units per cell). */
export function cellBoxToWorld(box: CellBox, cellSize: number): WorldRect {
  return {
    left: box.col * cellSize,
    top: box.row * cellSize,
    right: (box.col + box.cols) * cellSize,
    bottom: (box.row + box.rows) * cellSize,
  };
}

/** True when the whole rectangle is on screen with at least `margin` pixels to every edge. */
export function isFullyVisible(cam: Camera, view: ViewSize, rect: WorldRect, margin = 0): boolean {
  return (
    (rect.left - cam.x) * cam.zoom >= margin &&
    (rect.top - cam.y) * cam.zoom >= margin &&
    (rect.right - cam.x) * cam.zoom <= view.width - margin &&
    (rect.bottom - cam.y) * cam.zoom <= view.height - margin
  );
}

/** The camera position (top-left world point) that puts the rectangle in the middle of the view at `zoom`. A rectangle larger than the view is centred too (its edges overflow equally). */
export function centeredCamera(rect: WorldRect, view: ViewSize, zoom: number): Point {
  return {
    x: (rect.left + rect.right) / 2 - view.width / 2 / zoom,
    y: (rect.top + rect.bottom) / 2 - view.height / 2 / zoom,
  };
}

/**
 * Where the camera has to go to show the rectangle, or null when it needs no
 * move: it is fully visible, the view has no size yet, or it is already centred
 * (a rectangle larger than the view stays where it is once centred). Zoom is
 * never changed.
 */
export function revealTarget(cam: Camera, view: ViewSize, rect: WorldRect, margin = REVEAL_MARGIN): Point | null {
  if (!(view.width > 0 && view.height > 0)) return null;
  if (isFullyVisible(cam, view, rect, margin)) return null;
  const target = centeredCamera(rect, view, cam.zoom);
  // Less than a tenth of a screen pixel away: nothing to do.
  if (Math.hypot(target.x - cam.x, target.y - cam.y) * cam.zoom < 0.1) return null;
  return target;
}

/** Slow start, slow end; 0 -> 0, 1 -> 1. */
export function easeInOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}
