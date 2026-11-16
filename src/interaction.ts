// Editing on the grid: selecting (click, Shift+click, selection box),
// moving, rotating, duplicating and deleting placed parts. Placing new
// parts from the menu lives in placing.ts, the buttons in toolbar.ts.

import type { GridView } from './grid';
import { boundsOf, boxesOverlap, footprint, type PlacedPart, type Scene } from './model';
import { Placer } from './placing';
import { Toolbar, createZoomReadout } from './toolbar';

const DRAG_THRESHOLD = 3; // CSS pixels before a press becomes a drag

interface Moving {
  kind: 'move';
  anchor: PlacedPart; // the part under the cursor
  parts: PlacedPart[]; // every part that moves (the selection)
  offsetCol: number; // grab point relative to the anchor's top-left cell
  offsetRow: number;
  starts: Map<PlacedPart, { col: number; row: number }>;
  /** Plain click on a part of a multi-selection: select only it if it never moved. */
  narrowTo: number | null;
  moved: boolean;
  downX: number;
  downY: number;
}

interface Marquee {
  kind: 'marquee';
  startCol: number;
  startRow: number;
  base: Set<number>; // selection kept underneath (Shift adds to it)
  active: boolean; // past the drag threshold
  downX: number;
  downY: number;
}

export class Editor {
  private readonly placer: Placer;
  private readonly toolbar: Toolbar;
  private readonly updateZoomReadout: () => void;
  private drag: Moving | Marquee | null = null;
  private pointer: { x: number; y: number } | null = null; // last position over the canvas

  constructor(
    private readonly view: GridView,
    private readonly scene: Scene,
  ) {
    const canvas = view.canvas;
    canvas.addEventListener('pointerdown', this.onCanvasDown);
    canvas.addEventListener('pointermove', this.onCanvasMove);
    canvas.addEventListener('pointerup', this.onCanvasUp);
    canvas.addEventListener('pointercancel', this.onCanvasUp);
    canvas.addEventListener('pointerleave', () => {
      if (!this.drag) this.setHover(null);
    });
    window.addEventListener('keydown', this.onKeyDown);
    // The menu slides open/closed: keep the toolbar out from under it.
    document.addEventListener('transitionend', view.requestRender);

    this.placer = new Placer(view, scene, (part, x, y) => {
      this.selectOnly(part.id);
      this.pointer = { x, y };
      this.refreshHover();
    });
    this.toolbar = new Toolbar(canvas, {
      rotate: () => this.rotateSelected(),
      duplicate: () => this.duplicateSelected(),
      delete: () => this.deleteSelected(),
    });
    this.updateZoomReadout = createZoomReadout(
      () => view.camera.zoom,
      () => view.setZoom(1),
    );

    view.renderListeners.push(this.positionOverlays);
    view.onCameraChange = this.onCameraChange;
    this.positionOverlays();
  }

  /** Start dragging a new part from the menu. Call from a pointerdown. */
  startPlacing(typeId: string, e: PointerEvent): void {
    if (this.placer.active || this.drag) return;
    this.clearSelection();
    this.placer.start(typeId, e);
  }

  // ---- Pointer on the canvas -------------------------------------------

