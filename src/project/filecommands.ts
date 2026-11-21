// What the File menu holds in this environment, and the shortcuts. Pure (no
// DOM), so the browser/Electron difference is tested.
//
//   Browser:   New, Import (Ctrl+O), Export (Ctrl+S), Export as (Ctrl+Shift+S)
//   Electron:  New, Open folder (Ctrl+O), Save (Ctrl+S), Save as (Ctrl+Shift+S),
//              Import (Ctrl+Shift+O), Export (Ctrl+E)
//
// "Folder" commands need the Electron file system (window.gatehouseHost); the
// browser only reads and writes `.gth` files.

export type FileCommand = 'new' | 'openFolder' | 'saveFolder' | 'saveFolderAs' | 'import' | 'export' | 'exportAs';

export type FileMenuEntry = { command: FileCommand; label: string; keys: string; title?: string } | 'separator';

/** The entries of the File menu, in order. `keys` is shown at the right ("Ctrl+S"). */
export function fileMenu(folders: boolean): FileMenuEntry[] {
  if (!folders) {
    return [
      { command: 'new', label: 'New project', keys: '' },
      'separator',
      { command: 'import', label: 'Import project…', keys: 'Ctrl+O', title: 'Open a .gth project file' },
      { command: 'export', label: 'Export project', keys: 'Ctrl+S', title: 'Save the project as a .gth file' },
      { command: 'exportAs', label: 'Export as…', keys: 'Ctrl+Shift+S' },
    ];
  }
  return [
    { command: 'new', label: 'New project', keys: '' },
    'separator',
    { command: 'openFolder', label: 'Open project folder…', keys: 'Ctrl+O' },
    { command: 'saveFolder', label: 'Save', keys: 'Ctrl+S', title: 'Save into the project folder' },
    { command: 'saveFolderAs', label: 'Save as…', keys: 'Ctrl+Shift+S', title: 'Save into a new folder' },
    'separator',
    { command: 'import', label: 'Import .gth file…', keys: 'Ctrl+Shift+O' },
    { command: 'export', label: 'Export as .gth file…', keys: 'Ctrl+E' },
  ];
}

/** The command a Ctrl/Cmd + key press means (`key` lower case), or null. */
export function commandForKey(folders: boolean, key: string, shift: boolean): FileCommand | null {
  if (folders) {
    if (key === 's') return shift ? 'saveFolderAs' : 'saveFolder';
    if (key === 'o') return shift ? 'import' : 'openFolder';
    if (key === 'e' && !shift) return 'export';
    return null;
  }
  if (key === 's') return shift ? 'exportAs' : 'export';
  if (key === 'o' && !shift) return 'import';
  return null;
}

/** The "Project" group of the shortcuts sheet. */
export function projectShortcuts(folders: boolean): { label: string; keys: readonly (readonly string[])[] }[] {
  if (!folders) {
    return [
      { label: 'Export (.gth file)', keys: [['Ctrl', 'S']] },
      { label: 'Export as…', keys: [['Ctrl', 'Shift', 'S']] },
      { label: 'Import…', keys: [['Ctrl', 'O']] },
    ];
  }
  return [
    { label: 'Save', keys: [['Ctrl', 'S']] },
    { label: 'Save as… (folder)', keys: [['Ctrl', 'Shift', 'S']] },
    { label: 'Open project folder…', keys: [['Ctrl', 'O']] },
    { label: 'Export (.gth file)', keys: [['Ctrl', 'E']] },
    { label: 'Import…', keys: [['Ctrl', 'Shift', 'O']] },
  ];
}
