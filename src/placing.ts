// Dragging a new part from the parts menu onto the grid.

import { GRID_SIZE, type GridView } from './grid';
import {
  flipOrientation, isMirrorable, nextRotation, rotatedSize, setOrientation, type FlipAxis, type PlacedPart, type Rotation, type Scene,
} from './model';
import { getPart } from './parts';
import { partImageUrl } from './sprites';

/** Top-left cell that centres a part of `size` cells on a (fractional) cell, snapped to the grid. */
export function centreOnCell(cell: { col: number; row: number }, size: { cols: number; rows: number }): { col: number; row: number } {
  return { col: Math.round(cell.col - size.cols / 2), row: Math.round(cell.row - size.rows / 2) };
}

/**
 * The first spot at or after `start`, stepping one cell down and right at a
 * time, that `isTaken` does not claim: pressing Enter on the same menu tile
 * twice gives two parts side by side instead of one on top of the other.
 */
export function freeSpot(
  start: { col: number; row: number },
  isTaken: (col: number, row: number) => boolean,
  maxSteps = 40,
): { col: number; row: number } {
  let { col, row } = start;
  for (let i = 0; i < maxSteps && isTaken(col, row); i++) {
    col += 1;
    row += 1;
  }
  return { col, row };
}

interface Placing {
  typeId: string;
  rotation: Rotation;
  mirrorX?: boolean;
  mirrorY?: boolean;
  float: HTMLImageElement; // shown under the cursor while it is over the menu
  pointerId: number;
  lastX: number;
  lastY: number;
}

export class Placer {
  private placing: Placing | null = null;

  constructor(
    private readonly view: GridView,
    private readonly scene: Scene,
    /** Called with the new part after a drop on the grid. */
    private readonly onPlaced: (part: PlacedPart, clientX: number, clientY: number) => void,
  ) {}

  get active(): boolean {
    return this.placing !== null;
  }

  /** Start dragging a new part from the menu. Call from a pointerdown. */
  start(typeId: string, e: PointerEvent): void {
    const type = getPart(typeId);
    if (!type || this.placing) return;
    e.preventDefault();

    const float = document.createElement('img');
    float.className = 'drag-float';
    float.src = partImageUrl(type);
    float.draggable = false;
    document.body.appendChild(float);

    // Capture the pointer so the release is seen even outside the window.
    if (e.target instanceof Element) e.target.setPointerCapture(e.pointerId);

    this.placing = { typeId, rotation: 0, float, pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
    document.documentElement.classList.add('gh-placing');
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.end);
    window.addEventListener('blur', this.end);
    this.update(e.clientX, e.clientY);
  }

  /**
   * Add a part in the middle of the visible grid without dragging (for the
   * keyboard). Steps off a part already standing there. Returns the new part,
   * or null when the grid has no size (hidden) or a drag is in progress.
   */
  addAtCentre(typeId: string): PlacedPart | null {
    if (this.placing || !getPart(typeId)) return null;
    const rect = this.view.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const { cols, rows } = rotatedSize(typeId, 0);
    const start = centreOnCell(this.view.toCell(rect.left + rect.width / 2, rect.top + rect.height / 2), { cols, rows });
    const spot = freeSpot(start, (col, row) => this.scene.parts.some((q) => q.col === col && q.row === row));
    const part = this.scene.add({ typeId, rotation: 0, ...spot });
    this.view.requestRender();
    return part;
  }

  rotate(): void {
    const p = this.placing;
    if (!p) return;
    p.rotation = nextRotation(p.rotation);
    this.update(p.lastX, p.lastY);
  }

  /** Mirror the part being placed (not for boards). */
  flip(axis: FlipAxis): void {
    const p = this.placing;
    if (!p || !isMirrorable(p.typeId)) return;
    setOrientation(p, flipOrientation(p, axis));
    this.update(p.lastX, p.lastY);
  }

  /** Re-place the ghost after the camera moved under a still cursor. */
  refresh(): void {
    if (this.placing) this.update(this.placing.lastX, this.placing.lastY);
  }

  private onMove = (e: PointerEvent): void => {
    if (!this.placing || e.pointerId !== this.placing.pointerId) return;
    // A move with no button held means the release was missed: drop now.
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) this.drop(e.clientX, e.clientY);
    else this.update(e.clientX, e.clientY);
  };

  private onUp = (e: PointerEvent): void => {
    if (this.placing && e.pointerId === this.placing.pointerId) this.drop(e.clientX, e.clientY);
  };

  private drop(x: number, y: number): void {
    // Use the release position: a pointerup can arrive without a final move.
    this.update(x, y);
    const ghost = this.view.ghost;
    const part = ghost && this.overGrid(x, y) ? this.scene.add(ghost) : null;
    this.end();
    if (part) this.onPlaced(part, x, y);
  }

  private update(x: number, y: number): void {
    const p = this.placing;
    if (!p) return;
    p.lastX = x;
    p.lastY = y;
    if (this.overGrid(x, y)) {
      // Centre the part under the cursor, then snap to the grid.
      const { cols, rows } = rotatedSize(p.typeId, p.rotation);
      const cell = this.view.toCell(x, y);
      this.view.ghost = {
        typeId: p.typeId,
        rotation: p.rotation,
        ...(p.mirrorX ? { mirrorX: true } : {}),
        ...(p.mirrorY ? { mirrorY: true } : {}),
        ...centreOnCell(cell, { cols, rows }),
      };
      p.float.style.display = 'none';
    } else {
      // Same size as on the grid at the current zoom.
      const type = getPart(p.typeId);
      const cell = GRID_SIZE * this.view.camera.zoom;
      this.view.ghost = null;
      p.float.style.display = '';
      p.float.style.width = `${(type?.cols ?? 1) * cell}px`;
      p.float.style.height = `${(type?.rows ?? 1) * cell}px`;
      p.float.style.left = `${x}px`;
      p.float.style.top = `${y}px`;
      // CSS applies the right-most function first: mirror, then rotate (as on the grid).
      const mirror = p.mirrorX || p.mirrorY ? ` scale(${p.mirrorX ? -1 : 1}, ${p.mirrorY ? -1 : 1})` : '';
      p.float.style.transform = `translate(-50%, -50%) rotate(${p.rotation}deg)${mirror}`;
    }
    this.view.requestRender();
  }

  end = (): void => {
    if (!this.placing) return;
    this.placing.float.remove();
    this.placing = null;
    this.view.ghost = null;
    document.documentElement.classList.remove('gh-placing');
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.end);
    window.removeEventListener('blur', this.end);
    this.view.requestRender();
  };

  /** True when the point is over the bare grid (not the menu or a button). */
  private overGrid(x: number, y: number): boolean {
    return document.elementFromPoint(x, y) === this.view.canvas;
  }
}
