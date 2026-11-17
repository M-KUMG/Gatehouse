import { describe, expect, it } from 'vitest';
import type { SerializedDockview } from 'dockview';
import { LAYOUT_KEY, clearLayout, loadLayout, saveLayout, type LayoutStorage } from './persist';

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
});
