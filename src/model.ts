// The circuit being edited: placed parts, the wires between their pins and
// the junction nodes where wires meet. Everything stored is plain
// serializable data (see ProjectState), so a project file holds it as-is.
// Contacts between touching pins are not stored: see contacts.ts.

import { canMirror, getPart, type PartState } from './parts';
import { coveringCounters, isBoardType, nextBoardId, type BoardCounters } from './project/boardid';
import { copyTree, defaultTree, type SourceFiles } from './project/filetree';

export type { PartState };

export type Rotation = 0 | 90 | 180 | 270;

export interface PlacedPart {
  id: number;
  typeId: string;
  /** Boards only: stable id within the project, e.g. "uno-1"; names its source folder (see project/boardid.ts). */
  boardId?: string;
  col: number; // grid cell of the top-left corner of the (rotated) cell box
  row: number;
  rotation: Rotation; // clockwise degrees
  /**
   * Mirrored in the part's own (unrotated) cell box: x -> cols - x
   * (mirrorX) and y -> rows - y (mirrorY), applied BEFORE the rotation (see
   * pins.ts rotatePoint). Absent means false; only mirrorable parts (see
   * canMirror in parts.ts) have them. Pin ids never change, only
   * where the pins are.
   */
  mirrorX?: boolean;
  mirrorY?: boolean;
  /** Switch position, resistance and the like; see PartState. */
  state?: PartState;
}

/** How a part is turned: mirrored in its own box first, then rotated clockwise. */
export interface Orientation {
  rotation: Rotation;
  mirrorX?: boolean;
  mirrorY?: boolean;
}

/** A mirror line on screen: 'h' flips left/right, 'v' flips top/bottom. */
export type FlipAxis = 'h' | 'v';

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

/** One junction node: wires attach to it like to a pin. */
export interface JunctionRef {
  junctionId: number;
}

/** What a wire end is attached to: a part's pin or a junction node. */
export type WireEnd = PinRef | JunctionRef;

/**
 * A point where three or more wires meet (made by ending a wire on another
 * wire, which splits that wire in two here). Stored, unlike the implicit
 * contacts of touching pins, which are derived from positions.
 */
export interface Junction {
  id: number;
  col: number;
  row: number;
}

/** A wire between two ends. It follows its parts; the waypoints stay where they were put. */
export interface Wire {
  id: number;
  from: WireEnd;
  to: WireEnd;
  waypoints: GridPoint[];
}

/** Everything a project stores about the circuit. */
export interface ProjectState {
  /** 2: no source files; 3: with `files`; 4: firmware in `files`, not in part state. */
  version: 2 | 3 | 4;
  parts: PlacedPart[];
  wires: Wire[];
  junctions: Junction[];
  /** Source trees of the boards in `parts`, by boardId. */
  files?: SourceFiles;
}

export function samePin(a: PinRef, b: PinRef): boolean {
  return a.partId === b.partId && a.pinId === b.pinId;
}

export function isPinEnd(end: WireEnd): end is PinRef {
  return 'partId' in end;
}

/** Stable text key of an end, e.g. "3:anode" or "j12". */
export function endKey(end: WireEnd): string {
  return isPinEnd(end) ? `${end.partId}:${end.pinId}` : `j${end.junctionId}`;
}

export function sameEnd(a: WireEnd, b: WireEnd): boolean {
  return endKey(a) === endKey(b);
}

export function copyEnd(end: WireEnd): WireEnd {
  return isPinEnd(end) ? { partId: end.partId, pinId: end.pinId } : { junctionId: end.junctionId };
}

