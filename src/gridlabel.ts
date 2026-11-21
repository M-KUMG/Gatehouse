// The small label above a named board on the grid: a dark pill with the
// board's custom name, just above the board's top-left corner. It is drawn
// with the parts in every frame, so panning, zooming, moving and rotating
// keep it attached; it is not an element, so it never takes the mouse. Its
// size is in screen pixels whatever the zoom. Boards without a custom name
// have none (the default name shows in the status chip when selected).
//
// The geometry and the shortening of the text are plain functions (tested
// without a canvas); drawBoardNames is the thin canvas part.

import { PALETTE } from './canvaspalette';
import { footprint, type CellBox, type PlacedPart } from './model';
import { customBoardName } from './parts';

/** A rectangle in canvas CSS pixels. */
export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const LABEL_FONT_PX = 12;
export const LABEL_HEIGHT = 18;
/** Space between the pill and the board's corner. */
export const LABEL_GAP = 3;
const LABEL_PAD_X = 7;
/** Boards narrower than this on screen (very zoomed out) get no label. */
export const LABEL_MIN_BOARD_PX = 60;
/** The pill is at most this wide, and never wider than the board. */
export const LABEL_MAX_PX = 200;

const COLORS = { fill: PALETTE.labelFill, stroke: PALETTE.labelEdge, text: PALETTE.labelText };

/** Where a board's pill goes (its bottom-left corner sits just above the board's top-left corner), or null for no label. */
export function labelSlot(board: PixelBox, view: { width: number; height: number }): { x: number; y: number; maxWidth: number } | null {
  if (board.w < LABEL_MIN_BOARD_PX) return null;
  const offScreen = board.x + board.w <= 0 || board.y + board.h <= 0 || board.x >= view.width || board.y >= view.height;
  if (offScreen) return null;
  return { x: board.x, y: board.y - LABEL_GAP - LABEL_HEIGHT, maxWidth: Math.min(board.w, LABEL_MAX_PX) };
}

/** `text` cut to fit `maxWidth` by `measure`, ending in an ellipsis when something was removed (whole characters, emoji stay whole). */
export function fitText(text: string, maxWidth: number, measure: (s: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  const chars = [...text];
  let lo = 0; // longest prefix known to fit (with the ellipsis)
  let hi = chars.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${chars.slice(0, mid).join('').trimEnd()}…`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${chars.slice(0, lo).join('').trimEnd()}…`;
}

/** Draw the pills of the named boards among `parts`. The context is in CSS pixels; `toCanvas` maps a cell box to canvas pixels. */
export function drawBoardNames(
  ctx: CanvasRenderingContext2D,
  parts: readonly PlacedPart[],
  toCanvas: (box: CellBox) => PixelBox,
  view: { width: number; height: number },
): void {
  let ready = false;
  for (const part of parts) {
    const name = part.boardId !== undefined ? customBoardName(part) : undefined;
    if (name === undefined) continue;
    const slot = labelSlot(toCanvas(footprint(part)), view);
    if (!slot) continue;
    if (!ready) {
      ctx.font = `${LABEL_FONT_PX}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ready = true;
    }
    const text = fitText(name, slot.maxWidth - 2 * LABEL_PAD_X, (s) => ctx.measureText(s).width);
    const width = Math.min(slot.maxWidth, ctx.measureText(text).width + 2 * LABEL_PAD_X);
    ctx.beginPath();
    ctx.roundRect(slot.x, slot.y, width, LABEL_HEIGHT, LABEL_HEIGHT / 2);
    ctx.fillStyle = COLORS.fill;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.stroke;
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.fillText(text, slot.x + LABEL_PAD_X, slot.y + LABEL_HEIGHT / 2 + 0.5);
  }
}
