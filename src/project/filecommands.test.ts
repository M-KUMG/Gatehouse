import { describe, expect, it } from 'vitest';
import { commandForKey, fileMenu, projectShortcuts, type FileCommand } from './filecommands';
import { folderHost } from './folderhost';

const commands = (folders: boolean): FileCommand[] => fileMenu(folders).flatMap((e) => (e === 'separator' ? [] : [e.command]));

describe('file menu per environment', () => {
  it('the browser has New, Import and Export (with Export as)', () => {
    expect(commands(false)).toEqual(['new', 'import', 'export', 'exportAs']);
    expect(projectShortcuts(false).map((s) => s.label)).toEqual(['Export (.gth file)', 'Export as…', 'Import…']);
  });
  it('Electron adds Open folder, Save and Save as', () => {
    expect(commands(true)).toEqual(['new', 'openFolder', 'saveFolder', 'saveFolderAs', 'import', 'export']);
  });
  it('never starts or ends with a separator, or has two in a row', () => {
    for (const folders of [false, true]) {
      const menu = fileMenu(folders);
      expect(menu[0]).not.toBe('separator');
      expect(menu[menu.length - 1]).not.toBe('separator');
      menu.forEach((e, i) => e === 'separator' && expect(menu[i + 1]).not.toBe('separator'));
    }
  });
  it('every shortcut shown in the menu is the one the keys really do, and the sheet lists the same count', () => {
    for (const folders of [false, true]) {
      const shown = new Map<string, FileCommand>();
      for (const e of fileMenu(folders)) if (e !== 'separator' && e.keys) shown.set(e.keys, e.command);
      for (const [keys, command] of shown) {
        const parts = keys.split('+');
        const shift = parts.includes('Shift');
        const key = parts[parts.length - 1].toLowerCase();
        expect(commandForKey(folders, key, shift), keys).toBe(command);
      }
      expect(projectShortcuts(folders).length).toBe(shown.size);
    }
  });
  it('the keys mean Export in the browser and Save in Electron', () => {
    expect(commandForKey(false, 's', false)).toBe('export');
    expect(commandForKey(false, 's', true)).toBe('exportAs');
    expect(commandForKey(false, 'o', false)).toBe('import');
    expect(commandForKey(false, 'e', false)).toBeNull();
    expect(commandForKey(true, 's', false)).toBe('saveFolder');
    expect(commandForKey(true, 's', true)).toBe('saveFolderAs');
    expect(commandForKey(true, 'o', false)).toBe('openFolder');
    expect(commandForKey(true, 'o', true)).toBe('import');
    expect(commandForKey(true, 'e', false)).toBe('export');
    expect(commandForKey(true, 'x', false)).toBeNull();
  });
  it('has no folder host outside Electron', () => {
    expect(folderHost()).toBeNull();
  });
});
