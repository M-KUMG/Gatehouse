// The Code editor's tab strip as plain data: which files are open and which
// one is in front. Every function returns a new state. No DOM.

import { fileName, isEditable } from './editorlang';

export interface TabFile {
  boardId: string;
  /** Path inside the board's folder ("main.ino", "lib/led.h"); for a project file (PROJECT_SCOPE) its name. */
  path: string;
}

/**
 * The `boardId` of files that belong to the project, not to a board. They are
 * virtual: generated, never stored in a board's tree (no board has an empty id).
 */
export const PROJECT_SCOPE = '';
export const MANIFEST_FILE = 'gatehouse.json';
/** The generated project file as a tab. */
export const MANIFEST_TAB: TabFile = { boardId: PROJECT_SCOPE, path: MANIFEST_FILE };
export const READ_ONLY_NOTE = 'Generated from the circuit: read only';

export function isVirtualTab(tab: TabFile): boolean {
  return tab.boardId === PROJECT_SCOPE;
}

export type OpenMode = 'edit' | 'read-only' | 'refuse';

/** How the editor shows a file: editable text, a generated read-only file, or not at all (binary kinds, unknown project files). */
export function openMode(tab: TabFile): OpenMode {
  if (isVirtualTab(tab)) return tab.path === MANIFEST_FILE ? 'read-only' : 'refuse';
  return isEditable(tab.path) ? 'edit' : 'refuse';
}

export interface TabsState {
  /** In the order they were opened; the order never changes by itself. */
  tabs: readonly TabFile[];
  active: TabFile | null;
}

export const NO_TABS: TabsState = { tabs: [], active: null };

export function sameTab(a: TabFile, b: TabFile): boolean {
  return a.boardId === b.boardId && a.path === b.path;
}

export function indexOfTab(state: TabsState, tab: TabFile): number {
  return state.tabs.findIndex((t) => sameTab(t, tab));
}

/** Open a file (at the end of the strip when it is not open yet) and bring it to the front. */
export function openTab(state: TabsState, tab: TabFile): TabsState {
  const existing = state.tabs.find((t) => sameTab(t, tab));
  if (existing) return state.active === existing ? state : { ...state, active: existing };
  const added = { boardId: tab.boardId, path: tab.path };
  return { tabs: [...state.tabs, added], active: added };
}

/** Bring an open tab to the front; unknown files change nothing. */
export function activateTab(state: TabsState, tab: TabFile): TabsState {
  const existing = state.tabs.find((t) => sameTab(t, tab));
  return !existing || state.active === existing ? state : { ...state, active: existing };
}

/** The tab to show when `tabs[index]` goes away: its right neighbour, else its left one. */
function neighbour(tabs: readonly TabFile[], index: number): TabFile | null {
  return tabs[index + 1] ?? tabs[index - 1] ?? null;
}

/** Close a tab. When it was in front, its right neighbour (else the left one) takes over. */
export function closeTab(state: TabsState, tab: TabFile): TabsState {
  const index = indexOfTab(state, tab);
  if (index < 0) return state;
  const tabs = state.tabs.filter((_, i) => i !== index);
  const wasActive = state.active !== null && sameTab(state.active, tab);
  return { tabs, active: wasActive ? neighbour(state.tabs, index) : state.active };
}

/** True when `path` is `folder` or inside it. */
function isAtOrInside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/** A file or folder of a board was renamed: tabs of it (or inside the folder) follow the new path. */
export function renameTabs(state: TabsState, boardId: string, from: string, to: string): TabsState {
  const move = (t: TabFile): TabFile =>
    t.boardId === boardId && isAtOrInside(t.path, from) ? { boardId, path: `${to}${t.path.slice(from.length)}` } : t;
  const tabs = state.tabs.map(move);
  const index = state.active ? indexOfTab(state, state.active) : -1;
  return { tabs, active: index >= 0 ? tabs[index] : state.active };
}

/** Move one tab to another path (the one tab, not a folder's contents). */
export function moveTab(state: TabsState, tab: TabFile, path: string): TabsState {
  const index = indexOfTab(state, tab);
  if (index < 0) return state;
  const tabs = state.tabs.map((t, i) => (i === index ? { boardId: t.boardId, path } : t));
  return { tabs, active: state.active && sameTab(state.active, tab) ? tabs[index] : state.active };
}

/** Keep only the tabs for which `keep` is true (deleted files and boards). The front tab moves to a neighbour when it goes. */
export function pruneTabs(state: TabsState, keep: (tab: TabFile) => boolean): TabsState {
  if (state.tabs.every(keep)) return state;
  const tabs = state.tabs.filter(keep);
  let active = state.active;
  if (active && !keep(active)) {
    // The nearest surviving tab to the right of where it was, else to the left.
    const at = indexOfTab(state, active);
    active = state.tabs.slice(at + 1).find(keep) ?? [...state.tabs.slice(0, at)].reverse().find(keep) ?? null;
  }
  return { tabs, active };
}

/** What the strip shows for one tab. */
export interface TabLabel {
  tab: TabFile;
  /** File name. */
  name: string;
  /** Board label to show in the tab (only when another open file has the same name), else null. */
  board: string | null;
  /** Tooltip: board label and path. */
  title: string;
  /** A generated file: shown with a lock, never written back. */
  readOnly: boolean;
}

/**
 * Labels for the strip. The name is the file name; when two open files share
 * a name (main.ino on two boards, lib/a.h and src/a.h) the board label is shown
 * as well, and the tooltip always names board and path.
 */
export function tabLabels(tabs: readonly TabFile[], boardLabel: (boardId: string) => string): TabLabel[] {
  const counts = new Map<string, number>();
  for (const t of tabs) {
    const name = fileName(t.path);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return tabs.map((tab) => {
    const name = fileName(tab.path);
    if (isVirtualTab(tab)) return { tab, name, board: null, title: `${tab.path}: ${READ_ONLY_NOTE}`, readOnly: true };
    const board = boardLabel(tab.boardId);
    return { tab, name, board: (counts.get(name) ?? 0) > 1 ? board : null, title: `${board}: ${tab.path}`, readOnly: false };
  });
}
