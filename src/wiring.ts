// Drawing a wire: press (or click) a pin, or press on a wire and drag, then
// release (or click) on another pin or on any point of another wire.
// Clicking empty grid points on the way adds corners.

import type { GridView } from './grid';
import { anchorPoint, connect, isTap, sameAnchor, type Anchor } from './junctions';
import { isPinEnd, samePin, type Scene, type Wire } from './model';
import { pinAt, wirePointAt } from './pins';

/** How close (in cells) the cursor must be to a pin to grab it: about 9 px. */
export function pinRadius(view: GridView): number {
  return Math.min(0.45, 9 / view.cellPx);
}

/** How close (in cells) the cursor must be to a wire to hit it: about 5 px. */
export function wireGrab(view: GridView): number {
  return 5 / view.cellPx;
}

export class WireTool {
  constructor(
    private readonly view: GridView,
    private readonly scene: Scene,
  ) {}

  get active(): boolean {
    return this.view.draft !== null;
  }

  start(from: Anchor, clientX: number, clientY: number): void {
    this.view.draft = { from, waypoints: [], end: { col: 0, row: 0 }, target: null };
    this.move(clientX, clientY);
  }

  /** Follow the cursor: the end snaps to a pin, else to the nearest grid point of a wire, else to the grid. */
  move(clientX: number, clientY: number): void {
    const draft = this.view.draft;
    if (!draft) return;
    const cell = this.view.toCell(clientX, clientY);
    const pin = pinAt(this.scene, cell.col, cell.row, pinRadius(this.view));
    draft.target = null;
    if (pin) {
      const own = !isTap(draft.from) && isPinEnd(draft.from) && samePin(pin.ref, draft.from);
      if (!own) draft.target = pin.ref;
      draft.end = { col: pin.col, row: pin.row };
    } else {
      const hit = wirePointAt(this.scene, cell.col, cell.row, wireGrab(this.view));
      const start = anchorPoint(this.scene, draft.from);
      const fromWire = isTap(draft.from) ? draft.from.wireId : null;
      if (hit && hit.wire.id !== fromWire && !(start && start.col === hit.point.col && start.row === hit.point.row)) {
        draft.target = { wireId: hit.wire.id, ...hit.point };
        draft.end = { ...hit.point };
      } else {
        draft.end = { col: Math.round(cell.col), row: Math.round(cell.row) };
      }
    }
    this.view.requestRender();
  }

  /**
   * The mouse button was released at this point: on a pin or a wire it
   * finishes the wire (returned), on the grid it adds a corner. Releasing
   * where the wire started does nothing, so a plain click on a pin starts
   * click-by-click wiring.
   */
  release(clientX: number, clientY: number): Wire | null {
    this.move(clientX, clientY);
    const draft = this.view.draft;
    if (!draft) return null;
    if (draft.target && !sameAnchor(draft.target, draft.from)) {
      const wire = connect(this.scene, draft.from, draft.target, draft.waypoints);
      this.cancel();
      return wire;
    }
    const start = anchorPoint(this.scene, draft.from);
    const atStart = start !== null && start.col === draft.end.col && start.row === draft.end.row;
    const onPin = pinAt(this.scene, draft.end.col, draft.end.row, 0.01) !== null;
    const last = draft.waypoints[draft.waypoints.length - 1];
    const repeated = last !== undefined && last.col === draft.end.col && last.row === draft.end.row;
    if (!atStart && !onPin && !repeated) draft.waypoints.push({ ...draft.end });
    this.view.requestRender();
    return null;
  }

  /** Remove the last corner. */
  undo(): void {
    this.view.draft?.waypoints.pop();
    this.view.requestRender();
  }

  cancel(): void {
    this.view.draft = null;
    this.view.requestRender();
  }
}
