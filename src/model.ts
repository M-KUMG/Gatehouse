// The circuit being edited: placed parts and the wires between their pins.
// Everything stored is plain serializable data (see ProjectState), so a
// project file can hold it as-is later.

import { getPart, type PartState } from './parts';

export type { PartState };

export type Rotation = 0 | 90 | 180 | 270;

export interface PlacedPart {
  id: number;
  typeId: string;
  col: number; // grid cell of the top-left corner of the (rotated) cell box
  row: number;
  rotation: Rotation; // clockwise degrees
  /** Switch position, resistance and the like; see PartState. */
  state?: PartState;
}

/** A grid point (line crossing), in cells. */
export interface GridPoint {
  col: number;
  row: number;
}

/** One pin of one placed part. */
export interface PinRef {
  partId: number;
  pinId: string;
}

/** A wire from pin to pin. It follows its parts; the waypoints stay where they were put. */
export interface Wire {
  id: number;
  from: PinRef;
  to: PinRef;
  waypoints: GridPoint[];
}

/** Everything a project stores about the circuit. */
export interface ProjectState {
  version: 1;
  parts: PlacedPart[];
  wires: Wire[];
}

export function samePin(a: PinRef, b: PinRef): boolean {
  return a.partId === b.partId && a.pinId === b.pinId;
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
  readonly wires: Wire[] = [];
  private nextId = 1; // shared by parts and wires

  add(p: Placement): PlacedPart {
    const state = p.state ?? getPart(p.typeId)?.defaults;
    const part: PlacedPart = { id: this.nextId++, typeId: p.typeId, col: p.col, row: p.row, rotation: p.rotation };
    if (state) part.state = { ...state };
    this.parts.push(part);
    return part;
  }

  find(id: number | null): PlacedPart | undefined {
    return id === null ? undefined : this.parts.find((p) => p.id === id);
  }

  /** Remove a part and every wire attached to it. */
  remove(id: number): void {
    const i = this.parts.findIndex((p) => p.id === id);
    if (i < 0) return;
    this.parts.splice(i, 1);
    for (let w = this.wires.length - 1; w >= 0; w--) {
      const wire = this.wires[w];
      if (wire.from.partId === id || wire.to.partId === id) this.wires.splice(w, 1);
    }
  }

  /** Connect two pins. Returns null for a wire to the same pin or one that already exists. */
  addWire(from: PinRef, to: PinRef, waypoints: readonly GridPoint[] = []): Wire | null {
    if (samePin(from, to)) return null;
    const exists = this.wires.some(
      (w) => (samePin(w.from, from) && samePin(w.to, to)) || (samePin(w.from, to) && samePin(w.to, from)),
    );
    if (exists) return null;
    const wire: Wire = { id: this.nextId++, from: { ...from }, to: { ...to }, waypoints: waypoints.map((p) => ({ ...p })) };
    this.wires.push(wire);
    return wire;
  }

  findWire(id: number | null): Wire | undefined {
    return id === null ? undefined : this.wires.find((w) => w.id === id);
  }

  removeWire(id: number): void {
    const i = this.wires.findIndex((w) => w.id === id);
    if (i >= 0) this.wires.splice(i, 1);
  }

  /** Wires with both ends on the given parts. */
  wiresWithin(partIds: ReadonlySet<number>): Wire[] {
    return this.wires.filter((w) => partIds.has(w.from.partId) && partIds.has(w.to.partId));
  }

  /** A deep copy of the circuit, or of some parts and the wires between them. */
  snapshot(partIds?: ReadonlySet<number>): ProjectState {
    const parts = partIds ? this.parts.filter((p) => partIds.has(p.id)) : this.parts;
    const wires = partIds ? this.wiresWithin(partIds) : this.wires;
    return JSON.parse(JSON.stringify({ version: 1, parts, wires })) as ProjectState;
  }

  /** Add a copy of `state`, shifted by whole cells, under new ids. */
  insert(state: ProjectState, dCol = 0, dRow = 0): { parts: PlacedPart[]; wires: Wire[] } {
    const ids = new Map<number, number>();
    const parts = state.parts.map((p) => {
      const part = this.add({ ...p, col: p.col + dCol, row: p.row + dRow });
      ids.set(p.id, part.id);
      return part;
    });
    const wires: Wire[] = [];
    for (const w of state.wires) {
      const from = ids.get(w.from.partId);
      const to = ids.get(w.to.partId);
      if (from === undefined || to === undefined) continue;
      const wire = this.addWire(
        { partId: from, pinId: w.from.pinId },
        { partId: to, pinId: w.to.pinId },
        w.waypoints.map((p) => ({ col: p.col + dCol, row: p.row + dRow })),
      );
      if (wire) wires.push(wire);
    }
    return { parts, wires };
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
    // Corners of the wires between these parts turn with them.
    for (const wire of this.wiresWithin(new Set(parts.map((p) => p.id)))) {
      for (const point of wire.waypoints) {
        const dy = point.row - box.row;
        point.row = top + (point.col - box.col);
        point.col = left + h - dy;
      }
    }
    for (const part of parts) {
      const b = footprint(part);
      // Clockwise inside the box: (dx, dy) of the top-left -> (h - dy - rows, dx).
      part.col = left + h - (b.row - box.row) - b.rows;
      part.row = top + (b.col - box.col);
      part.rotation = nextRotation(part.rotation);
    }
  }
}
