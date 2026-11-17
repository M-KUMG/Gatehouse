// Undo / redo history of the circuit. Each step is a snapshot of the same
// plain data a project file holds (parts with their state, wires,
// junctions, the boards' source files; never the camera, selection or simulation). Snapshots are deep
// copies, so later edits of the scene cannot change them. No DOM here.
//
// Live interaction state (switch and button contacts, knob positions,
// burned parts) is stored in a part's state too, but flipping a switch is
// using the circuit, not editing it: those fields are left out when deciding
// whether something changed, and undo/redo keeps their current values for
// parts that still exist.

import type { PartState, PlacedPart } from '../model';
import type { Circuit } from './format';

/** PartState fields that are simulation interaction, not circuit edits. */
export const LIVE_STATE_FIELDS = ['closed', 'position', 'burned'] as const satisfies readonly (keyof PartState)[];

/** Most undo steps kept; the oldest are dropped. */
export const HISTORY_LIMIT = 100;

/**
 * Edits of the same kind closer together than this (ms) become one step:
 * a held R key or Ctrl+D, or quick repeats on the same parts.
 */
export const COALESCE_MS = 700;

export function copyCircuit(c: Circuit): Circuit {
  return JSON.parse(JSON.stringify({ parts: c.parts, wires: c.wires, junctions: c.junctions, files: c.files })) as Circuit;
}

function withoutLive(state: PartState | undefined): PartState | undefined {
  if (!state) return undefined;
  const out: PartState = { ...state };
  for (const field of LIVE_STATE_FIELDS) delete out[field];
  return out;
}

/** What counts as an edit: the circuit without live interaction state. */
export function editKey(c: Circuit): string {
  const parts = c.parts.map((p) => ({ ...p, state: withoutLive(p.state) }));
  return JSON.stringify([parts, c.wires, c.junctions, c.files]);
}

/**
 * `target` (changed in place and returned) with the live interaction state
 * of the parts in `live` that still exist as the same type. Fields that
 * already match are left alone, so the key order (and the project's
 * clean/dirty comparison) stays as it was.
 */
export function withLiveState(target: Circuit, live: readonly PlacedPart[]): Circuit {
  const byId = new Map(live.map((p) => [p.id, p]));
  for (const part of target.parts) {
    const now = byId.get(part.id);
    if (!now || now.typeId !== part.typeId) continue;
    for (const field of LIVE_STATE_FIELDS) {
      const value = now.state?.[field];
      if (value === undefined) {
        if (part.state && field in part.state) delete part.state[field];
      } else if (part.state?.[field] !== value) {
        part.state = { ...part.state, [field]: value };
      }
    }
  }
  return target;
}

type Kind = 'add' | 'remove' | 'modify' | 'mixed';

interface Entry {
  circuit: Circuit;
  key: string;
}

/** Ids of everything in a circuit, and each thing's text, for comparing two snapshots. */
function items(c: Circuit): Map<string, string> {
  const out = new Map<string, string>();
  const parts = c.parts.map((p) => ({ ...p, state: withoutLive(p.state) }));
  for (const p of parts) out.set(`p${p.id}`, JSON.stringify(p));
  for (const w of c.wires) out.set(`w${w.id}`, JSON.stringify(w));
  for (const j of c.junctions) out.set(`j${j.id}`, JSON.stringify(j));
  // One item per board's tree: typing in one file coalesces like other repeated edits.
  for (const [boardId, tree] of Object.entries(c.files)) out.set(`f${boardId}`, JSON.stringify(tree));
  return out;
}

/** How `next` differs from `prev`, and which items changed (for `modify`). */
function compare(prev: Circuit, next: Circuit): { kind: Kind; changed: string } {
  const a = items(prev);
  const b = items(next);
  const added = [...b.keys()].some((k) => !a.has(k));
  const removed = [...a.keys()].some((k) => !b.has(k));
  if (added || removed) return { kind: added && removed ? 'mixed' : added ? 'add' : 'remove', changed: '' };
  const changed = [...b].filter(([k, text]) => a.get(k) !== text).map(([k]) => k);
  return { kind: 'modify', changed: changed.sort().join(',') };
}

export class History {
  private current: Entry;
  private readonly undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  /** The last recorded change, for coalescing. */
  private last: { at: number; kind: Kind; changed: string } | null = null;

  constructor(
    initial: Circuit,
    private readonly limit = HISTORY_LIMIT,
    private readonly coalesceMs = COALESCE_MS,
  ) {
    this.current = entry(initial);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Steps that can be undone (for tests and tooltips). */
  get depth(): number {
    return this.undoStack.length;
  }

  /** Forget everything; `circuit` is the new starting point (after New, Open, a restore). */
  reset(circuit: Circuit): void {
    this.current = entry(circuit);
    this.undoStack.length = 0;
    this.redoStack = [];
    this.last = null;
  }

  /**
   * The circuit as it is after a finished edit, at time `now` (ms). Adds a
   * step when it differs from the last one (ignoring live state), or folds
   * it into the last step when it is a quick repeat of the same kind of
   * edit. Returns true when the history changed.
   */
  record(circuit: Circuit, now: number): boolean {
    const next = entry(circuit);
    if (next.key === this.current.key) return false;
    const change = compare(this.current.circuit, next.circuit);
    const last = this.last;
    const merge =
      last !== null &&
      this.undoStack.length > 0 &&
      now - last.at <= this.coalesceMs &&
      change.kind === last.kind &&
      (change.kind === 'add' || (change.kind === 'modify' && change.changed === last.changed));
    if (merge) {
      // Repeats that end where the step started (R four times) leave no step.
      if (this.undoStack[this.undoStack.length - 1].key === next.key) {
        this.current = this.undoStack.pop() as Entry;
        this.current.circuit = next.circuit;
        this.last = null;
        this.redoStack = [];
        return true;
      }
    } else {
      this.push(this.current);
    }
    this.current = next;
    this.redoStack = [];
    this.last = { at: now, kind: change.kind, changed: change.changed };
    return true;
  }

  /**
   * Step back. `live` is the circuit right now: an unrecorded change is
   * recorded first (so it is what gets undone), and live interaction state
   * carries over. Returns the circuit to show, or null when there is
   * nothing to undo.
   */
  undo(live: Circuit): Circuit | null {
    return this.step(live, 'undo');
  }

  /** Step forward again; like undo. */
  redo(live: Circuit): Circuit | null {
    return this.step(live, 'redo');
  }

  private step(live: Circuit, direction: 'undo' | 'redo'): Circuit | null {
    const now = entry(live);
    if (now.key !== this.current.key) {
      // An edit not recorded yet: it becomes its own step (and clears redo).
      this.push(this.current);
      this.redoStack = [];
    }
    this.current = now; // keeps the newest live state for a later redo
    this.last = null;
    const [from, to] = direction === 'undo' ? [this.undoStack, this.redoStack] : [this.redoStack, this.undoStack];
    const target = from.pop();
    if (!target) return null;
    to.push(this.current);
    this.current = target;
    return withLiveState(copyCircuit(target.circuit), live.parts);
  }

  private push(e: Entry): void {
    this.undoStack.push(e);
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
  }
}

function entry(circuit: Circuit): Entry {
  const copy = copyCircuit(circuit);
  return { circuit: copy, key: editKey(copy) };
}
