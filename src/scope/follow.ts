// Which part the Scope window (src/layout/inspector.ts) shows, as plain
// state (no DOM), and how its values read as text.
//
// Following: the window shows the selected part. With several parts
// selected it shows the PRIMARY one: the last part added to the selection
// (the selection is an insertion-ordered set, so that is the last one
// Shift+clicked, or the last in drawing order after a box selection).
// Selected wires are ignored. With nothing selected it shows nothing (a
// hint). Pinning keeps the window on one part whatever is selected, until
// it is unpinned or the part is deleted (then it follows again).

import { formatSI } from '../format';
import type { Quantity } from '../sim/inspect';

export class PartFollower {
  /** The pinned part, or null while following the selection. */
  pinned: number | null = null;

  /**
   * The part to show: the pinned one while it exists, else the primary
   * selected part that exists (`exists` filters out stale ids), else null.
   */
  current(selected: Iterable<number>, exists: (id: number) => boolean): number | null {
    if (this.pinned !== null) {
      if (exists(this.pinned)) return this.pinned;
      this.pinned = null; // deleted: follow again
    }
    let last: number | null = null;
    for (const id of selected) if (exists(id)) last = id;
    return last;
  }

  /** Pin to `id` (null: follow the selection again). */
  pin(id: number | null): void {
    this.pinned = id;
  }
}

/** A quantity as text for the table: "21.3 mA", "active", "–" for an undefined number. */
export function formatQuantity(q: Quantity): string {
  if (q.kind === 'text') return q.text ?? '';
  if (!Number.isFinite(q.value)) return '–';
  if (q.unit === '%') return `${Number(q.value.toFixed(q.value < 10 ? 1 : 0))} %`;
  if (q.unit === '') return Math.abs(q.value) >= 1000 ? q.value.toExponential(2) : String(Number(q.value.toPrecision(3)));
  return formatSI(q.value, q.unit);
}

/** A sampled value in the unit of `q` (same rules as formatQuantity). */
export function formatValue(q: Pick<Quantity, 'unit' | 'kind'>, value: number): string {
  return formatQuantity({ id: '', label: '', kind: q.kind === 'text' ? 'ratio' : q.kind, unit: q.unit, value });
}
