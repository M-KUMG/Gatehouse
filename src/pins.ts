// Geometry of pins and wires, all in grid cells: where a part's pins are
// after rotation, which way they point, and the path a wire takes.

import {
  footprint, isPinEnd, type CellBox, type GridPoint, type Orientation, type PinRef, type PlacedPart, type Rotation, type Scene, type Wire,
  type WireEnd,
} from './model';
import { getPart, type PinDef, type PartType } from './parts';

export interface Pin {
  ref: PinRef;
  def: PinDef;
  part: PlacedPart;
  col: number;
  row: number;
  /** Unit step pointing away from the part's body. */
  dir: GridPoint;
}

/** A point of the unrotated cell box mirrored in that box (mirroring is its own inverse). */
function mirrorPoint(x: number, y: number, type: PartType, o: Orientation): { x: number; y: number } {
  return { x: o.mirrorX ? type.cols - x : x, y: o.mirrorY ? type.rows - y : y };
}

function turnPoint(x: number, y: number, type: PartType, rotation: Rotation): { x: number; y: number } {
  if (rotation === 90) return { x: type.rows - y, y: x };
  if (rotation === 180) return { x: type.cols - x, y: type.rows - y };
  if (rotation === 270) return { x: y, y: type.cols - x };
  return { x, y };
}

/**
 * A point of the part's own (unrotated, unmirrored) cell box, moved to
 * where it is in the placed box: mirrored first, then rotated. The one
 * place where a part's orientation is applied to its geometry (pins, knob,
 * reset button; the drawing in grid.ts does the same with a transform).
 */
export function rotatePoint(x: number, y: number, type: PartType, o: Orientation): { x: number; y: number } {
  const m = mirrorPoint(x, y, type, o);
  return turnPoint(m.x, m.y, type, o.rotation);
}

/** Inverse of rotatePoint: un-rotate, then un-mirror. */
export function unrotatePoint(x: number, y: number, type: PartType, o: Orientation): { x: number; y: number } {
  let p = { x, y };
  if (o.rotation === 90) p = { x: y, y: type.rows - x };
  else if (o.rotation === 180) p = { x: type.cols - x, y: type.rows - y };
  else if (o.rotation === 270) p = { x: type.cols - y, y: x };
  return mirrorPoint(p.x, p.y, type, o);
}

function pinDirection(type: PartType, def: PinDef, o: Orientation): GridPoint {
  let dc = def.x === 0 ? -1 : def.x === type.cols ? 1 : 0;
  let dr = dc !== 0 ? 0 : def.y === 0 ? -1 : def.y === type.rows ? 1 : 0;
  if (o.mirrorX) dc = -dc;
  if (o.mirrorY) dr = -dr;
  for (let r = 0; r < o.rotation; r += 90) [dc, dr] = [-dr, dc]; // quarter turn clockwise
  return { col: dc + 0, row: dr + 0 }; // + 0 turns -0 into 0
}

export function pinsOf(part: PlacedPart): Pin[] {
  const type = getPart(part.typeId);
  if (!type) return [];
  return type.pins.map((def) => {
    const p = rotatePoint(def.x, def.y, type, part);
    return {
      ref: { partId: part.id, pinId: def.id }, def, part,
      col: part.col + p.x, row: part.row + p.y,
      dir: pinDirection(type, def, part),
    };
  });
}

export function findPin(scene: Scene, ref: PinRef): Pin | null {
  const part = scene.find(ref.partId);
  return (part && pinsOf(part).find((p) => p.ref.pinId === ref.pinId)) ?? null;
}

/** The pin closest to a (fractional) cell point, within `radius` cells. */
export function pinAt(scene: Scene, col: number, row: number, radius: number): Pin | null {
  let best: Pin | null = null;
  let bestDist = radius;
  for (let i = scene.parts.length - 1; i >= 0; i--) {
    const part = scene.parts[i];
    const b = footprint(part);
    if (col < b.col - radius || col > b.col + b.cols + radius || row < b.row - radius || row > b.row + b.rows + radius) continue;
    for (const pin of pinsOf(part)) {
      const d = Math.hypot(pin.col - col, pin.row - row);
      if (d < bestDist) {
        best = pin;
        bestDist = d;
      }
    }
  }
  return best;
}

// ---- Wire paths ----------------------------------------------------------
// Wires are orthogonal. Between two points that are not in line the path
// makes one corner; pins decide which way so the wire leaves (or arrives)
// along the lead instead of running back through the part.

function corner(a: GridPoint, b: GridPoint, aDir: GridPoint | null, bDir: GridPoint | null, before: GridPoint | null): GridPoint | null {
  const dc = b.col - a.col;
  const dr = b.row - a.row;
  if (dc === 0 || dr === 0) return null;
  let horizontalFirst = true;
  if (aDir && (aDir.col !== 0 || aDir.row !== 0)) {
    horizontalFirst = aDir.col !== 0 ? Math.sign(dc) === aDir.col : Math.sign(dr) !== aDir.row;
  } else if (bDir && (bDir.col !== 0 || bDir.row !== 0)) {
    horizontalFirst = bDir.col !== 0 ? Math.sign(-dc) !== bDir.col : Math.sign(-dr) === bDir.row;
  }
  if (before) {
    // Never double back over the stretch that led here.
    const backH = before.row === a.row && Math.sign(before.col - a.col) === Math.sign(dc);
    const backV = before.col === a.col && Math.sign(before.row - a.row) === Math.sign(dr);
    if (horizontalFirst ? backH : backV) horizontalFirst = !horizontalFirst;
  }
  return horizontalFirst ? { col: b.col, row: a.row } : { col: a.col, row: b.row };
}

