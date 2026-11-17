// The File explorer's tree as plain data: the whole project (a root row,
// gatehouse.json, the boards folder, every board's folder with its files),
// what each kind of row may do, where new items and imports go, how the
// keyboard moves. No DOM.
//
// A row's `id` is its path in the project's folder layout (see
// project/storage.ts): '' for the project, 'gatehouse.json', 'boards',
// 'boards/uno-1', 'boards/uno-1/lib/led.h'. Rows of a board also carry
// `boardId` and `path`, the path inside that board's folder ('' for the
// board row itself).

import { compareBoardIds } from '../project/boardidparse';
import type { TreeEntry } from '../project/filetree';
import { ancestors, isInside, parentOf } from '../project/paths';
import { BOARDS_DIR, MANIFEST } from '../project/storage';

/** Id of the project row (the root of the tree). */
export const PROJECT_ROOT = '';
/** Id of the folder that holds the boards. */
export const BOARDS_ID = BOARDS_DIR;
/** Id of the generated project file. */
export const MANIFEST_ID = MANIFEST;

export type RowKind = 'project' | 'manifest' | 'boards' | 'board' | 'folder' | 'file';

export interface ProjectNode {
  id: string;
  /** Text shown: the project name, a file or folder name, a board's label. */
  name: string;
  kind: RowKind;
  /** 0 for the project row. */
  depth: number;
  /** Board, folder and file rows: the board they belong to. */
  boardId?: string;
  /** Board, folder and file rows: path inside the board's folder ('' for the board row). */
  path?: string;
  /** Board rows: quieter text after the name (the folder id, e.g. "uno-1"). */
  secondary?: string;
}

export interface ProjectRow extends ProjectNode {
  /** Foldable rows: false when collapsed. */
  expanded: boolean;
  /** Board rows: this is the active board (the one the other windows follow). */
  active: boolean;
}

/** What the tree needs to know about a board. */
export interface BoardNode {
  boardId: string;
  /** e.g. "Arduino Uno #1" (the number is the boardId's counter). */
  label: string;
  entries: readonly TreeEntry[];
}

/** The id of a path inside a board ('' is the board's own row). */
export function rowId(boardId: string, path: string): string {
  return path === '' ? `${BOARDS_DIR}/${boardId}` : `${BOARDS_DIR}/${boardId}/${path}`;
}

export function isFoldable(kind: RowKind): boolean {
  return kind === 'project' || kind === 'boards' || kind === 'board' || kind === 'folder';
}

/** Every row of the project, expanded: project, gatehouse.json, boards, then each board with its files (boards in natural boardId order, whatever order they come in). */
export function projectNodes(projectName: string, boards: readonly BoardNode[]): ProjectNode[] {
  const nodes: ProjectNode[] = [
    { id: PROJECT_ROOT, name: projectName, kind: 'project', depth: 0 },
    { id: MANIFEST_ID, name: MANIFEST, kind: 'manifest', depth: 1 },
    { id: BOARDS_ID, name: BOARDS_DIR, kind: 'boards', depth: 1 },
  ];
  for (const b of [...boards].sort((x, y) => compareBoardIds(x.boardId, y.boardId))) {
    nodes.push({ id: rowId(b.boardId, ''), name: b.label, kind: 'board', depth: 2, boardId: b.boardId, path: '', secondary: b.boardId });
    for (const e of b.entries) {
      nodes.push({ id: rowId(b.boardId, e.path), name: e.name, kind: e.kind, depth: e.depth + 3, boardId: b.boardId, path: e.path });
    }
  }
  return nodes;
}

/** The rows to show: `nodes` without what sits inside a collapsed row. Everything is expanded unless listed in `collapsed`. */
export function visibleRows(nodes: readonly ProjectNode[], collapsed: ReadonlySet<string>, activeBoardId: string | null): ProjectRow[] {
  const rows: ProjectRow[] = [];
  for (const n of nodes) {
    if (n.id !== PROJECT_ROOT && (collapsed.has(PROJECT_ROOT) || ancestors(n.id).some((a) => collapsed.has(a)))) continue;
    rows.push({ ...n, expanded: isFoldable(n.kind) && !collapsed.has(n.id), active: n.kind === 'board' && n.boardId === activeBoardId });
  }
  return rows;
}

/**
 * The active board: the one the rest of the app follows (`autoPartId`: the
 * board selected on the grid, else the last one), else the first board; null
 * when there is none.
 */
export function resolveActiveBoard(boards: readonly { boardId: string; partId: number }[], autoPartId: number | null): string | null {
  if (boards.length === 0) return null;
  return boards.find((b) => b.partId === autoPartId)?.boardId ?? boards[0].boardId;
}

// ---- what a row may do -----------------------------------------------------

export interface RowOps {
  /** Click or Enter shows the file in the Code editor. */
  open: boolean;
  rename: boolean;
  remove: boolean;
  fold: boolean;
  /** Files dropped from the desktop onto this row are imported. */
  acceptsDrop: boolean;
}

