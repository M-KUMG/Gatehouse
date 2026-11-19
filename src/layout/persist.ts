// The window layout (which windows are open, docked where, floating, sizes)
// is a per-user preference kept in localStorage, never in the project file.
// Storage can be missing, full, blocked or hold junk, so every access is guarded.

import type { SerializedDockview } from 'dockview';

export const LAYOUT_KEY = 'gatehouse.layout';
/**
 * 2: the Circuit panel became a movable panel with a tab (in 1 it was a locked,
 * tab-less centre group); layouts of 1 are dropped and the app starts fresh.
 */
export const LAYOUT_VERSION = 2;

/** The part of `Storage` used here, so tests can pass a fake. */
export type LayoutStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface StoredLayout {
  version: number;
  dock: SerializedDockview;
}

/** window.localStorage, or null when the browser refuses access. */
export function browserStorage(): LayoutStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The saved layout, or null when there is none, storage fails, or the text
 * is not a layout of this version that still holds the panel `requiredPanel`.
 */
export function loadLayout(storage: LayoutStorage | null, requiredPanel: string): SerializedDockview | null {
  try {
    const text = storage?.getItem(LAYOUT_KEY);
    if (!text) return null;
    const stored: unknown = JSON.parse(text);
    if (!isObject(stored) || stored.version !== LAYOUT_VERSION || !isObject(stored.dock)) return null;
    const { grid, panels } = stored.dock;
    if (!isObject(grid) || !isObject(grid.root) || !isObject(panels) || !isObject(panels[requiredPanel])) return null;
    return stored.dock as unknown as SerializedDockview;
  } catch {
    return null;
  }
}

/** Store the layout; false when storage is unavailable or full. */
export function saveLayout(storage: LayoutStorage | null, dock: SerializedDockview): boolean {
  if (!storage) return false;
  try {
    const stored: StoredLayout = { version: LAYOUT_VERSION, dock };
    storage.setItem(LAYOUT_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

export function clearLayout(storage: LayoutStorage | null): void {
  try {
    storage?.removeItem(LAYOUT_KEY);
  } catch {
    // nothing to do: the next save overwrites it anyway
  }
}