function touchesJunction(wire: Wire, id: number): boolean {
  return [wire.from, wire.to].some((e) => !isPinEnd(e) && e.junctionId === id);
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

/** True when parts of this type can be mirrored (the asymmetric ones; see PartType.mirrorable). */
export function isMirrorable(typeId: string): boolean {
  const type = getPart(typeId);
  return type !== undefined && canMirror(type);
}

/**
 * The orientation after mirroring on screen (around the part's own centre;
 * the cell box keeps its size and place). A screen flip of a part turned by
 * 90 or 270 degrees is the other local mirror under the same rotation.
 * Mirroring in both directions is a half turn, so the result never has both
 * set: it is stored as rotation + 180 instead (one form per look).
 */
export function flipOrientation(o: Orientation, axis: FlipAxis): Orientation {
  const quarter = o.rotation % 180 !== 0;
  let mirrorX = o.mirrorX === true;
  let mirrorY = o.mirrorY === true;
  if ((axis === 'h') !== quarter) mirrorX = !mirrorX;
  else mirrorY = !mirrorY;
  let rotation = o.rotation;
  if (mirrorX && mirrorY) {
    mirrorX = mirrorY = false;
    rotation = ((rotation + 180) % 360) as Rotation;
  }
  return { rotation, ...(mirrorX ? { mirrorX } : {}), ...(mirrorY ? { mirrorY } : {}) };
}

/** Set a part's (or ghost's) orientation in place; mirror fields are only present when true. */
export function setOrientation(p: Orientation, o: Orientation): void {
  p.rotation = o.rotation;
  if (o.mirrorX) p.mirrorX = true;
  else delete p.mirrorX;
  if (o.mirrorY) p.mirrorY = true;
  else delete p.mirrorY;
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
  readonly junctions: Junction[] = [];
  /** Source files of each board, by boardId. Kept in step with the board parts. */
  files: SourceFiles = {};
  private nextId = 1; // shared by parts, wires and junctions
  /** Last boardId number per type; only goes up (see project/boardid.ts). */
  private counters: BoardCounters = {};

  /** The boardId counters to save with the project (a copy). */
  get boardCounters(): BoardCounters {
    return { ...this.counters };
  }

  /** Add a part; a board gets a new boardId and the default source tree. */
  add(p: Placement): PlacedPart {
    const state = p.state ?? getPart(p.typeId)?.defaults;
    const boardId = isBoardType(p.typeId) ? nextBoardId(this.counters, p.typeId) : undefined;
    const part: PlacedPart = {
      id: this.nextId++, typeId: p.typeId, ...(boardId ? { boardId } : {}), col: p.col, row: p.row, rotation: p.rotation,
    };
    if (isMirrorable(p.typeId)) setOrientation(part, p);
    if (state) part.state = { ...state };
    if (boardId) this.files[boardId] = defaultTree();
    this.parts.push(part);
    return part;
  }

  /**
   * Replace the whole circuit, keeping the given ids (for loading a
   * project). `counters` are the saved boardId counters; they are raised
   * to cover every boardId present.
   */
  replace(parts: PlacedPart[], wires: Wire[], junctions: Junction[] = [], files: SourceFiles = {}, counters: BoardCounters = {}): void {
    this.parts.splice(0, this.parts.length, ...parts);
    this.wires.splice(0, this.wires.length, ...wires);
    this.junctions.splice(0, this.junctions.length, ...junctions);
    this.nextId = [...parts, ...wires, ...junctions].reduce((max, x) => Math.max(max, x.id), 0) + 1;
    this.files = files;
    this.counters = coveringCounters(counters, [...parts.flatMap((p) => p.boardId ?? []), ...Object.keys(files)]);
    this.syncBoards();
  }

  /**
   * Like replace, for undo / redo: ids and boardId counters never go
   * backwards, so a new part never takes the id or boardId of one that an
   * undo removed (board runtimes and serial buffers are kept per id).
   */
  restore(parts: PlacedPart[], wires: Wire[], junctions: Junction[], files: SourceFiles = {}): void {
    const next = this.nextId;
    const counters = this.counters;
    this.replace(parts, wires, junctions, files, counters);
    this.nextId = Math.max(next, this.nextId);
  }

  /** Every board has a boardId and a tree; trees of boards that are gone are dropped. */
  private syncBoards(): void {
    const ids = new Set<string>();
    for (const part of this.parts) {
      if (!isBoardType(part.typeId)) continue;
      if (!part.boardId || ids.has(part.boardId)) part.boardId = nextBoardId(this.counters, part.typeId);
      ids.add(part.boardId);
      if (!Object.hasOwn(this.files, part.boardId)) this.files[part.boardId] = defaultTree();
    }
    for (const id of Object.keys(this.files)) if (!ids.has(id)) delete this.files[id];
  }

  find(id: number | null): PlacedPart | undefined {
    return id === null ? undefined : this.parts.find((p) => p.id === id);
  }

  /** Remove a part and every wire attached to it. */
  remove(id: number): void {
    this.removeMany([id], []);
  }

  /** Connect two ends. Returns null for a wire from an end to itself or one that already exists. */
  addWire(from: WireEnd, to: WireEnd, waypoints: readonly GridPoint[] = []): Wire | null {
    if (sameEnd(from, to) || this.wireBetween(from, to)) return null;
    const wire: Wire = {
      id: this.nextId++, from: copyEnd(from), to: copyEnd(to), waypoints: waypoints.map((p) => ({ col: p.col, row: p.row })),
    };
    this.wires.push(wire);
    return wire;
  }

  /** A wire joining these two ends (either way round), if any, other than those in `except`. */
  wireBetween(a: WireEnd, b: WireEnd, except?: ReadonlySet<Wire>): Wire | undefined {
    return this.wires.find(
      (w) => !except?.has(w) && ((sameEnd(w.from, a) && sameEnd(w.to, b)) || (sameEnd(w.from, b) && sameEnd(w.to, a))),
    );
  }

  findWire(id: number | null): Wire | undefined {
    return id === null ? undefined : this.wires.find((w) => w.id === id);
  }

  removeWire(id: number): void {
    this.removeMany([], [id]);
  }

  /**
   * Remove parts (with their wires) and wires in one go, then tidy the
   * junctions that lost wires (see tidyJunctions). Removing everything
   * first matters: tidying merges wires, which would otherwise change
   * wires that are still to be removed.
   */
  removeMany(partIds: Iterable<number>, wireIds: Iterable<number>): void {
    const parts = new Set(partIds);
    const wires = new Set(wireIds);
    for (let i = this.parts.length - 1; i >= 0; i--) {
      if (parts.has(this.parts[i].id)) this.parts.splice(i, 1);
    }
    const onPart = (e: WireEnd): boolean => isPinEnd(e) && parts.has(e.partId);
    for (let i = this.wires.length - 1; i >= 0; i--) {
      const w = this.wires[i];
      if (wires.has(w.id) || onPart(w.from) || onPart(w.to)) this.wires.splice(i, 1);
    }
    this.syncBoards(); // a deleted board takes its files with it
    this.tidyJunctions();
  }

  addJunction(col: number, row: number): Junction {
    const junction: Junction = { id: this.nextId++, col, row };
    this.junctions.push(junction);
    return junction;
  }

  findJunction(id: number): Junction | undefined {
    return this.junctions.find((j) => j.id === id);
  }

  junctionAt(col: number, row: number): Junction | undefined {
    return this.junctions.find((j) => j.col === col && j.row === row);
  }

  /** Wires attached to a junction. */
  wiresAt(junctionId: number): Wire[] {
    return this.wires.filter((w) => touchesJunction(w, junctionId));
  }

  /**
   * A junction is kept only while three or more wires meet at it. With two
   * left, the two wires become one again (through the junction's point, so
   * nothing moves on screen); with one or none left, the junction and the
   * dead-end wire go. Repeats until nothing changes.
   */
  tidyJunctions(): void {
    for (let changed = true; changed; ) {
      changed = false;
      for (const junction of [...this.junctions]) {
        const attached = this.wiresAt(junction.id);
        if (attached.length >= 3) continue;
        changed = true;
        if (attached.length === 2 && this.mergeAt(junction, attached[0], attached[1])) continue;
        // A stub, or two halves that would only repeat an existing wire or loop back: drop them.
        for (const w of attached) this.wires.splice(this.wires.indexOf(w), 1);
        this.junctions.splice(this.junctions.indexOf(junction), 1);
      }
    }
  }

  /** Join wires `a` and `b`, which meet at `junction`, into `a`. False when the result would be pointless. */
  private mergeAt(junction: Junction, a: Wire, b: Wire): boolean {
    // The far end of a wire and its corners in order from there to the junction.
    const towards = (w: Wire): { other: WireEnd; points: GridPoint[] } =>
      !isPinEnd(w.to) && w.to.junctionId === junction.id
        ? { other: w.from, points: w.waypoints }
        : { other: w.to, points: [...w.waypoints].reverse() };
    const first = towards(a);
    const second = towards(b);
    if (sameEnd(first.other, second.other) || this.wireBetween(first.other, second.other, new Set([a, b]))) return false;
    a.from = first.other;
    a.to = second.other;
    a.waypoints = [...first.points, { col: junction.col, row: junction.row }, ...[...second.points].reverse()];
    this.wires.splice(this.wires.indexOf(b), 1);
    this.junctions.splice(this.junctions.indexOf(junction), 1);
    return true;
  }

  /**
   * What moves, rotates and is copied with a set of parts: the wires with
   * both ends on them, and the junctions whose every wire leads to them
   * (directly or through other such junctions).
   */
  within(partIds: ReadonlySet<number>): { wires: Wire[]; junctions: Junction[] } {
    const inside = new Set(this.junctions.map((j) => j.id));
    const isIn = (e: WireEnd): boolean => (isPinEnd(e) ? partIds.has(e.partId) : inside.has(e.junctionId));
    for (let changed = true; changed; ) {
      changed = false;
      for (const w of this.wires) {
        if (isIn(w.from) === isIn(w.to)) continue;
        // One end leaves the set: the junction at the other end cannot come along.
        for (const e of [w.from, w.to]) {
          if (!isPinEnd(e) && inside.delete(e.junctionId)) changed = true;
        }
      }
    }
    return {
      wires: this.wires.filter((w) => isIn(w.from) && isIn(w.to)),
      junctions: this.junctions.filter((j) => inside.has(j.id)),
    };
  }

  /** A deep copy of the circuit, or of some parts and the wires and junctions between them. */
  snapshot(partIds?: ReadonlySet<number>): ProjectState {
    const inner = partIds ? this.within(partIds) : { wires: this.wires, junctions: this.junctions };
    const parts = partIds ? this.parts.filter((p) => partIds.has(p.id)) : this.parts;
    const files = Object.fromEntries(parts.flatMap((p) => (p.boardId && this.files[p.boardId] ? [[p.boardId, this.files[p.boardId]]] : [])));
    const state: ProjectState = { version: 4, parts, wires: inner.wires, junctions: inner.junctions, files };
    return JSON.parse(JSON.stringify(state)) as ProjectState;
  }

  /** Add a copy of `state`, shifted by whole cells, under new ids. Boards get new boardIds and copies of their files. */
  insert(state: ProjectState, dCol = 0, dRow = 0): { parts: PlacedPart[]; wires: Wire[]; junctions: Junction[] } {
    const partIds = new Map<number, number>();
    const parts = state.parts.map((p) => {
      const part = this.add({ ...p, col: p.col + dCol, row: p.row + dRow });
      partIds.set(p.id, part.id);
      const source = p.boardId && state.files && Object.hasOwn(state.files, p.boardId) ? state.files[p.boardId] : undefined;
      if (part.boardId && source) this.files[part.boardId] = copyTree(source);
      return part;
    });
    const junctionIds = new Map<number, number>();
    const junctions = state.junctions.map((j) => {
      const junction = this.addJunction(j.col + dCol, j.row + dRow);
      junctionIds.set(j.id, junction.id);
      return junction;
    });
    const map = (e: WireEnd): WireEnd | null => {
      if (isPinEnd(e)) {
        const partId = partIds.get(e.partId);
        return partId === undefined ? null : { partId, pinId: e.pinId };
      }
      const junctionId = junctionIds.get(e.junctionId);
      return junctionId === undefined ? null : { junctionId };
    };
    const wires: Wire[] = [];
    for (const w of state.wires) {
      const from = map(w.from);
      const to = map(w.to);
      if (!from || !to) continue;
      const wire = this.addWire(from, to, w.waypoints.map((p) => ({ col: p.col + dCol, row: p.row + dRow })));
      if (wire) wires.push(wire);
    }
    this.tidyJunctions(); // changes something only for an inconsistent state
    return {
      parts,
      wires: wires.filter((w) => this.wires.includes(w)),
      junctions: junctions.filter((j) => this.junctions.includes(j)),
    };
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
    // Corners of the wires between these parts, and their junctions, turn with them.
    const inner = this.within(new Set(parts.map((p) => p.id)));
    for (const point of [...inner.wires.flatMap((wire) => wire.waypoints), ...inner.junctions]) {
      const dy = point.row - box.row;
      point.row = top + (point.col - box.col);
      point.col = left + h - dy;
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
