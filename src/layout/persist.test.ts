import { describe, expect, it } from 'vitest';
import type { SerializedDockview } from 'dockview';
import { LAYOUT_KEY, LAYOUT_VERSION, clearLayout, loadLayout, migrateLayout, saveLayout, type LayoutStorage } from './persist';

class MemoryStorage implements LayoutStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/** Every call throws, like a blocked or full localStorage. */
const BROKEN: LayoutStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

const LAYOUT = {
  grid: { root: { type: 'branch', data: [] }, width: 800, height: 600, orientation: 'HORIZONTAL' },
  panels: { editor: { id: 'editor', contentComponent: 'editor' } },
} as unknown as SerializedDockview;

describe('layout persistence', () => {
  it('saves and loads a layout', () => {
    const storage = new MemoryStorage();
    expect(saveLayout(storage, LAYOUT)).toBe(true);
    expect(loadLayout(storage, 'editor')).toEqual(LAYOUT);
  });

  it('returns null when nothing is stored', () => {
    expect(loadLayout(new MemoryStorage(), 'editor')).toBeNull();
    expect(loadLayout(null, 'editor')).toBeNull();
  });

  it('ignores garbage, other versions and layouts without the editor', () => {
    const storage = new MemoryStorage();
    for (const text of ['not json{', '42', 'null', '[]', '{"version":1}', '{"version":99,"dock":{}}']) {
      storage.setItem(LAYOUT_KEY, text);
      expect(loadLayout(storage, 'editor')).toBeNull();
    }
    saveLayout(storage, { ...LAYOUT, panels: {} });
    expect(loadLayout(storage, 'editor')).toBeNull();
  });

  it('drops layouts of an older version (the locked, tab-less grid of version 1)', () => {
    const storage = new MemoryStorage();
    storage.setItem(LAYOUT_KEY, JSON.stringify({ version: 1, dock: LAYOUT }));
    expect(loadLayout(storage, 'editor')).toBeNull();
    storage.setItem(LAYOUT_KEY, JSON.stringify({ version: LAYOUT_VERSION, dock: LAYOUT }));
    expect(loadLayout(storage, 'editor')).toEqual(LAYOUT);
  });

  it('survives storage that throws', () => {
    expect(loadLayout(BROKEN, 'editor')).toBeNull();
    expect(saveLayout(BROKEN, LAYOUT)).toBe(false);
    expect(saveLayout(null, LAYOUT)).toBe(false);
    expect(() => clearLayout(BROKEN)).not.toThrow();
  });

  it('clears the stored layout', () => {
    const storage = new MemoryStorage();
    saveLayout(storage, LAYOUT);
    clearLayout(storage);
    expect(loadLayout(storage, 'editor')).toBeNull();
  });

  it('migrates a version 2 layout: the old Scope window becomes the Logic analyzer', () => {
    const v2 = {
      grid: {
        root: {
          type: 'branch',
          data: [
            { type: 'leaf', data: { id: '1', views: ['editor'], activeView: 'editor' }, size: 400 },
            { type: 'leaf', data: { id: '2', views: ['serial-console', 'scope'], activeView: 'scope' }, size: 200 },
          ],
        },
        width: 800, height: 600, orientation: 'VERTICAL',
      },
      panels: {
        editor: { id: 'editor', contentComponent: 'editor', title: 'Circuit' },
        'serial-console': { id: 'serial-console', contentComponent: 'serial-console', title: 'Serial console' },
        scope: { id: 'scope', contentComponent: 'scope', tabComponent: 'gh-tab', title: 'Scope' },
      },
      floatingGroups: [{ data: { id: '3', views: ['scope'], activeView: 'scope' }, position: { left: 0, top: 0, width: 10, height: 10 } }],
      activeGroup: '2',
    };
    const storage = new MemoryStorage();
    storage.setItem(LAYOUT_KEY, JSON.stringify({ version: 2, dock: v2 }));
    const loaded = loadLayout(storage, 'editor') as unknown as typeof v2 & { panels: Record<string, unknown> };
    expect(loaded).not.toBeNull();
    expect(Object.keys(loaded.panels)).toEqual(['editor', 'serial-console', 'logic-analyzer']);
    expect(loaded.panels['logic-analyzer']).toEqual({ id: 'logic-analyzer', contentComponent: 'logic-analyzer', tabComponent: 'gh-tab', title: 'Logic analyzer' });
    const leaf = (loaded.grid.root.data[1] as { data: { views: string[]; activeView: string } }).data;
    expect(leaf.views).toEqual(['serial-console', 'logic-analyzer']);
    expect(leaf.activeView).toBe('logic-analyzer');
    expect(loaded.floatingGroups[0].data.views).toEqual(['logic-analyzer']);
    expect(loaded.activeGroup).toBe('2');
    expect(JSON.stringify(loaded)).not.toContain('"scope"');
    // The stored text is not touched (the next save writes version 3).
    expect(JSON.parse(storage.getItem(LAYOUT_KEY)!).dock.panels.scope).toBeDefined();
    // A version 3 layout keeps 'scope' (the part inspector) as it is.
    expect(migrateLayout({ panels: { scope: { id: 'scope' } } }, LAYOUT_VERSION)).toEqual({ panels: { scope: { id: 'scope' } } });
    expect(migrateLayout({}, 1)).toBeNull();
    expect(migrateLayout({}, LAYOUT_VERSION + 1)).toBeNull();
  });
});