/** Where a wire end sits; `dir` is the pin's lead direction (null for a junction or a free point). */
export interface EndPoint extends GridPoint {
  dir: GridPoint | null;
}

/** Position of a wire end, or null when its part or junction is gone. */
export function endPoint(scene: Scene, end: WireEnd): EndPoint | null {
  if (isPinEnd(end)) return findPin(scene, end);
  const j = scene.findJunction(end.junctionId);
  return j ? { col: j.col, row: j.row, dir: null } : null;
}

/** Full path from a wire end through the waypoints to an end point (a wire end when `to` is given). */
export function routeFrom(from: EndPoint, waypoints: readonly GridPoint[], end: GridPoint, to: EndPoint | null): GridPoint[] {
  const stops: GridPoint[] = [from, ...waypoints, end];
  const path: GridPoint[] = [{ col: from.col, row: from.row }];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    const before = path.length > 1 ? path[path.length - 2] : null;
    const bend = corner(a, b, i === 1 ? from.dir : null, i === stops.length - 1 && to ? to.dir : null, before);
    if (bend) path.push(bend);
    if (b.col !== a.col || b.row !== a.row) path.push({ col: b.col, row: b.row });
  }
  return path;
}

/** Path of a wire, or null when one of its ends is gone. */
export function wireRoute(scene: Scene, wire: Wire): GridPoint[] | null {
  const from = endPoint(scene, wire.from);
  const to = endPoint(scene, wire.to);
  return from && to ? routeFrom(from, wire.waypoints, to, to) : null;
}

/** Every grid point a path passes, in order, from its first point to its last. */
export function pathPoints(path: readonly GridPoint[]): GridPoint[] {
  if (path.length === 0) return [];
  const out: GridPoint[] = [{ col: path[0].col, row: path[0].row }];
  for (let s = 1; s < path.length; s++) {
    const a = path[s - 1];
    const b = path[s];
    const dc = Math.sign(b.col - a.col);
    const dr = Math.sign(b.row - a.row);
    const steps = dc !== 0 && dr !== 0 ? 1 : Math.abs(b.col - a.col) + Math.abs(b.row - a.row);
    for (let k = 1; k <= steps; k++) {
      out.push(k === steps ? { col: b.col, row: b.row } : { col: a.col + dc * k, row: a.row + dr * k });
    }
  }
  return out;
}

/** Index of the path segment (1-based: from path[s - 1] to path[s]) that a grid point lies on, or -1. */
export function segmentAt(path: readonly GridPoint[], p: GridPoint): number {
  for (let s = 1; s < path.length; s++) {
    const a = path[s - 1];
    const b = path[s];
    const onCol = a.col === b.col && p.col === a.col && p.row >= Math.min(a.row, b.row) && p.row <= Math.max(a.row, b.row);
    const onRow = a.row === b.row && p.row === a.row && p.col >= Math.min(a.col, b.col) && p.col <= Math.max(a.col, b.col);
    if (onCol || onRow) return s;
  }
  return -1;
}

/** Grid point of a segment nearest to a (fractional) cell point. */
function nearestGridPoint(col: number, row: number, a: GridPoint, b: GridPoint): GridPoint {
  const clamp = (v: number, x: number, y: number): number => Math.min(Math.max(x, y), Math.max(Math.min(x, y), v));
  if (a.row === b.row) return { col: clamp(Math.round(col), a.col, b.col), row: a.row };
  if (a.col === b.col) return { col: a.col, row: clamp(Math.round(row), a.row, b.row) };
  return Math.hypot(col - a.col, row - a.row) <= Math.hypot(col - b.col, row - b.row) ? a : b;
}

/** Top-most wire within `tolerance` cells of a point, and the grid point on it nearest to the point. */
export function wirePointAt(scene: Scene, col: number, row: number, tolerance: number): { wire: Wire; point: GridPoint } | null {
  for (let i = scene.wires.length - 1; i >= 0; i--) {
    const path = wireRoute(scene, scene.wires[i]);
    if (!path) continue;
    let best: GridPoint | null = null;
    let bestDist = tolerance;
    for (let s = 1; s < path.length; s++) {
      const d = distanceToSegment(col, row, path[s - 1], path[s]);
      if (d <= bestDist) {
        bestDist = d;
        best = nearestGridPoint(col, row, path[s - 1], path[s]);
      }
    }
    if (best) return { wire: scene.wires[i], point: { col: best.col, row: best.row } };
  }
  return null;
}

function distanceToSegment(col: number, row: number, a: GridPoint, b: GridPoint): number {
  const dc = b.col - a.col;
  const dr = b.row - a.row;
  const len2 = dc * dc + dr * dr;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((col - a.col) * dc + (row - a.row) * dr) / len2));
  return Math.hypot(col - a.col - t * dc, row - a.row - t * dr);
}

/** Top-most wire passing within `tolerance` cells of a point. */
export function wireAt(scene: Scene, col: number, row: number, tolerance: number): Wire | undefined {
  for (let i = scene.wires.length - 1; i >= 0; i--) {
    const path = wireRoute(scene, scene.wires[i]);
    if (!path) continue;
    for (let s = 1; s < path.length; s++) {
      if (distanceToSegment(col, row, path[s - 1], path[s]) <= tolerance) return scene.wires[i];
    }
  }
  return undefined;
}

/** Smallest box around some paths, or null for none. */
export function pathBounds(paths: readonly GridPoint[][]): CellBox | null {
  const points = paths.flat();
  if (points.length === 0) return null;
  const cols = points.map((p) => p.col);
  const rows = points.map((p) => p.row);
  const col = Math.min(...cols);
  const row = Math.min(...rows);
  return { col, row, cols: Math.max(...cols) - col, rows: Math.max(...rows) - row };
}
