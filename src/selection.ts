// The selected parts and wires, and the commands that act on them.
// The ids live on the view (it draws the highlights); this wraps them.

import { flipGroup } from './flip';
import type { GridView } from './grid';
import { boundsOf, type CellBox, type FlipAxis, type PlacedPart, type Scene, type Wire } from './model';
import { pathBounds, wireRoute } from './pins';

export class Selection {
  constructor(
    private readonly view: GridView,
    private readonly scene: Scene,
  ) {}

  get partIds(): Set<number> {
    return this.view.selected;
  }

  get wireIds(): Set<number> {
    return this.view.selectedWires;
  }

  get empty(): boolean {
    return this.partIds.size === 0 && this.wireIds.size === 0;
  }

  /** Selected parts in draw order, so copies and moves keep the stacking. */
  parts(): PlacedPart[] {
    return this.scene.parts.filter((p) => this.partIds.has(p.id));
  }

  wires(): Wire[] {
    return this.scene.wires.filter((w) => this.wireIds.has(w.id));
  }

  set(partIds: Iterable<number>, wireIds: Iterable<number> = []): void {
    this.partIds.clear();
    this.wireIds.clear();
    for (const id of partIds) this.partIds.add(id);
    for (const id of wireIds) this.wireIds.add(id);
    this.view.requestRender();
  }

  clear(): void {
    this.set([]);
  }

  selectAll(): void {
    this.set(this.scene.parts.map((p) => p.id), this.scene.wires.map((w) => w.id));
  }

  /** Cell box around everything selected, or null for nothing. */
  bounds(): CellBox | null {
    const parts = boundsOf(this.parts());
    const paths = this.wires().flatMap((w) => wireRoute(this.scene, w) ?? []);
    const wires = pathBounds([paths]);
    if (!parts || !wires) return parts ?? wires;
    const col = Math.min(parts.col, wires.col);
    const row = Math.min(parts.row, wires.row);
    return {
      col, row,
      cols: Math.max(parts.col + parts.cols, wires.col + wires.cols) - col,
      rows: Math.max(parts.row + parts.rows, wires.row + wires.rows) - row,
    };
  }

  /** Rotate the selected parts 90 degrees clockwise (as one block when several). */
  rotate(): boolean {
    const parts = this.parts();
    if (parts.length === 0) return false;
    if (parts.length === 1) this.scene.rotate(parts[0]);
    else this.scene.rotateGroup(parts);
    this.view.requestRender();
    return true;
  }

  /**
   * Mirror the selected parts on screen ('h': left/right, 'v': top/bottom),
   * as one block around their bounding box's centre when several (see
   * flip.ts). False when no selected part can be mirrored.
   */
  flip(axis: FlipAxis): boolean {
    if (!flipGroup(this.scene, this.parts(), axis)) return false;
    this.view.requestRender();
    return true;
  }

  /**
   * Delete the selected wires and parts (a part takes its wires with it).
   * Junctions left with fewer than three wires are tidied (Scene.tidyJunctions).
   */
  remove(): void {
    this.scene.removeMany(this.partIds, this.wireIds);
    this.clear();
  }

  /** Copy the selected parts, and the wires and junctions between them, one cell down-right. */
  duplicate(): void {
    if (this.partIds.size === 0) return;
    const copy = this.scene.insert(this.scene.snapshot(this.partIds), 1, 1);
    this.set(copy.parts.map((p) => p.id), copy.wires.map((w) => w.id));
  }
}
