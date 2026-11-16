// Dragging a new part from the parts menu onto the grid.

import { GRID_SIZE, type GridView } from './grid';
import { nextRotation, rotatedSize, type PlacedPart, type Rotation, type Scene } from './model';
import { getPart } from './parts';
import { partImageUrl } from './sprites';

interface Placing {
  typeId: string;
  rotation: Rotation;
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

  rotate(): void {
    const p = this.placing;
    if (!p) return;
    p.rotation = nextRotation(p.rotation);
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
        col: Math.round(cell.col - cols / 2),
        row: Math.round(cell.row - rows / 2),
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
      p.float.style.transform = `translate(-50%, -50%) rotate(${p.rotation}deg)`;
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
