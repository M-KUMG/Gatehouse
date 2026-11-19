// The window layout (which windows are open, docked where, floating, sizes)
// is a per-user preference kept in localStorage, never in the project file.
// Storage can be missing, full, blocked or hold junk, so every access is guarded.

import type { SerializedDockview } from 'dockview';

export const LAYOUT_KEY = 'gatehouse.layout';
/**
 * 2: the Circuit panel became a movable panel with a tab (in 1 it was a locked,
 * tab-less centre group); layouts of 1 are dropped and the app starts fresh.
 * 3: the window 'scope' (digital traces) became 'logic-analyzer' and 'scope' is
 * now the part inspector; layouts of 2 are migrated (migrateLayout).
 */
export const LAYOUT_VERSION = 3;

/** Panel ids renamed from one layout version to the next: RENAMES[v] maps ids of version v to v + 1. */
const RENAMES: Record<number, Record<string, { id: string; title: string }>> = {
  2: { scope: { id: 'logic-analyzer', title: 'Logic analyzer' } },
};

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
    if (!isObject(stored) || typeof stored.version !== 'number' || !isObject(stored.dock)) return null;
    const dock = migrateLayout(stored.dock, stored.version);
    if (!dock) return null;
    const { grid, panels } = dock;
    if (!isObject(grid) || !isObject(grid.root) || !isObject(panels) || !isObject(panels[requiredPanel])) return null;
    return dock as unknown as SerializedDockview;
  } catch {
    return null;
  }
}

/**
 * A stored dock layout of `version` brought to LAYOUT_VERSION (a copy), or
 * null when it is too old (before 2) or newer than this app. Renamed panels
 * get their new id everywhere it appears (the panels map, its id, component
 * and title, the groups' views and active view, floating and popout groups):
 * every string equal to the old id and every key named like it is replaced,
 * which is safe because group ids are numbers and other strings never equal a
 * panel id.
 */
export function migrateLayout(dock: Record<string, unknown>, version: number): Record<string, unknown> | null {
  if (version < 2 || version > LAYOUT_VERSION) return null;
  let out: unknown = dock;
  for (let v = version; v < LAYOUT_VERSION; v++) {
    const renames = RENAMES[v] ?? {};
    out = renameIds(out, renames);
    const panels = isObject(out) ? out.panels : undefined;
    if (isObject(panels)) {
      for (const { id, title } of Object.values(renames)) {
        const panel = panels[id];
        if (isObject(panel)) panel.title = title;
      }
    }
  }
  return isObject(out) ? out : null;
}

function renameIds(value: unknown, renames: Record<string, { id: string }>): unknown {
  if (typeof value === 'string') return Object.hasOwn(renames, value) ? renames[value].id : value;
  if (Array.isArray(value)) return value.map((v) => renameIds(v, renames));
  if (!isObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) out[Object.hasOwn(renames, key) ? renames[key].id : key] = renameIds(v, renames);
  return out;
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