  private onCanvasDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.placer.active || this.drag) return;
    this.pointer = { x: e.clientX, y: e.clientY };
    const cell = this.view.toCell(e.clientX, e.clientY);
    const part = this.scene.partAt(cell.col, cell.row);
    const sel = this.view.selected;

    if (!part) {
      // Empty grid: start a selection box (Shift keeps the current selection).
      const base = e.shiftKey ? new Set(sel) : new Set<number>();
      if (!e.shiftKey) this.clearSelection();
      this.drag = {
        kind: 'marquee', startCol: cell.col, startRow: cell.row, base, active: false,
        downX: e.clientX, downY: e.clientY,
      };
    } else {
      let narrowTo: number | null = null;
      if (e.shiftKey) {
        if (sel.has(part.id)) {
          sel.delete(part.id);
          this.view.requestRender();
          return; // toggled out: nothing to drag
        }
        sel.add(part.id);
      } else if (!sel.has(part.id)) {
        this.selectOnly(part.id);
      } else if (sel.size > 1) {
        narrowTo = part.id;
      }
      this.startMove(part, cell, e.clientX, e.clientY, narrowTo);
    }
    this.view.canvas.setPointerCapture(e.pointerId);
    this.updateCursor();
    this.view.requestRender();
  };

  private startMove(anchor: PlacedPart, cell: { col: number; row: number }, x: number, y: number, narrowTo: number | null): void {
    const parts = this.selectedParts();
    for (const p of parts) this.scene.bringToFront(p.id);
    this.drag = {
      kind: 'move', anchor, parts,
      offsetCol: cell.col - anchor.col,
      offsetRow: cell.row - anchor.row,
      starts: new Map(parts.map((p) => [p, { col: p.col, row: p.row }])),
      narrowTo, moved: false, downX: x, downY: y,
    };
  }

  private onCanvasMove = (e: PointerEvent): void => {
    if (this.placer.active) return;
    this.pointer = { x: e.clientX, y: e.clientY };
    if (this.view.isPanning) return;
    if (this.drag) this.updateDrag(e.clientX, e.clientY);
    else this.refreshHover();
  };

  private updateDrag(x: number, y: number): void {
    const d = this.drag;
    if (!d) return;
    const cell = this.view.toCell(x, y);
    const far = Math.hypot(x - d.downX, y - d.downY) >= DRAG_THRESHOLD;

    if (d.kind === 'move') {
      const start = d.starts.get(d.anchor);
      if (!start) return;
      const dc = Math.round(cell.col - d.offsetCol) - start.col;
      const dr = Math.round(cell.row - d.offsetRow) - start.row;
      if (dc !== d.anchor.col - start.col || dr !== d.anchor.row - start.row) {
        for (const p of d.parts) {
          const s = d.starts.get(p);
          if (!s) continue;
          p.col = s.col + dc;
          p.row = s.row + dr;
        }
        d.moved = true;
        this.view.requestRender();
      }
      return;
    }

    if (!d.active && !far) return;
    d.active = true;
    const box = {
      col: Math.min(d.startCol, cell.col),
      row: Math.min(d.startRow, cell.row),
      cols: Math.abs(cell.col - d.startCol),
      rows: Math.abs(cell.row - d.startRow),
    };
    this.view.marquee = box;
    // Live preview: the parts touched by the box join the base selection.
    const sel = this.view.selected;
    sel.clear();
    for (const id of d.base) sel.add(id);
    for (const p of this.scene.parts) if (boxesOverlap(box, footprint(p))) sel.add(p.id);
    this.view.requestRender();
  }

  private onCanvasUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || (e.type === 'pointerup' && e.button !== 0)) return;
    if (e.type === 'pointerup') this.updateDrag(e.clientX, e.clientY);
    if (d.kind === 'move' && !d.moved && d.narrowTo !== null) this.selectOnly(d.narrowTo);
    this.endDrag();
    if (this.view.canvas.hasPointerCapture(e.pointerId)) this.view.canvas.releasePointerCapture(e.pointerId);
    this.refreshHover();
  };

  private endDrag(): void {
    this.drag = null;
    this.view.marquee = null;
    this.updateCursor();
    this.view.requestRender();
  }

  /** Escape during a drag: put everything back. */
  private cancelDrag(): void {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'move') {
      for (const [p, s] of d.starts) {
        p.col = s.col;
        p.row = s.row;
      }
    } else {
      this.setSelection(d.base);
    }
    this.endDrag();
  }

  /** The camera moved under a still cursor: keep the dragged things under it. */
  private onCameraChange = (): void => {
    this.placer.refresh();
    if (this.drag && this.pointer) this.updateDrag(this.pointer.x, this.pointer.y);
  };

  // ---- Selection and hover ---------------------------------------------

  private selectedParts(): PlacedPart[] {
    // In draw order, so copies and moves keep the stacking.
    return this.scene.parts.filter((p) => this.view.selected.has(p.id));
  }

  private setSelection(ids: Iterable<number>): void {
    this.view.selected.clear();
    for (const id of ids) this.view.selected.add(id);
    this.view.requestRender();
  }

  private selectOnly(id: number): void {
    this.setSelection([id]);
  }

  private clearSelection(): void {
    this.setSelection([]);
  }

  private refreshHover(): void {
    const p = this.pointer;
    if (!p || this.drag || this.placer.active) return;
    const over = document.elementFromPoint(p.x, p.y) === this.view.canvas;
    const cell = this.view.toCell(p.x, p.y);
    this.setHover(over ? (this.scene.partAt(cell.col, cell.row)?.id ?? null) : null);
  }

  private setHover(id: number | null): void {
    if (this.view.hoverId === id) return;
    this.view.hoverId = id;
    this.updateCursor();
    this.view.requestRender();
  }

  private updateCursor(): void {
    if (this.view.isPanning) return;
    const moving = this.drag?.kind === 'move';
    this.view.canvas.style.cursor = moving ? 'grabbing' : this.view.hoverId !== null ? 'grab' : '';
  }

  // ---- Commands --------------------------------------------------------

  private rotateSelected(): void {
    const parts = this.selectedParts();
    if (parts.length === 0) return;
    if (parts.length === 1) this.scene.rotate(parts[0]);
    else this.scene.rotateGroup(parts);
    // Rotating mid-drag: continue the drag from the rotated positions.
    const d = this.drag;
    if (d?.kind === 'move' && this.pointer) {
      const cell = this.view.toCell(this.pointer.x, this.pointer.y);
      const b = footprint(d.anchor);
      const col = Math.min(Math.max(cell.col, b.col + 0.5), b.col + b.cols - 0.5);
      const row = Math.min(Math.max(cell.row, b.row + 0.5), b.row + b.rows - 0.5);
      this.startMove(d.anchor, { col, row }, d.downX, d.downY, null);
      if (this.drag?.kind === 'move') this.drag.moved = d.moved;
    }
    this.view.requestRender();
  }

  private deleteSelected(): void {
    if (this.view.selected.size === 0) return;
    if (this.drag?.kind === 'move') this.drag = null;
    for (const id of this.view.selected) {
      this.scene.remove(id);
      if (this.view.hoverId === id) this.view.hoverId = null;
    }
    this.clearSelection();
    this.updateCursor();
  }

  /** Copy the selection one cell down-right and select the copies. */
  private duplicateSelected(): void {
    if (this.drag) return;
    const copies = this.selectedParts().map((p) =>
      this.scene.add({ typeId: p.typeId, rotation: p.rotation, col: p.col + 1, row: p.row + 1 }),
    );
    if (copies.length) this.setSelection(copies.map((p) => p.id));
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (e.key === 'Escape') {
      if (this.placer.active) this.placer.end();
      else if (this.drag) this.cancelDrag();
      else this.clearSelection();
    } else if (key === 'r' && !mod && !e.altKey) {
      if (this.placer.active) this.placer.rotate();
      else this.rotateSelected();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !this.placer.active) {
      this.deleteSelected();
    } else if (mod && key === 'd') {
      this.duplicateSelected();
    } else if (mod && key === 'a') {
      if (!this.placer.active && !this.drag) this.setSelection(this.scene.parts.map((p) => p.id));
    } else {
      return;
    }
    e.preventDefault();
  };

  // ---- Overlays --------------------------------------------------------

  private positionOverlays = (): void => {
    this.updateZoomReadout();
    const box = boundsOf(this.selectedParts());
    // Hide while something is actually being dragged (not on a plain click).
    const d = this.drag;
    const busy = this.placer.active || (d !== null && (d.kind === 'move' ? d.moved : d.active));
    this.toolbar.show(box && !busy ? this.view.toScreen(box) : null);
  };
}
