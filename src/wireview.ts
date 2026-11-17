// Canvas drawing of wires, pins, the wire being drawn and warning badges.
// Called by GridView with the canvas in CSS pixels.

import { MIN_FLOW_AMPS, type FlowPhases } from './animation';
import type { Point } from './camera';
import { findContacts } from './contacts';
import type { GridView } from './grid';
import { anchorPoint, isTap, type Anchor } from './junctions';
import { endKey, footprint, isPinEnd, samePin, type GridPoint, type Scene, type WireEnd } from './model';
import { getPart } from './parts';
import { endPoint, pinsOf, routeFrom, wireRoute, type Pin } from './pins';

/** A wire being drawn: fixed start, corners so far, the end under the cursor and what it would attach to. */
export interface WireDraft {
  from: Anchor;
  waypoints: GridPoint[];
  end: GridPoint;
  /** Pin, junction or wire point the wire would end on if released here. */
  target: Anchor | null;
}

const SELECT = '#4ea1ff';
const CASING = 'rgba(12, 13, 15, 0.85)';
const LOW = [98, 134, 164]; // wire colour at 0 V...
const HIGH = [240, 124, 70]; // ...and at the highest voltage in the circuit

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

function junctionDot(view: GridView, ctx: CanvasRenderingContext2D, at: GridPoint, radius: number, color: string): void {
  const p = view.cellToCanvas(at.col, at.row);
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = CASING;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * Draws every wire, the solder blobs at wire ends and the junction dots
 * (three or more wire ends at a pin, junction nodes, and points where pins
 * touch each other or lie on a wire). Returns the largest wire current, so
 * the caller knows whether the current dashes need more frames.
 */
export function drawWires(view: GridView, ctx: CanvasRenderingContext2D, scene: Scene, flow: FlowPhases): number {
  const width = wireWidth(view);
  const radius = 0.3 * view.cellPx;
  const sim = view.sim;
  const maxVolts = sim?.maxVoltage ?? 0;
  const ends = new Map<string, { end: WireEnd; count: number; color: string }>();
  const target = view.draft?.target;
  const highlighted = target && isTap(target) ? target.wireId : view.hoverWireId;
  let maxAmps = 0;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const wire of scene.wires) {
    const path = wireRoute(scene, wire);
    if (!path) continue;
    const pts = toCanvas(view, path);
    const color = voltageColor(sim?.pinVoltage(wire.from), maxVolts);
    trace(ctx, pts, radius);
    if (view.selectedWires.has(wire.id)) {
      ctx.strokeStyle = 'rgba(78, 161, 255, 0.55)';
      ctx.lineWidth = width + 7;
      ctx.stroke();
    } else if (highlighted === wire.id) {
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
    maxAmps = Math.max(maxAmps, Math.abs(amps));
    if (Math.abs(amps) >= MIN_FLOW_AMPS) {
      // Bright dashes drifting the way conventional current flows; faster for more current.
      const period = width * 5.5;
      const shift = flow.phase(wire.id, amps) * period;
      ctx.setLineDash([width * 1.2, period - width * 1.2]);
      ctx.lineDashOffset = amps > 0 ? -shift : shift;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = width * 0.42;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    for (const end of [wire.from, wire.to]) {
      const key = endKey(end);
      const known = ends.get(key);
      if (known) known.count++;
      else ends.set(key, { end, count: 1, color });
    }
  }

  // Solder blob where a wire meets a pin; a bigger junction dot where three or more meet, and on every junction node.
  const big = width * 1.45;
  for (const { end, count, color } of ends.values()) {
    const at = endPoint(scene, end);
    if (at) junctionDot(view, ctx, at, count >= 3 || !isPinEnd(end) ? big : width * 0.8, color);
  }
  // Pins touching pins, and pins lying on a wire, are connected there too.
  for (const point of findContacts(scene).points) {
    junctionDot(view, ctx, point, big, voltageColor(sim?.pinVoltage(point.end), maxVolts));
  }
  return maxAmps;
}

/** A ring and dot where a wire would attach: `filled` for a target that a release connects to. */
function attachMark(view: GridView, ctx: CanvasRenderingContext2D, at: GridPoint, filled: boolean): void {
  const p = view.cellToCanvas(at.col, at.row);
  ctx.beginPath();
  ctx.arc(p.x, p.y, 7, 0, 2 * Math.PI);
  ctx.fillStyle = filled ? 'rgba(78, 161, 255, 0.3)' : 'rgba(78, 161, 255, 0.12)';
  ctx.fill();
  ctx.strokeStyle = SELECT;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(p.x, p.y, filled ? 3.2 : 2.4, 0, 2 * Math.PI);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

/** Where pressing and dragging on the hovered wire would start a new wire. */
export function drawTapHint(view: GridView, ctx: CanvasRenderingContext2D): void {
  if (view.hoverTap && !view.draft) attachMark(view, ctx, view.hoverTap, false);
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
  const asPin = (a: Anchor | null | undefined) => (a && !isTap(a) && isPinEnd(a) ? a : null);
  const active = draft ? asPin(draft.target) : view.hoverPin;
  const start = asPin(draft?.from);
  for (const part of scene.parts) {
    const show = draft !== null || part.id === view.hoverId || part.id === view.hoverPin?.partId;
    if (!show) continue;
    for (const pin of pinsOf(part)) {
      const highlight = (active !== null && samePin(pin.ref, active)) || (start !== null && samePin(pin.ref, start));
      drawPinDot(view, ctx, pin, highlight);
    }
  }
}

export function drawDraft(view: GridView, ctx: CanvasRenderingContext2D, scene: Scene): void {
  const draft = view.draft;
  const from = draft && anchorPoint(scene, draft.from);
  if (!draft || !from) return;
  const to = draft.target && anchorPoint(scene, draft.target);
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
  // Starting on, or about to end on, a wire or junction: mark the point (pins are marked by drawPins).
  if (isTap(draft.from) || !isPinEnd(draft.from)) attachMark(view, ctx, from, true);
  if (to && draft.target && (isTap(draft.target) || !isPinEnd(draft.target))) attachMark(view, ctx, to, true);
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
