// The camera maps world units (1 grid cell = GRID_SIZE units) to canvas
// pixels. All screen<->world math lives here so callers never scatter it.
// "Screen" below means CSS pixels relative to the canvas' top-left corner.

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export interface Camera {
  x: number; // world position shown at the top-left corner of the canvas
  y: number;
  zoom: number; // screen pixels per world unit
}

export interface Point {
  x: number;
  y: number;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(cam: Camera, sx: number, sy: number): Point {
  return { x: cam.x + sx / cam.zoom, y: cam.y + sy / cam.zoom };
}

export function worldToScreen(cam: Camera, wx: number, wy: number): Point {
  return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
}

/** Set the zoom while keeping the world point under (sx, sy) in place. */
export function zoomAround(cam: Camera, sx: number, sy: number, zoom: number): void {
  const anchor = screenToWorld(cam, sx, sy);
  cam.zoom = clampZoom(zoom);
  cam.x = anchor.x - sx / cam.zoom;
  cam.y = anchor.y - sy / cam.zoom;
}
