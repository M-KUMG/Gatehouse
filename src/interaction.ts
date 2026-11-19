// Editing on the grid: decides what a press, drag, click or key means and
// hands the work to focused helpers: selection.ts (selection + commands),
// wiring.ts (drawing wires), controls.ts (buttons, switches, knobs),
// placing.ts (new parts from the menu), toolbar.ts / boardstatus.ts /
// readout.ts (overlays). A selected board gets Run / Reset / Serial console
// buttons and a status chip; its drawn reset button resets it on a click
// (boardcontrols.ts).

import { isOnReset, selectedBoard, toolbarButtons } from './boardcontrols';
import { BoardStatusChip } from './boardstatus';
import { clickPart, isOnKnob, knobPosition, knobPositionAt, setKnob, setPressed } from './controls';
import type { GridView } from './grid';
import { isTap, type WireTap } from './junctions';
import {
  boundsOf, boxesOverlap, footprint, isPinEnd, type FlipAxis, type GridPoint, type PinRef, type PlacedPart, type ProjectState, type Scene,
} from './model';
import { NameEditor } from './nameedit';
import { boardLabel, defaultBoardLabel, getPart } from './parts';
import { findPin, pinAt, wirePointAt, wireRoute } from './pins';
import type { FileOpResult } from './project/boardfiles';
import { Placer } from './placing';
import { Readout, describeJunction, describePart, describePin, describeWire, type ReadoutText } from './readout';
import { Selection } from './selection';
import type { Simulation } from './simulation';
import { Toolbar, createStatusLine, createZoomReadout } from './toolbar';
import { ValueEditor } from './valueedit';
import { WireTool, pinRadius, wireGrab } from './wiring';

const DRAG_THRESHOLD = 3; // CSS pixels before a press becomes a drag
const WHEEL_KNOB_STEP = 0.05; // knob travel per wheel notch
const WIRING_HINT =
  'Wiring: click a pin or a wire to finish · click the grid to add a corner · Backspace removes it · Esc cancels';

interface Cell {
  col: number;
  row: number;
}

interface Moving {
  kind: 'move';
  anchor: PlacedPart; // the part under the cursor
  parts: PlacedPart[]; // every part that moves (the selection)
  offsetCol: number; // grab point relative to the anchor's top-left cell
  offsetRow: number;
  starts: Map<PlacedPart, Cell>;
  /** Corners of the wires between the moving parts: they move along. */
  corners: Map<GridPoint, Cell>;
  /** Plain click on a part of a multi-selection: select only it if it never moved. */
  narrowTo: number | null;
  /** A release without movement counts as a click on the part (flips a switch). */
  click: boolean;
  /** The press was on the board's reset button: a click resets the board instead. */
  reset: boolean;
  moved: boolean;
  downX: number;
  downY: number;
}

interface Marquee {
  kind: 'marquee';
  startCol: number;
  startRow: number;
  base: Set<number>; // selection kept underneath (Shift adds to it)
  baseWires: Set<number>;
  active: boolean; // past the drag threshold
  downX: number;
  downY: number;
}

interface Turning {
  kind: 'knob';
  part: PlacedPart;
  start: number; // position to go back to on Escape
}

/** Pressed on a wire: a click selects it, dragging starts a new wire from the point. */
interface Tapping {
  kind: 'tap';
  tap: WireTap;
  downX: number;
  downY: number;
}

interface Hover {
  partId: number | null;
  wireId: number | null;
  /** Grid point on the hovered wire where a new wire would attach. */
  tap: GridPoint | null;
  pin: PinRef | null;
  onKnob: boolean;
  /** Over a board's reset button. */
  onReset: boolean;
}

const NO_HOVER: Hover = { partId: null, wireId: null, tap: null, pin: null, onKnob: false, onReset: false };

