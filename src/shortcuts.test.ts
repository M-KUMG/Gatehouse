import { describe, expect, it } from 'vitest';
import { SHORTCUT_GROUPS, formatKey, isMacPlatform, shortcutGroups } from './shortcuts';

describe('the shortcut list', () => {
  it('has titled groups, each with items that have a label and at least one non-empty way to do it', () => {
    expect(SHORTCUT_GROUPS.length).toBeGreaterThan(0);
    for (const group of SHORTCUT_GROUPS) {
      expect(group.title.trim()).not.toBe('');
      expect(group.items.length).toBeGreaterThan(0);
      for (const item of group.items) {
        expect(item.label.trim(), group.title).not.toBe('');
        expect(item.keys.length, item.label).toBeGreaterThan(0);
        for (const chord of item.keys) {
          expect(chord.length, item.label).toBeGreaterThan(0);
          for (const key of chord) expect(key.trim(), item.label).not.toBe('');
        }
      }
    }
  });

  it('has unique group titles and unique labels inside a group', () => {
    const titles = SHORTCUT_GROUPS.map((g) => g.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const group of SHORTCUT_GROUPS) {
      const labels = group.items.map((i) => i.label);
      expect(new Set(labels).size, group.title).toBe(labels.length);
    }
  });

  it('documents the shortcuts the app really has', () => {
    const all = SHORTCUT_GROUPS.flatMap((g) => g.items.flatMap((i) => i.keys.map((c) => c.join('+'))));
    for (const expected of ['Ctrl+Z', 'Ctrl+S', 'Ctrl+O', 'R', 'F', '0', 'Space', '?', 'Delete', 'Esc']) {
      expect(all, expected).toContain(expected);
    }
  });
});

describe('the Project group', () => {
  it('lists the folder commands only for the Electron app', () => {
    const labels = (folders: boolean) => shortcutGroups(folders).find((g) => g.title === 'Project')!.items.map((i) => i.label);
    expect(labels(false)).toEqual(['Export (.gth file)', 'Export as…', 'Import…']);
    expect(labels(true)).toContain('Open project folder…');
    expect(labels(true)).toContain('Save as… (folder)');
  });
});

describe('formatKey', () => {
  it('leaves keys alone off a Mac', () => {
    expect(formatKey('Ctrl', false)).toBe('Ctrl');
    expect(formatKey('Shift', false)).toBe('Shift');
  });

  it('uses the Mac symbols on a Mac', () => {
    expect(formatKey('Ctrl', true)).toBe('⌘');
    expect(formatKey('Shift', true)).toBe('⇧');
    expect(formatKey('Backspace', true)).toBe('⌫');
    expect(formatKey('R', true)).toBe('R');
  });
});

describe('isMacPlatform', () => {
  it('recognises Apple platforms only', () => {
    expect(isMacPlatform('MacIntel')).toBe(true);
    expect(isMacPlatform('iPhone')).toBe(true);
    expect(isMacPlatform('Win32')).toBe(false);
    expect(isMacPlatform('Linux x86_64')).toBe(false);
  });
});
