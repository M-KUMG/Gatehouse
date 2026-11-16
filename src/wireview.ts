// Canvas drawing of wires, pins, the wire being drawn and warning badges.
// Called by GridView with the canvas in CSS pixels.

import type { Point } from './camera';
import type { GridView } from './grid';
import { footprint, samePin, type GridPoint, type PinRef, type Scene } from './model';
import { getPart } from './parts';
import { findPin, pinsOf, routeFrom, wireRoute, type Pin } from './pins';

/** A wire being drawn: fixed start, corners so far, and the end under the cursor. */
export interface WireDraft {
  from: PinRef;
  waypoints: GridPoint[];
  end: GridPoint;
  endPin: PinRef | null;
}

const SELECT = '#4ea1ff';
const CASING = 'rgba(12, 13, 15, 0.85)';
const LOW = [98, 134, 164]; // wire colour at 0 V...
const HIGH = [240, 124, 70]; // ...and at the highest voltage in the circuit
const MIN_FLOW_AMPS = 1e-5; // below this no current is animated

function wireWidth(view: GridView): number {
  return Math.min(6, Math.max(1.5, 2.6 * view.camera.zoom));
}

function voltageColor(volts: number | undefined, max: number): string {
  const t = volts === undefined || max < 1e-6 ? 0 : Math.min(1, Math.max(0, volts / max));
  const c = LOW.map((low, i) => Math.round(low + (HIGH[i] - low) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Polyline with rounded corners. */
function trace(ctx: CanvasRenderingContext2D, pts: readonly Point[], radius: number): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const before = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const after = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    ctx.arcTo(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, Math.min(radius, before / 2, after / 2));
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

function toCanvas(view: GridView, path: readonly GridPoint[]): Point[] {
  return path.map((p) => view.cellToCanvas(p.col, p.row));
}

/** Draws every wire. Returns true while current is flowing (the dashes need more frames). */
export function drawWires(view: GridView, ctx: CanvasRenderingContext2D, scene: Scene, timeMs: number): boolean {
  const width = wireWidth(view);
  const radius = 0.3 * view.cellPx;
  const sim = view.sim;
  const ends = new Map<string, { pin: PinRef; count: number; color: string }>();
  let animating = false;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const wire of scene.wires) {
    const path = wireRoute(scene, wire);
    if (!path) continue;
    const pts = toCanvas(view, path);
    const color = voltageColor(sim?.pinVoltage(wire.from), sim?.maxVoltage ?? 0);
    trace(ctx, pts, radius);
    if (view.selectedWires.has(wire.id)) {
      ctx.strokeStyle = 'rgba(78, 161, 255, 0.55)';
      ctx.lineWidth = width + 7;
      ctx.stroke();
    } else if (view.hoverWireId === wire.id) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = width + 6;
      ctx.stroke();
    }
    ctx.strokeStyle = CASING;
    ctx.lineWidth = width + 2;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();

    const amps = sim?.wireCurrent(wire.id) ?? 0;
    if (Math.abs(amps) >= MIN_FLOW_AMPS) {
      // Bright dashes drifting the way conventional current flows; faster for more current.
      const period = width * 5.5;
      const speed = view.camera.zoom * (12 + 14 * Math.log10(Math.abs(amps) / MIN_FLOW_AMPS));
      const shift = ((timeMs / 1000) * speed) % period;
      ctx.setLineDash([width * 1.2, period - width * 1.2]);
      ctx.lineDashOffset = amps > 0 ? -shift : shift;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = width * 0.42;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      animating = true;
    }

    for (const pin of [wire.from, wire.to]) {
      const key = `${pin.partId}:${pin.pinId}`;
      const end = ends.get(key);
      if (end) end.count++;
      else ends.set(key, { pin, count: 1, color });
    }
  }

  // Solder blob where a wire meets a pin; a bigger junction dot where three or more meet.
  for (const { pin, count, color } of ends.values()) {
    const at = findPin(scene, pin);
    if (!at) continue;
    const p = view.cellToCanvas(at.col, at.row);
    ctx.beginPath();
    ctx.arc(p.x, p.y, count >= 3 ? width * 1.45 : width * 0.8, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = CASING;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  return animating;
}

function drawPinDot(view: GridView, ctx: CanvasRenderingContext2D, pin: Pin, highlight: boolean): void {
  const p = view.cellToCanvas(pin.col, pin.row);
  if (highlight) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(78, 161, 255, 0.3)';
    ctx.fill();
    ctx.strokeStyle = SELECT;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(p.x, p.y, highlight ? 3.2 : 2.6, 0, 2 * Math.PI);
  ctx.fillStyle = highlight ? '#fff' : 'rgba(255, 255, 255, 0.8)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Pin dots: on the hovered part, and on every part while a wire is being drawn. */
export function drawPins(view: GridView, ctx: CanvasRenderingContext2D, scene: Scene): void {
  const draft = view.draft;
  const active = draft?.endPin ?? view.hoverPin;
  for (const part of scene.parts) {
    const show = draft !== null || part.id === view.hoverId || part.id === view.hoverPin?.partId;
    if (!show) continue;
    for (const pin of pinsOf(part)) {
      const highlight = (active !== null && samePin(pin.ref, active)) || (draft !== null && samePin(pin.ref, draft.from));
      drawPinDot(view, ctx, pin, highlight);
    }
  }
}

export function drawDraft(view: GridView, ctx: CanvasRenderingContext2D, scene: Scene): void {
  const draft = view.draft;
  const from = draft && findPin(scene, draft.from);
  if (!draft || !from) return;
  const to = draft.endPin && findPin(scene, draft.endPin);
  const pts = toCanvas(view, routeFrom(from, draft.waypoints, to ?? draft.end, to ?? null));
  const width = wireWidth(view);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  trace(ctx, pts, 0.3 * view.cellPx);
  ctx.strokeStyle = CASING;
  ctx.lineWidth = width + 2;
  ctx.stroke();
  ctx.strokeStyle = SELECT;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  for (const corner of draft.waypoints) {
    const p = view.cellToCanvas(corner.col, corner.row);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2, width * 0.7), 0, 2 * Math.PI);
    ctx.fill();
  }
}

/** A red "!" on parts that carry more current than they should. */
export function drawWarnings(view: GridView, ctx: CanvasRenderingContext2D, scene: Scene): void {
  for (const part of scene.parts) {
    const limit = getPart(part.typeId)?.warnAbove;
    const amps = Math.abs(view.sim?.partResult(part.id)?.current ?? 0);
    if (limit === undefined || amps <= limit || part.state?.burned) continue;
    const box = footprint(part);
    const p = view.cellToCanvas(box.col + box.cols, box.row);
    const r = Math.min(11, Math.max(6, 8 * view.camera.zoom));
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = '#e5484d';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(r * 1.5)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', p.x, p.y + 0.5);
  }
}