export class Editor {
  private readonly selection: Selection;
  private readonly placer: Placer;
  private readonly wiring: WireTool;
  private readonly toolbar: Toolbar;
  private readonly statusChip: BoardStatusChip;
  private readonly readout: Readout;
  private readonly valueEditor = new ValueEditor();
  private readonly nameEditor = new NameEditor();
  private readonly updateZoomReadout: () => void;
  private readonly setStatus: (text: string) => void;
  private drag: Moving | Marquee | Turning | Tapping | null = null;
  private pressed: PlacedPart | null = null; // push button held down by the mouse
  private onKnob = false;
  private onReset = false;
  private pointer: { x: number; y: number } | null = null; // last position over the canvas
  /** Return true for key presses the grid must leave alone (e.g. aimed at another window). */
  ignoreKey: ((e: KeyboardEvent) => boolean) | null = null;
  /** Ctrl+Z, and Ctrl+Y or Ctrl+Shift+Z, while the grid has the keyboard. */
  onUndo: (() => void) | null = null;
  onRedo: (() => void) | null = null;
  /** Space while the grid has the keyboard: the global Start / Pause. */
  onToggleTransport: (() => void) | null = null;
  /** Open (or bring forward) the Serial console showing this board (part id). */
  onOpenConsole: ((partId: number) => void) | null = null;
  /** Open (or bring forward) the Build output window showing this board (a click on the chip of a failed build). */
  onOpenBuildOutput: ((partId: number) => void) | null = null;
  /** Give a board (part id) a new display name; the project keeps the data (renameBoard). Empty input restores the default. */
  onRenameBoard: ((partId: number, input: string) => FileOpResult) | null = null;

  constructor(
    private readonly view: GridView,
    private readonly scene: Scene,
    private readonly sim: Simulation,
    /** The grid's area, for the zoom readout and status line in its bottom-left corner. */
    overlayParent: HTMLElement,
  ) {
    const canvas = view.canvas;
    this.readout = new Readout(() => canvas.getBoundingClientRect());
    this.setStatus = createStatusLine(overlayParent);
    canvas.addEventListener('pointerdown', this.onCanvasDown);
    canvas.addEventListener('pointermove', this.onCanvasMove);
    canvas.addEventListener('pointerup', this.onCanvasUp);
    canvas.addEventListener('pointercancel', this.onCanvasUp);
    canvas.addEventListener('dblclick', this.onDoubleClick);
    canvas.addEventListener('pointerleave', () => {
      if (this.drag || this.wiring.active) return;
      this.setHover(NO_HOVER);
      this.pointer = null;
    });
    window.addEventListener('keydown', this.onKeyDown);

    this.selection = new Selection(view, scene);
    this.wiring = new WireTool(view, scene);
    this.placer = new Placer(view, scene, (part, x, y) => {
      this.selection.set([part.id]);
      this.pointer = { x, y };
      this.refreshHover();
    });
    this.toolbar = new Toolbar(canvas, {
      rotate: () => this.rotateSelected(),
      flipH: () => this.flipSelected('h'),
      flipV: () => this.flipSelected('v'),
      duplicate: () => this.duplicateSelected(),
      edit: () => this.editValue(this.selection.parts()[0]),
      delete: () => this.deleteSelected(),
      run: () => this.toggleRun(),
      build: () => this.buildSelectedBoard(),
      reset: () => this.resetSelectedBoard(),
      console: () => {
        const board = selectedBoard(this.selection.parts());
        if (board) this.onOpenConsole?.(board.id);
      },
      rename: () => this.renameSelectedBoard(),
    });
    this.statusChip = new BoardStatusChip(canvas);
    this.statusChip.onClick = () => {
      const board = selectedBoard(this.selection.parts());
      if (board) this.onOpenBuildOutput?.(board.id);
    };
    this.updateZoomReadout = createZoomReadout(
      overlayParent,
      () => view.camera.zoom,
      () => view.setZoom(1),
    );

    view.renderListeners.push(this.positionOverlays);
    view.onCameraChange = this.onCameraChange;
    view.onWheel = this.onWheel;
    this.positionOverlays();
  }

  /** Start dragging a new part from the menu. Call from a pointerdown. */
  startPlacing(typeId: string, e: PointerEvent): void {
    if (this.placer.active || this.drag) return;
    this.wiring.cancel();
    this.closePopups();
    this.selection.clear();
    this.placer.start(typeId, e);
  }

  /** A gesture is half done (dragging, drawing a wire, placing a part, typing a value). */
  get busy(): boolean {
    return this.placer.active || this.wiring.active || this.drag !== null || this.valueEditor.isOpen || this.nameEditor.isOpen;
  }

