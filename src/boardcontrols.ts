// What the selected board offers on the grid, as plain data (no DOM):
//   - which buttons the floating selection toolbar shows (rotate, flip, duplicate,
//     edit value, and for exactly one selected board: Run / Pause, Build,
//     Reset, Serial console, Rename) and how each looks (icon, tooltip,
//     disabled, error mark)
//   - the reset button drawn on the board (a hit area in cells, rotates with
//     the part, like the knob in controls.ts)
//   - the "active" board the other windows follow (the Serial console's Auto,
//     the File explorer's highlight): the selected board, else the last one.

import type { BoardRunState } from './mcu/runtime';
import { canFlip } from './flip';
import type { PlacedPart } from './model';
import { getPart } from './parts';
import { unrotatePoint } from './pins';
import { compareBoardIds } from './project/boardidparse';

export function isBoardPart(part: PlacedPart): boolean {
  return getPart(part.typeId)?.board !== undefined;
}

/** The boards among `parts` in a fixed order (natural boardId order, then part id). */
export function boardsInOrder(parts: readonly PlacedPart[]): PlacedPart[] {
  return parts.filter(isBoardPart).sort((a, b) => compareBoardIds(a.boardId ?? '', b.boardId ?? '') || a.id - b.id);
}

/** The one board among the selected parts, or null (no board, or several). */
export function selectedBoard(selected: readonly PlacedPart[]): PlacedPart | null {
  const boards = selected.filter(isBoardPart);
  return boards.length === 1 ? boards[0] : null;
}

// ---- the toolbar ---------------------------------------------------------------

export interface RunButtonView {
  /** 'run' shows a play triangle, 'pause' two bars. */
  icon: 'run' | 'pause';
  title: string;
  /** While a build is in progress. */
  disabled: boolean;
  /** The last build or load failed: the button carries a red marker. */
  error: boolean;
}

export interface ActionButtonView {
  title: string;
  disabled: boolean;
}

/** The Build (compile only) button: disabled while a build runs, red marker after a failed build. */
export interface BuildButtonView extends ActionButtonView {
  error: boolean;
}

/** The board buttons of the toolbar. */
export interface BoardToolbar {
  run: RunButtonView;
  build: BuildButtonView;
  reset: ActionButtonView;
  console: ActionButtonView;
  /** Opens the small name popup (see nameedit.ts). */
  rename: ActionButtonView;
}

/** Which toolbar buttons show for the current selection. */
export interface ToolbarButtons {
  rotate: boolean;
  /** Flip horizontal / vertical: at least one selected part can be mirrored (see flip.ts). */
  flipH: boolean;
  flipV: boolean;
  duplicate: boolean;
  edit: boolean;
  /** Exactly one board selected: its buttons; else null. */
  board: BoardToolbar | null;
}

export function runButtonView(s: BoardRunState): RunButtonView {
  if (s.building) return { icon: 'run', title: 'Building…', disabled: true, error: false };
  switch (s.state) {
    case 'running': return { icon: 'pause', title: 'Pause', disabled: false, error: false };
    case 'paused': return { icon: 'run', title: 'Run (continue)', disabled: false, error: false };
    case 'error': return { icon: 'run', title: `Error: ${s.error ?? 'the board could not be loaded'}\nClick to build and run again`, disabled: false, error: true };
    default: return { icon: 'run', title: 'Run', disabled: false, error: false };
  }
}

/** `buildFailed`: the board's last build (Run, Reset or Build) failed, as the build log says. */
export function buildButtonView(s: BoardRunState, buildFailed = false): BuildButtonView {
  return { title: s.building ? 'Building…' : 'Build (compile only)', disabled: s.building, error: !s.building && buildFailed };
}

export function boardToolbar(s: BoardRunState, buildFailed = false): BoardToolbar {
  return {
    run: runButtonView(s),
    build: buildButtonView(s, buildFailed),
    reset: { title: 'Reset (rebuild from files)', disabled: s.building },
    console: { title: 'Open serial console', disabled: false },
    rename: { title: 'Rename board (display name only)', disabled: false },
  };
}

export function toolbarButtons(
  selected: readonly PlacedPart[],
  stateOf: (partId: number) => BoardRunState,
  /** True when the board's last build failed (the build log's word, which also covers compile-only builds). */
  buildFailed: (partId: number) => boolean = () => false,
): ToolbarButtons {
  const board = selectedBoard(selected);
  const flip = canFlip(selected);
  return {
    rotate: selected.length > 0,
    flipH: flip,
    flipV: flip,
    duplicate: selected.length > 0,
    edit: selected.length === 1 && (getPart(selected[0].typeId)?.value !== undefined || getPart(selected[0].typeId)?.colorable === true),
    board: board ? boardToolbar(stateOf(board.id), buildFailed(board.id)) : null,
  };
}

// ---- the reset button on the board ------------------------------------------------

/** True when the cell point is on the part's reset button (false for parts without one). */
export function isOnReset(part: PlacedPart, col: number, row: number): boolean {
  const type = getPart(part.typeId);
  const box = type?.resetButton;
  if (!type || !box) return false;
  const p = unrotatePoint(col - part.col, row - part.row, type, part);
  return p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
}

// ---- the active board ---------------------------------------------------------------

/**
 * The board the rest of the app follows: the selected one, else the one used
 * before (if it still exists), else the first. `boardIds` are part ids in a
 * fixed order.
 */
export function pickActiveBoard(boardIds: readonly number[], selected: number | null, last: number | null): number | null {
  if (selected !== null && boardIds.includes(selected)) return selected;
  if (last !== null && boardIds.includes(last)) return last;
  return boardIds.length > 0 ? boardIds[0] : null;
}

/** Remembers the active board between frames (the grid selection is not always a board). */
export class ActiveBoard {
  private id: number | null = null;

  constructor(
    private readonly parts: () => readonly PlacedPart[],
    private readonly selectedIds: () => ReadonlySet<number>,
  ) {}

  /** Part id of the active board, or null without boards. */
  get partId(): number | null {
    return this.id;
  }

  /** Call after every frame, before the windows that follow it. */
  update(): void {
    const parts = this.parts();
    const picked = selectedBoard(parts.filter((p) => this.selectedIds().has(p.id)));
    this.id = pickActiveBoard(boardsInOrder(parts).map((p) => p.id), picked?.id ?? null, this.id);
  }
}