const NO_OPS: RowOps = { open: false, rename: false, remove: false, fold: false, acceptsDrop: false };

export function rowOps(kind: RowKind | null): RowOps {
  switch (kind) {
    case 'project': case 'boards': return { ...NO_OPS, fold: true };
    case 'manifest': return { ...NO_OPS, open: true };
    case 'board': return { ...NO_OPS, fold: true, acceptsDrop: true };
    case 'folder': return { open: false, rename: true, remove: true, fold: true, acceptsDrop: true };
    case 'file': return { open: true, rename: true, remove: true, fold: false, acceptsDrop: true };
    default: return NO_OPS;
  }
}

/** Why a row cannot be renamed or deleted (a tooltip), or null when it can. */
export function lockReason(kind: RowKind | null): string | null {
  switch (kind) {
    case 'project': return 'The project root cannot be renamed or deleted here.';
    case 'manifest': return 'gatehouse.json is generated from the circuit: it cannot be renamed or deleted.';
    case 'boards': return 'The boards folder cannot be renamed or deleted.';
    case 'board': return 'A board folder follows its board on the grid: add or remove the board there.';
    default: return null;
  }
}

/** Where "New file" / "New folder" puts an item. */
export interface NewTarget {
  boardId: string;
  /** Folder inside the board ('' for the board folder). */
  parent: string;
  /** Row id of that folder (where the name field appears). */
  parentId: string;
  /** The selection was the project, gatehouse.json or boards: the active board was used instead. */
  redirected: boolean;
}

/**
 * The folder a new item is made in: the selected folder or board folder, the
 * board folder for a selected file; with the project, gatehouse.json, boards
 * or nothing selected, the active board's folder. Null when there is no board.
 */
export function newItemTarget(row: Pick<ProjectNode, 'kind' | 'boardId' | 'path'> | null, activeBoardId: string | null): NewTarget | null {
  if (row && (row.kind === 'board' || row.kind === 'folder' || row.kind === 'file') && row.boardId !== undefined) {
    const parent = row.kind === 'folder' ? row.path ?? '' : '';
    return { boardId: row.boardId, parent, parentId: rowId(row.boardId, parent), redirected: false };
  }
  if (activeBoardId === null) return null;
  return { boardId: activeBoardId, parent: '', parentId: rowId(activeBoardId, ''), redirected: row !== null };
}

// ---- keyboard and changes ---------------------------------------------------

/** The id `delta` rows away from `selected` (clamped); with no selection, the first / last row. */
export function moveSelection(rows: readonly ProjectRow[], selected: string | null, delta: number): string | null {
  if (rows.length === 0) return null;
  const i = rows.findIndex((r) => r.id === selected);
  if (i < 0) return (delta > 0 ? rows[0] : rows[rows.length - 1]).id;
  return rows[Math.min(rows.length - 1, Math.max(0, i + delta))].id;
}

export type HorizontalMove = { kind: 'select'; id: string } | { kind: 'expand' | 'collapse'; id: string } | null;

/** What ArrowLeft / ArrowRight do on the selected row. */
export function horizontalMove(rows: readonly ProjectRow[], selected: string | null, direction: 'left' | 'right'): HorizontalMove {
  const i = rows.findIndex((r) => r.id === selected);
  if (i < 0) return null;
  const row = rows[i];
  const foldable = isFoldable(row.kind);
  if (direction === 'left') {
    if (foldable && row.expanded) return { kind: 'collapse', id: row.id };
    return row.kind === 'project' ? null : { kind: 'select', id: parentOf(row.id) ?? PROJECT_ROOT };
  }
  if (foldable && !row.expanded) return { kind: 'expand', id: row.id };
  const next = rows[i + 1];
  if (foldable && row.expanded && next && next.depth === row.depth + 1) return { kind: 'select', id: next.id };
  return null;
}

/** What to select once `id` (and what it holds) is gone: the row that takes its place, else the one before. */
export function selectionAfterDelete(rows: readonly ProjectRow[], id: string): string {
  const i = rows.findIndex((r) => r.id === id);
  const rest = rows.filter((r) => r.id !== id && !isInside(r.id, id));
  if (rest.length === 0) return PROJECT_ROOT;
  return rest[Math.min(Math.max(i, 0), rest.length - 1)].id;
}

/** Keep the view state that still fits a changed tree: collapsed rows that exist, the selection or its nearest surviving parent. */
export function reconcile(
  nodes: readonly ProjectNode[],
  collapsed: ReadonlySet<string>,
  selected: string | null,
): { collapsed: Set<string>; selected: string | null } {
  const all = new Set(nodes.map((n) => n.id));
  const kept = new Set(nodes.filter((n) => isFoldable(n.kind) && collapsed.has(n.id)).map((n) => n.id));
  let sel = selected;
  while (sel !== null && sel !== PROJECT_ROOT && !all.has(sel)) sel = parentOf(sel) ?? PROJECT_ROOT;
  return { collapsed: kept, selected: sel };
}