  /** Drop the gesture in progress, putting back what a drag changed (e.g. before undo). */
  cancelGesture(): void {
    this.placer.end();
    this.wiring.cancel();
    this.closePopups();
    this.cancelDrag();
    this.setHover(NO_HOVER);
  }

  /** Drop everything in progress (drag, wire, placing, popup, selection), e.g. before a project loads. */
  reset(): void {
    this.cancelGesture();
    this.selection.clear();
  }

  /** The circuit was replaced (undo / redo): keep the selected things that still exist. */
  circuitRestored(): void {
    const parts = new Set(this.scene.parts.map((p) => p.id));
    const wires = new Set(this.scene.wires.map((w) => w.id));
    this.selection.set(
      [...this.selection.partIds].filter((id) => parts.has(id)),
      [...this.selection.wireIds].filter((id) => wires.has(id)),
    );
    this.refreshHover();
  }

  /**
   * Make this part the whole selection, as if it was clicked on the grid (a
   * board picked in the File explorer). False, and nothing changes, when the
   * part is gone or a gesture is in progress.
   */
  selectPart(partId: number): boolean {
    if (this.drag || this.placer.active || this.wiring.active || !this.scene.find(partId)) return false;
    this.closePopups();
    this.selection.set([partId]);
    return true;
  }

  /** Add a ready-made circuit below what is already there and show it. */
  loadExample(state: ProjectState): void {
    if (this.placer.active || this.drag) return;
    this.wiring.cancel();
    const existing = boundsOf(this.scene.parts);
    const incoming = boundsOf(state.parts);
    if (!incoming) return;
    const dCol = existing ? existing.col - incoming.col : 0;
    const dRow = existing ? existing.row + existing.rows + 4 - incoming.row : 0;
    const added = this.scene.insert(state, dCol, dRow);
    this.selection.set(added.parts.map((p) => p.id));
    const box = this.selection.bounds();
    if (box) this.view.centerOn(box);
  }

  // ---- Pointer on the canvas -------------------------------------------

