// Drawing a wire: press (or click) a pin, then release (or click) on another
// pin. Clicking empty grid points on the way adds corners.

import type { GridView } from './grid';
import { samePin, type PinRef, type Scene, type Wire } from './model';
import { pinAt } from './pins';

/** How close (in cells) the cursor must be to a pin to grab it: about 9 px. */
export function pinRadius(view: GridView): number {
  return Math.min(0.45, 9 / view.cellPx);
}

export class WireTool {
  constructor(
    private readonly view: GridView,
    private readonly scene: Scene,
  ) {}

  get active(): boolean {
    return this.view.draft !== null;
  }

  start(from: PinRef, clientX: number, clientY: number): void {
    this.view.draft = { from, waypoints: [], end: { col: 0, row: 0 }, endPin: null };
    this.move(clientX, clientY);
  }

  /** Follow the cursor: the end snaps to the grid, or to a pin when one is near. */
  move(clientX: number, clientY: number): void {
    const draft = this.view.draft;
    if (!draft) return;
    const cell = this.view.toCell(clientX, clientY);
    const pin = pinAt(this.scene, cell.col, cell.row, pinRadius(this.view));
    draft.endPin = pin && !samePin(pin.ref, draft.from) ? pin.ref : null;
    draft.end = pin ? { col: pin.col, row: pin.row } : { col: Math.round(cell.col), row: Math.round(cell.row) };
    this.view.requestRender();
  }

  /**
   * The mouse button was released at this point: on a pin it finishes the
   * wire (returned), on the grid it adds a corner. Releasing on the start
   * pin does nothing, so a plain click on a pin starts click-by-click wiring.
   */
  release(clientX: number, clientY: number): Wire | null {
    this.move(clientX, clientY);
    const draft = this.view.draft;
    if (!draft) return null;
    if (draft.endPin) {
      const wire = this.scene.addWire(draft.from, draft.endPin, draft.waypoints);
      this.cancel();
      return wire;
    }
    const start = pinAt(this.scene, draft.end.col, draft.end.row, 0.01);
    const last = draft.waypoints[draft.waypoints.length - 1];
    const repeated = last !== undefined && last.col === draft.end.col && last.row === draft.end.row;
    if (!start && !repeated) draft.waypoints.push({ ...draft.end });
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
