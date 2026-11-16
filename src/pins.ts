// Geometry of pins and wires, all in grid cells: where a part's pins are
// after rotation, which way they point, and the path a wire takes.

import { footprint, type CellBox, type GridPoint, type PinRef, type PlacedPart, type Rotation, type Scene, type Wire } from './model';
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

/** A point of the unrotated cell box, moved to where it is in the rotated box. */
export function rotatePoint(x: number, y: number, type: PartType, rotation: Rotation): { x: number; y: number } {
  if (rotation === 90) return { x: type.rows - y, y: x };
  if (rotation === 180) return { x: type.cols - x, y: type.rows - y };
  if (rotation === 270) return { x: y, y: type.cols - x };
  return { x, y };
}

/** Inverse of rotatePoint. */
export function unrotatePoint(x: number, y: number, type: PartType, rotation: Rotation): { x: number; y: number } {
  if (rotation === 90) return { x: y, y: type.rows - x };
  if (rotation === 180) return { x: type.cols - x, y: type.rows - y };
  if (rotation === 270) return { x: type.cols - y, y: x };
  return { x, y };
}

function pinDirection(type: PartType, def: PinDef, rotation: Rotation): GridPoint {
  let dc = def.x === 0 ? -1 : def.x === type.cols ? 1 : 0;
  let dr = dc !== 0 ? 0 : def.y === 0 ? -1 : def.y === type.rows ? 1 : 0;
  for (let r = 0; r < rotation; r += 90) [dc, dr] = [-dr, dc]; // quarter turn clockwise
  return { col: dc, row: dr };
}

export function pinsOf(part: PlacedPart): Pin[] {
  const type = getPart(part.typeId);
  if (!type) return [];
  return type.pins.map((def) => {
    const p = rotatePoint(def.x, def.y, type, part.rotation);
    return {
      ref: { partId: part.id, pinId: def.id }, def, part,
      col: part.col + p.x, row: part.row + p.y,
      dir: pinDirection(type, def, part.rotation),
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

/** Full path from a pin through the waypoints to an end point (a pin when `to` is given). */
export function routeFrom(from: Pin, waypoints: readonly GridPoint[], end: GridPoint, to: Pin | null): GridPoint[] {
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

/** Path of a wire, or null when one of its parts is gone. */
export function wireRoute(scene: Scene, wire: Wire): GridPoint[] | null {
  const from = findPin(scene, wire.from);
  const to = findPin(scene, wire.to);
  return from && to ? routeFrom(from, wire.waypoints, to, to) : null;
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
