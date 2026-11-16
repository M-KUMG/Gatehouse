// Placed parts on the grid. PlacedPart is plain serializable data so a
// project file can store it as-is later.

import { getPart } from './parts';

export type Rotation = 0 | 90 | 180 | 270;

export interface PlacedPart {
  id: number;
  typeId: string;
  col: number; // grid cell of the top-left corner of the (rotated) cell box
  row: number;
  rotation: Rotation; // clockwise degrees
}

/** A part's position without identity (also used for the placement ghost). */
export type Placement = Omit<PlacedPart, 'id'>;

export interface CellBox {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

export function nextRotation(r: Rotation): Rotation {
  return ((r + 90) % 360) as Rotation;
}

/** Cell size of a part type after rotation (cols/rows swap on 90/270). */
export function rotatedSize(typeId: string, rotation: Rotation): { cols: number; rows: number } {
  const type = getPart(typeId);
  const cols = type?.cols ?? 1;
  const rows = type?.rows ?? 1;
  return rotation % 180 === 0 ? { cols, rows } : { cols: rows, rows: cols };
}

/** The cells a placed part covers. */
export function footprint(p: Placement): CellBox {
  return { col: p.col, row: p.row, ...rotatedSize(p.typeId, p.rotation) };
}

/** Smallest cell box around all the parts, or null for none. */
export function boundsOf(parts: readonly Placement[]): CellBox | null {
  if (parts.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const p of parts) {
    const b = footprint(p);
    left = Math.min(left, b.col);
    top = Math.min(top, b.row);
    right = Math.max(right, b.col + b.cols);
    bottom = Math.max(bottom, b.row + b.rows);
  }
  return { col: left, row: top, cols: right - left, rows: bottom - top };
}

/** True when two boxes share some area. */
export function boxesOverlap(a: CellBox, b: CellBox): boolean {
  return a.col < b.col + b.cols && b.col < a.col + a.cols && a.row < b.row + b.rows && b.row < a.row + a.rows;
}

export class Scene {
  /** Draw order: last is on top. */
  readonly parts: PlacedPart[] = [];
  private nextId = 1;

  add(p: Placement): PlacedPart {
    const part: PlacedPart = { id: this.nextId++, ...p };
    this.parts.push(part);
    return part;
  }

  find(id: number | null): PlacedPart | undefined {
    return id === null ? undefined : this.parts.find((p) => p.id === id);
  }

  remove(id: number): void {
    const i = this.parts.findIndex((p) => p.id === id);
    if (i >= 0) this.parts.splice(i, 1);
  }

  bringToFront(id: number): void {
    const i = this.parts.findIndex((p) => p.id === id);
    if (i >= 0) this.parts.push(...this.parts.splice(i, 1));
  }

  /** Top-most part whose rotated box contains the (fractional) cell point. */
  partAt(col: number, row: number): PlacedPart | undefined {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const b = footprint(this.parts[i]);
      if (col >= b.col && col < b.col + b.cols && row >= b.row && row < b.row + b.rows) return this.parts[i];
    }
    return undefined;
  }

  /** Rotate 90 degrees clockwise, keeping the box centred where it was (to whole cells). */
  rotate(part: PlacedPart): void {
    const { cols, rows } = footprint(part);
    // trunc keeps odd size differences from drifting over four rotations.
    part.col += Math.trunc((cols - rows) / 2);
    part.row += Math.trunc((rows - cols) / 2);
    part.rotation = nextRotation(part.rotation);
  }

  /**
   * Rotate several parts 90 degrees clockwise as one block around the
   * centre of their bounding box, like `rotate` does for a single part.
   */
  rotateGroup(parts: readonly PlacedPart[]): void {
    const box = boundsOf(parts);
    if (!box) return;
    const { cols: w, rows: h } = box;
    // New top-left of the (h x w) box; trunc cancels out over rotations, so no drift.
    const left = box.col + Math.trunc((w - h) / 2);
    const top = box.row + Math.trunc((h - w) / 2);
    for (const part of parts) {
      const b = footprint(part);
      // Clockwise inside the box: (dx, dy) of the top-left -> (h - dy - rows, dx).
      part.col = left + h - (b.row - box.row) - b.rows;
      part.row = top + (b.col - box.col);
      part.rotation = nextRotation(part.rotation);
    }
  }
}
