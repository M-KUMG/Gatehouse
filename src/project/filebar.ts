// Small bar in the top-left corner of the grid: the File menu (New, and in the
// browser Import / Export, in Electron Open folder / Save / Save as / Import /
// Export: see filecommands.ts), the Windows menu (added by main.ts), Undo,
// Redo, and the project name with a dot while there are unsaved changes.

import { setBarMenuOpen } from '../barmenu';
import { attachDrop } from '../droplight';
import { fileMenu, type FileCommand } from './filecommands';

const svg = (body: string): string =>
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" ' +
  `stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
};

export interface FileBarActions {
  /** A File menu entry was chosen. */
  command: (command: FileCommand) => void;
  undo: () => void;
  redo: () => void;
}

export interface FileBar {
  /** The bar itself, so other controls (e.g. the Windows menu) can join it. */
  element: HTMLElement;
  /** Shows the project name and unsaved state. */
  show: (name: string, dirty: boolean) => void;
  /** Enables the Undo / Redo buttons. */
  showHistory: (canUndo: boolean, canRedo: boolean) => void;
}

/** Builds the bar inside `parent`. `folders`: this is the Electron app, which can keep a project in a folder. */
export function createFileBar(parent: HTMLElement, actions: FileBarActions, folders: boolean): FileBar {
  const bar = document.createElement('div');
  bar.className = 'file-bar';
  const name = document.createElement('span');
  name.className = 'project-name';
  const dot = document.createElement('span');
  dot.className = 'dirty-dot';
  dot.title = 'Unsaved changes';
  dot.textContent = '●';
  const undo = button('Undo (Ctrl+Z)', ICONS.undo, actions.undo);
  const redo = button('Redo (Ctrl+Y or Ctrl+Shift+Z)', ICONS.redo, actions.redo);
  undo.disabled = redo.disabled = true;
  bar.append(createFileMenu(actions.command, folders), undo, redo, name, dot);
  parent.append(bar);
  attachDrop(bar, '.file-button');

  return {
    element: bar,
    show: (projectName, dirty) => {
      name.textContent = projectName;
      name.title = dirty ? `${projectName} (unsaved changes)` : projectName;
      dot.style.visibility = dirty ? 'visible' : 'hidden';
    },
    showHistory: (canUndo, canRedo) => {
      undo.disabled = !canUndo;
      redo.disabled = !canRedo;
    },
  };
}

/** The "File" button with its drop-down list; it closes after a choice, on Escape and on an outside press. */
function createFileMenu(run: (command: FileCommand) => void, folders: boolean): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'windows-menu file-menu';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'file-button file-menu-button';
  trigger.textContent = 'File';
  trigger.title = 'New project, open, save, import and export';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'windows-menu-list file-menu-list';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  const setOpen = (open: boolean): void => {
    menu.hidden = !open;
    trigger.classList.toggle('active', open);
    trigger.setAttribute('aria-expanded', String(open));
    setBarMenuOpen(wrap, menu, open);
    if (open) {
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
    } else {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
    }
  };
  const onOutside = (e: PointerEvent): void => {
    if (!(e.target instanceof Node && wrap.contains(e.target))) setOpen(false);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.stopPropagation(); // Escape closes the menu, not the selection on the grid
    setOpen(false);
    trigger.focus();
  };

  for (const entry of fileMenu(folders)) {
    if (entry === 'separator') {
      const line = document.createElement('div');
      line.className = 'windows-menu-separator';
      menu.append(line);
      continue;
    }
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'windows-menu-item file-menu-item';
    item.setAttribute('role', 'menuitem');
    const label = document.createElement('span');
    label.textContent = entry.label;
    item.append(label);
    if (entry.keys) {
      const keys = document.createElement('span');
      keys.className = 'menu-shortcut';
      keys.textContent = entry.keys;
      item.append(keys);
    }
    if (entry.title) item.title = entry.title;
    item.addEventListener('click', () => {
      setOpen(false);
      run(entry.command);
    });
    menu.append(item);
  }

  attachDrop(menu, '.windows-menu-item');
  trigger.addEventListener('click', () => setOpen(menu.hidden));
  wrap.append(trigger, menu);
  return wrap;
}

function button(title: string, icon: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'file-button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = icon;
  b.addEventListener('click', onClick);
  return b;
}
