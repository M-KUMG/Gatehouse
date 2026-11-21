// Turns part SVGs into images for the canvas. Each part is rasterized per
// device-pixel scale (DPR x zoom), so it stays sharp at any DPR and zoom.

import type { PartState, PartType } from './parts';

const MAX_RASTERS = 96; // zooming creates many sizes; keep the most recent ones

const urls = new Map<string, string>();
const images = new Map<string, HTMLImageElement>();
const rasters = new Map<string, HTMLCanvasElement>();
/** The last bitmap drawn of each part type: shown while the next look of that part (a new LED color) is still loading, so it does not blink. */
const lastDrawn = new Map<string, HTMLCanvasElement>();

/** data: URL of the part's SVG, usable as an <img> src. */
export function partImageUrl(type: PartType): string {
  let url = urls.get(type.id);
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(type.svg)}`;
    urls.set(type.id, url);
  }
  return url;
}

/** One look of a part: its default art or a state-dependent variant. */
export interface PartLook {
  key: string; // unique per part type and look
  svg: string;
}

export function partLook(type: PartType, state: PartState | undefined): PartLook {
  const variant = state && type.variant?.(state);
  return variant ? { key: `${type.id}:${variant.key}`, svg: variant.svg } : { key: type.id, svg: type.svg };
}

function loadedImage(look: PartLook, onLoad: () => void): HTMLImageElement | null {
  let img = images.get(look.key);
  if (!img) {
    img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(look.svg)}`;
    images.set(look.key, img);
  }
  if (img.complete && img.naturalWidth > 0) return img;
  img.addEventListener('load', onLoad, { once: true });
  return null;
}

/**
 * Bitmap of the part at `pxPerCell` device pixels per grid cell, or null
 * while the SVG is still loading (onLoad is called once it is ready).
 * Pass a whole number of pixels so nearby zoom levels share a bitmap.
 */
export function getSprite(type: PartType, look: PartLook, pxPerCell: number, onLoad: () => void): HTMLCanvasElement | null {
  const key = `${look.key}@${pxPerCell}`;
  const cached = rasters.get(key);
  if (cached) {
    // Re-insert so the map's order stays least-recently-used first.
    rasters.delete(key);
    rasters.set(key, cached);
    lastDrawn.set(type.id, cached);
    return cached;
  }
  const img = loadedImage(look, onLoad);
  if (!img) {
    const stale = lastDrawn.get(type.id);
    return stale && stale.width === Math.max(1, Math.round(type.cols * pxPerCell)) ? stale : null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(type.cols * pxPerCell));
  canvas.height = Math.max(1, Math.round(type.rows * pxPerCell));
  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
  rasters.set(key, canvas);
  lastDrawn.set(type.id, canvas);
  if (rasters.size > MAX_RASTERS) {
    const oldest = rasters.keys().next().value;
    if (oldest !== undefined) rasters.delete(oldest);
  }
  return canvas;
}
