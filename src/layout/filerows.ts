// Pure helpers of the File explorer: which rows are visible, where a new
// item goes, what a typed name means, how selection moves. No DOM.

import type { TreeEntry } from '../project/filetree';
import { isInside, parentOf, pathError } from '../project/paths';

/** Path of the board folder itself (the root row). */
export const ROOT = '';

export interface TreeRow {
  /** Path inside the board folder; ROOT for the board folder. */
  path: string;
  /** Text shown (the last path segment; the root shows its own label). */
  name: string;
  kind: 'root' | 'folder' | 'file';
  /** 0 for the root row, 1 for entries directly inside it. */
  depth: number;
  /** Folders and the root: false when collapsed. */
  expanded: boolean;
}

/**
 * The rows to show: the board folder first, then `entries` (explorer order,
 * each folder right before its contents) without what sits inside a
 * collapsed folder. Folders are expanded unless listed in `collapsed`.
 */
export function visibleRows(entries: readonly TreeEntry[], collapsed: ReadonlySet<string>, rootName: string): TreeRow[] {
  const rows: TreeRow[] = [{ path: ROOT, name: rootName, kind: 'root', depth: 0, expanded: true }];
  let hidden: string | null = null;
  for (const e of entries) {
    if (hidden !== null && e.path.startsWith(`${hidden}/`)) continue;
    hidden = null;
    const folder = e.kind === 'folder';
    const expanded = folder && !collapsed.has(e.path);
    rows.push({ path: e.path, name: e.name, kind: e.kind, depth: e.depth + 1, expanded });
    if (folder && !expanded) hidden = e.path;
  }
  return rows;
}

/** The folder a new item is made in: the selected folder, else the board folder (also for a selected file). */
export function newItemParent(rows: readonly TreeRow[], selected: string | null): string {
  const row = rows.find((r) => r.path === selected);
  return row && row.kind !== 'file' ? row.path : ROOT;
}

export function joinPath(folder: string, name: string): string {
  return folder === ROOT ? name : `${folder}/${name}`;
}

export type NameCheck = { ok: true; path: string } | { ok: false; error: string };

/** The full path for a typed new name ("lib/led.h" is allowed: folders in between are made too), or why not. */
export function checkNewName(parent: string, typed: string): NameCheck {
  const name = typed.trim();
  if (name === '') return { ok: false, error: 'Type a name.' };
  const path = joinPath(parent, name);
  const bad = pathError(path);
  return bad ? { ok: false, error: bad } : { ok: true, path };
}

export type RenameCheck = { ok: true; path: string; unchanged: boolean } | { ok: false; error: string };

/** The new path for renaming `path` to the typed name, in the same folder. */
export function checkRename(path: string, typed: string): RenameCheck {
  const name = typed.trim();
  if (name === '') return { ok: false, error: 'Type a name.' };
  if (name.includes('/')) return { ok: false, error: 'A name cannot contain "/". Renaming keeps the item in its folder.' };
  const target = joinPath(parentOf(path) ?? ROOT, name);
  const bad = pathError(target);
  if (bad) return { ok: false, error: bad };
  return { ok: true, path: target, unchanged: target === path };
}

/** How many leading characters of a file name are its base name (before the extension): what rename selects first. */
export function baseLength(name: string): number {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? dot : name.length;
}

/** Source files the editor will open as code (they get the code icon). */
export function isCodeFile(name: string): boolean {
  return /\.(ino|pde|c|cc|cpp|cxx|h|hh|hpp|s)$/i.test(name);
}

/** The path `delta` rows away from `selected` (clamped); with no selection, the first / last row. */
export function moveSelection(rows: readonly TreeRow[], selected: string | null, delta: number): string | null {
  if (rows.length === 0) return null;
  const i = rows.findIndex((r) => r.path === selected);
  if (i < 0) return (delta > 0 ? rows[0] : rows[rows.length - 1]).path;
  return rows[Math.min(rows.length - 1, Math.max(0, i + delta))].path;
}

export type HorizontalMove = { kind: 'select'; path: string } | { kind: 'expand' | 'collapse'; path: string } | null;

/** What ArrowLeft / ArrowRight do on the selected row. */
export function horizontalMove(rows: readonly TreeRow[], selected: string | null, direction: 'left' | 'right'): HorizontalMove {
  const i = rows.findIndex((r) => r.path === selected);
  if (i < 0) return null;
  const row = rows[i];
  if (direction === 'left') {
    if (row.kind === 'folder' && row.expanded) return { kind: 'collapse', path: row.path };
    return row.kind === 'root' ? null : { kind: 'select', path: parentOf(row.path) ?? ROOT };
  }
  if (row.kind === 'folder' && !row.expanded) return { kind: 'expand', path: row.path };
  const next = rows[i + 1];
  if (row.kind !== 'file' && row.expanded && next && next.depth === row.depth + 1) return { kind: 'select', path: next.path };
  return null;
}

/** What to select once `path` (and what it holds) is gone: the row that takes its place, else the one before. */
export function selectionAfterDelete(rows: readonly TreeRow[], path: string): string {
  const i = rows.findIndex((r) => r.path === path);
  const rest = rows.filter((r) => r.path !== path && !isInside(r.path, path));
  if (rest.length === 0) return ROOT;
  return rest[Math.min(Math.max(i, 0), rest.length - 1)].path;
}

/** Keep the view state that still fits a changed tree: collapsed folders that exist, the selection or its nearest surviving parent. */
export function reconcile(
  entries: readonly TreeEntry[],
  collapsed: ReadonlySet<string>,
  selected: string | null,
): { collapsed: Set<string>; selected: string | null } {
  const all = new Set(entries.map((e) => e.path));
  const kept = new Set(entries.filter((e) => e.kind === 'folder' && collapsed.has(e.path)).map((e) => e.path));
  let sel = selected;
  while (sel !== null && sel !== ROOT && !all.has(sel)) sel = parentOf(sel) ?? ROOT;
  return { collapsed: kept, selected: sel };
}

/** `paths` after `from` was renamed to `to`: entries at or inside `from` move along. */
export function remapPaths(paths: ReadonlySet<string>, from: string, to: string): Set<string> {
  return new Set([...paths].map((p) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p)));
}