  private onCanvasDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.placer.active || this.drag) return;
    this.closePopups();
    this.pointer = { x: e.clientX, y: e.clientY };
    const canvas = this.view.canvas;
    if (this.wiring.active) {
      canvas.setPointerCapture(e.pointerId); // the release decides what the click does
      return;
    }
    const cell = this.view.toCell(e.clientX, e.clientY);
    const sel = this.selection;

    const pin = pinAt(this.scene, cell.col, cell.row, pinRadius(this.view));
    if (pin) {
      sel.clear();
      this.setHover(NO_HOVER);
      this.wiring.start(pin.ref, e.clientX, e.clientY);
      canvas.setPointerCapture(e.pointerId);
      this.updateCursor();
      return;
    }

    const hit = wirePointAt(this.scene, cell.col, cell.row, wireGrab(this.view));
    if (hit) {
      const id = hit.wire.id;
      if (!e.shiftKey) {
        sel.set([], [id]);
        // Dragging away from here draws a new wire from this point instead.
        this.drag = { kind: 'tap', tap: { wireId: id, ...hit.point }, downX: e.clientX, downY: e.clientY };
        canvas.setPointerCapture(e.pointerId);
      } else if (!sel.wireIds.delete(id)) {
        sel.wireIds.add(id);
      }
      this.view.requestRender();
      return;
    }

    const part = this.scene.partAt(cell.col, cell.row);
    if (!part) {
      // Empty grid: start a selection box (Shift keeps the current selection).
      const base = new Set(e.shiftKey ? sel.partIds : []);
      const baseWires = new Set(e.shiftKey ? sel.wireIds : []);
      if (!e.shiftKey) sel.clear();
      this.drag = {
        kind: 'marquee', startCol: cell.col, startRow: cell.row, base, baseWires, active: false,
        downX: e.clientX, downY: e.clientY,
      };
    } else if (!e.shiftKey && isOnKnob(part, cell.col, cell.row)) {
      sel.set([part.id]);
      this.drag = { kind: 'knob', part, start: knobPosition(part) };
    } else {
      let narrowTo: number | null = null;
      if (e.shiftKey) {
        if (sel.partIds.delete(part.id)) {
          this.view.requestRender();
          return; // toggled out: nothing to drag
        }
        sel.partIds.add(part.id);
      } else if (!sel.partIds.has(part.id)) {
        sel.set([part.id]);
      } else if (sel.partIds.size > 1) {
        narrowTo = part.id;
      }
      this.startMove(part, cell, e.clientX, e.clientY, narrowTo, !e.shiftKey, !e.shiftKey && isOnReset(part, cell.col, cell.row));
      if (!e.shiftKey && setPressed(part, true)) this.pressed = part;
    }
    canvas.setPointerCapture(e.pointerId);
    this.updateCursor();
    this.view.requestRender();
  };

  private startMove(anchor: PlacedPart, cell: Cell, x: number, y: number, narrowTo: number | null, click: boolean, reset = false): void {
    const parts = this.selection.parts();
    for (const p of parts) this.scene.bringToFront(p.id);
    // Corners of the wires between the moving parts, and junctions only those wires use, move along.
    const inner = this.scene.within(this.selection.partIds);
    const corners: GridPoint[] = [...inner.wires.flatMap((w) => w.waypoints), ...inner.junctions];
    this.drag = {
      kind: 'move', anchor, parts,
      offsetCol: cell.col - anchor.col,
      offsetRow: cell.row - anchor.row,
      starts: new Map(parts.map((p) => [p, { col: p.col, row: p.row }])),
      corners: new Map(corners.map((c) => [c, { col: c.col, row: c.row }])),
      narrowTo, click, reset, moved: false, downX: x, downY: y,
    };
  }

  private onCanvasMove = (e: PointerEvent): void => {
    if (this.placer.active) return;
    this.pointer = { x: e.clientX, y: e.clientY };
    if (this.view.isPanning) return;
    if (this.wiring.active) this.wiring.move(e.clientX, e.clientY);
    else if (this.drag) this.updateDrag(e.clientX, e.clientY);
    else this.refreshHover();
  };

  private updateDrag(x: number, y: number): void {
    const d = this.drag;
    if (!d) return;
    const cell = this.view.toCell(x, y);

    if (d.kind === 'tap') {
      if (Math.hypot(x - d.downX, y - d.downY) < DRAG_THRESHOLD) return;
      // Dragged off the wire's point: draw a new wire from there (release finishes or adds a corner, as from a pin).
      this.drag = null;
      this.selection.clear();
      this.setHover(NO_HOVER);
      this.wiring.start(d.tap, x, y);
      this.updateCursor();
      return;
    }

    if (d.kind === 'knob') {
      const position = knobPositionAt(d.part, cell.col, cell.row);
      // Ignore the jump across the gap at the bottom of the knob's travel.
      if (position !== null && Math.abs(position - knobPosition(d.part)) < 0.6) setKnob(d.part, position);
      this.view.requestRender();
      return;
    }

    if (d.kind === 'move') {
      const start = d.starts.get(d.anchor);
      if (!start) return;
      const dc = Math.round(cell.col - d.offsetCol) - start.col;
      const dr = Math.round(cell.row - d.offsetRow) - start.row;
      if (dc !== d.anchor.col - start.col || dr !== d.anchor.row - start.row) {
        for (const [thing, s] of [...d.starts, ...d.corners]) {
          thing.col = s.col + dc;
          thing.row = s.row + dr;
        }
        d.moved = true;
        this.releasePressed(); // it is being carried, not pushed
        this.view.requestRender();
      }
      return;
    }

    if (!d.active && Math.hypot(x - d.downX, y - d.downY) < DRAG_THRESHOLD) return;
    d.active = true;
    const box = {
      col: Math.min(d.startCol, cell.col),
      row: Math.min(d.startRow, cell.row),
      cols: Math.abs(cell.col - d.startCol),
      rows: Math.abs(cell.row - d.startRow),
    };
    this.view.marquee = box;
    // Live preview: parts touched by the box and wires fully inside it join the base selection.
    const parts = this.scene.parts.filter((p) => boxesOverlap(box, footprint(p))).map((p) => p.id);
    const inside = (p: GridPoint): boolean =>
      p.col >= box.col && p.col <= box.col + box.cols && p.row >= box.row && p.row <= box.row + box.rows;
    const wires = this.scene.wires.filter((w) => wireRoute(this.scene, w)?.every(inside)).map((w) => w.id);
    this.selection.set([...d.base, ...parts], [...d.baseWires, ...wires]);
  }

  private onCanvasUp = (e: PointerEvent): void => {
    if (e.type === 'pointerup' && e.button !== 0) return;
    const canvas = this.view.canvas;
    if (this.wiring.active) {
      if (e.type === 'pointerup') this.wiring.release(e.clientX, e.clientY);
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      this.updateCursor();
      this.refreshHover();
      return;
    }
    const d = this.drag;
    if (!d) return;
    if (e.type === 'pointerup') this.updateDrag(e.clientX, e.clientY);
    if (d.kind === 'move' && !d.moved) {
      if (d.narrowTo !== null) this.selection.set([d.narrowTo]);
      if (d.click && e.type === 'pointerup' && !this.pressed) {
        if (d.reset) void this.sim.boards.resetBoard(d.anchor.id);
        else clickPart(d.anchor);
      }
    }
    this.endDrag();
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    this.refreshHover();
  };

  private onDoubleClick = (e: MouseEvent): void => {
    if (this.wiring.active || this.placer.active) return;
    const cell = this.view.toCell(e.clientX, e.clientY);
    this.editValue(this.scene.partAt(cell.col, cell.row));
  };

  private onWheel = (e: WheelEvent): boolean => {
    if (this.drag || this.placer.active || this.wiring.active || e.ctrlKey) return false;
    const cell = this.view.toCell(e.clientX, e.clientY);
    const part = this.scene.partAt(cell.col, cell.row);
    if (!part || !isOnKnob(part, cell.col, cell.row)) return false;
    setKnob(part, knobPosition(part) - Math.sign(e.deltaY) * WHEEL_KNOB_STEP);
    this.view.requestRender();
    return true;
  };

  private releasePressed(): void {
    if (this.pressed) setPressed(this.pressed, false);
    this.pressed = null;
  }

  private endDrag(): void {
    this.releasePressed();
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
      for (const [thing, s] of [...d.starts, ...d.corners]) {
        thing.col = s.col;
        thing.row = s.row;
      }
    } else if (d.kind === 'knob') {
      setKnob(d.part, d.start);
    } else if (d.kind === 'marquee') {
      this.selection.set(d.base, d.baseWires);
    }
    this.endDrag();
  }

  /** The camera moved under a still cursor: keep the dragged things under it. */
  private onCameraChange = (): void => {
    this.placer.refresh();
    if (!this.pointer) return;
    if (this.wiring.active) this.wiring.move(this.pointer.x, this.pointer.y);
    else if (this.drag) this.updateDrag(this.pointer.x, this.pointer.y);
  };

  // ---- Hover -----------------------------------------------------------

  private refreshHover(): void {
    const p = this.pointer;
    if (!p || this.drag || this.placer.active || this.wiring.active) return;
    if (document.elementFromPoint(p.x, p.y) !== this.view.canvas) {
      this.setHover(NO_HOVER);
      return;
    }
    const cell = this.view.toCell(p.x, p.y);
    const pin = pinAt(this.scene, cell.col, cell.row, pinRadius(this.view));
    const hit = pin ? null : wirePointAt(this.scene, cell.col, cell.row, wireGrab(this.view));
    const part = pin || hit ? undefined : this.scene.partAt(cell.col, cell.row);
    this.setHover({
      pin: pin?.ref ?? null,
      wireId: hit?.wire.id ?? null,
      tap: hit?.point ?? null,
      partId: part?.id ?? null,
      onKnob: part !== undefined && isOnKnob(part, cell.col, cell.row),
      onReset: part !== undefined && isOnReset(part, cell.col, cell.row),
    });
  }

  private setHover(h: Hover): void {
    const v = this.view;
    const samePin = v.hoverPin?.partId === h.pin?.partId && v.hoverPin?.pinId === h.pin?.pinId;
    const sameTap = v.hoverTap?.col === h.tap?.col && v.hoverTap?.row === h.tap?.row;
    if (v.hoverId === h.partId && v.hoverWireId === h.wireId && sameTap && samePin && this.onKnob === h.onKnob && this.onReset === h.onReset) return;
    v.hoverId = h.partId;
    v.hoverWireId = h.wireId;
    v.hoverTap = h.tap;
    v.hoverPin = h.pin;
    this.onKnob = h.onKnob;
    this.onReset = h.onReset;
    this.updateCursor();
    v.requestRender();
  }

  private updateCursor(): void {
    const v = this.view;
    if (v.isPanning) return;
    let cursor = '';
    if (this.wiring.active || v.hoverPin) cursor = 'crosshair';
    else if (this.drag?.kind === 'move') cursor = 'grabbing';
    else if (this.drag?.kind === 'knob' || this.onKnob || this.onReset || v.hoverWireId !== null) cursor = 'pointer';
    else if (v.hoverId !== null) cursor = 'grab';
    v.canvas.style.cursor = cursor;
  }

  // ---- Commands --------------------------------------------------------

  private rotateSelected(): void {
    this.reorientSelected(() => this.selection.rotate());
  }

  /** Mirror the selected parts on screen ('h' left/right, 'v' top/bottom). */
  private flipSelected(axis: FlipAxis): void {
    this.reorientSelected(() => this.selection.flip(axis));
  }

  /** Rotate or mirror the selection (`change` returns false when nothing changed). */
  private reorientSelected(change: () => boolean): void {
    if (this.wiring.active || this.drag?.kind === 'knob' || !change()) return;
    // Rotating or mirroring mid-drag: continue the drag from the new positions.
    const d = this.drag;
    if (d?.kind === 'move' && this.pointer) {
      const cell = this.view.toCell(this.pointer.x, this.pointer.y);
      const b = footprint(d.anchor);
      const col = Math.min(Math.max(cell.col, b.col + 0.5), b.col + b.cols - 0.5);
      const row = Math.min(Math.max(cell.row, b.row + 0.5), b.row + b.rows - 0.5);
      this.startMove(d.anchor, { col, row }, d.downX, d.downY, null, false);
      if (this.drag?.kind === 'move') this.drag.moved = d.moved;
    }
  }

  /** Run, or pause while it runs, the selected board (a fresh board builds from its files first). */
  private toggleRun(): void {
    const board = selectedBoard(this.selection.parts());
    if (!board) return;
    const boards = this.sim.boards;
    if (boards.boardRunState(board.id).state === 'running') boards.pauseBoard(board.id);
    else void boards.runBoard(board.id);
  }

  /** Compile the selected board's files without running them (the result is in the Build output window and the chip). */
  private buildSelectedBoard(): void {
    const board = selectedBoard(this.selection.parts());
    if (board) void this.sim.boards.buildBoard(board.id);
  }

  private resetSelectedBoard(): void {
    const board = selectedBoard(this.selection.parts());
    if (board) void this.sim.boards.resetBoard(board.id);
  }

  private deleteSelected(): void {
    if (this.selection.empty) return;
    if (this.drag) this.endDrag();
    this.selection.remove();
    this.setHover(NO_HOVER);
    this.refreshHover();
  }

  private duplicateSelected(): void {
    if (!this.drag && !this.wiring.active) this.selection.duplicate();
  }

  /** Open the value popup for a part that has an editable value. */
  private editValue(part: PlacedPart | undefined): void {
    if (!part || !getPart(part.typeId)?.value || this.drag) return;
    this.selection.set([part.id]);
    this.valueEditor.open(part, this.view.toScreen(footprint(part)), this.view.canvas.getBoundingClientRect(), this.view.requestRender);
  }

  /** Open the name popup next to the toolbar for the selected board. */
  private renameSelectedBoard(): void {
    const board = selectedBoard(this.selection.parts());
    if (!board || this.drag || !this.onRenameBoard) return;
    const rename = this.onRenameBoard;
    const anchor = this.toolbar.rect ?? this.view.toScreen(footprint(board));
    this.closePopups();
    this.nameEditor.open(
      boardLabel(board),
      defaultBoardLabel(board),
      anchor,
      this.view.canvas.getBoundingClientRect(),
      (input) => rename(board.id, input),
      this.view.requestRender, // the render also records the undo step
    );
  }

  /** Close the value and name popups. */
  private closePopups(): void {
    this.valueEditor.close();
    this.nameEditor.close();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (this.ignoreKey?.(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const busy = this.placer.active || this.wiring.active;

    if (e.key === 'Escape') {
      if (this.placer.active) this.placer.end();
      else if (this.wiring.active) this.wiring.cancel();
      else if (this.drag) this.cancelDrag();
      else this.selection.clear();
      this.updateCursor();
    } else if (key === 'r' && !mod && !e.altKey) {
      if (this.placer.active) this.placer.rotate();
      else this.rotateSelected();
    } else if ((key === 'h' || key === 'v') && !mod && !e.altKey) {
      const axis: FlipAxis = key === 'h' ? 'h' : 'v';
      if (this.placer.active) this.placer.flip(axis);
      else this.flipSelected(axis);
    } else if (e.key === 'Backspace' && this.wiring.active) {
      this.wiring.undo();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !busy) {
      this.deleteSelected();
    } else if (mod && key === 'd') {
      this.duplicateSelected();
    } else if (mod && key === 'a') {
      if (!busy && !this.drag) this.selection.selectAll();
    } else if (mod && !e.altKey && (key === 'y' || (key === 'z' && e.shiftKey))) {
      this.onRedo?.();
    } else if (mod && !e.altKey && key === 'z') {
      this.onUndo?.();
    } else if (e.key === ' ' && !mod && !e.altKey && !e.shiftKey && this.onToggleTransport && !target?.closest?.('button, a, summary, [role="button"]')) {
      // Space on a focused button keeps its own meaning (it clicks the button).
      if (!e.repeat) this.onToggleTransport();
    } else {
      return;
    }
    e.preventDefault();
  };

  // ---- Overlays --------------------------------------------------------

  private positionOverlays = (): void => {
    this.updateZoomReadout();
    this.setStatus(this.wiring.active ? WIRING_HINT : this.sim.status());

    const parts = this.selection.parts();
    const box = this.selection.bounds();
    // Hide while something is actually being dragged (not on a plain click).
    const d = this.drag;
    const dragging = d !== null && (d.kind === 'move' ? d.moved : d.kind === 'marquee' ? d.active : false);
    const busy = this.placer.active || this.wiring.active || dragging;
    this.toolbar.show(
      box && !busy ? this.view.toScreen(box) : null,
      toolbarButtons(parts, (id) => this.sim.boards.boardRunState(id), (id) => this.sim.boards.buildLog.get(id).status === 'failed'),
    );
    const board = selectedBoard(parts);
    this.statusChip.show(
      board && !busy ? this.view.toScreen(footprint(board)) : null,
      board ? this.sim.boards.boardRunState(board.id) : null,
      board ? boardLabel(board) : '',
      board ? this.sim.boards.buildLog.get(board.id) : null,
    );

    const p = this.pointer;
    const text = p && !this.placer.active && !dragging && !this.valueEditor.isOpen && !this.nameEditor.isOpen ? this.hoverText() : null;
    this.readout.show(text, p?.x, p?.y);
  };

  /** What the tooltip says about the thing under the cursor. */
  private hoverText(): ReadoutText | null {
    const v = this.view;
    const d = this.drag;
    if (d?.kind === 'knob') return describePart(d.part, this.sim);
    if (d?.kind === 'marquee') return null;
    const target = v.draft?.target ?? null;
    if (target && !isTap(target) && !isPinEnd(target)) return describeJunction(target, this.sim);
    const pinRef = v.draft ? (target && !isTap(target) && isPinEnd(target) ? target : null) : v.hoverPin;
    const pin = pinRef && findPin(this.scene, pinRef);
    if (pin) return describePin(pin, this.sim);
    const wire = this.scene.findWire(target && isTap(target) ? target.wireId : v.draft ? null : v.hoverWireId);
    if (wire) return describeWire(wire, this.sim);
    const part = d?.kind === 'move' ? d.anchor : this.scene.find(v.hoverId);
    if (part && !d && this.onReset) return { title: 'Reset', lines: ['Rebuild from the board files, stopped'] };
    return part ? describePart(part, this.sim) : null;
  }
}
