// "Windows" button for the file bar: a small menu to open or close each
// dockable window, and to reset the layout.

import type { DockLayout } from './dock';
import { WINDOWS } from './panels';

const ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/>' +
  '<path d="M9 4v16M9 13h12"/></svg>';

/** Builds the button with its menu; the caller puts it in the file bar. */
export function createWindowsMenu(layout: DockLayout): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'windows-menu';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'file-button';
  button.title = 'Windows (serial console, build output, code editor, file explorer)';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-haspopup', 'menu');
  button.innerHTML = ICON;

  const menu = document.createElement('div');
  menu.className = 'windows-menu-list';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  const items = WINDOWS.map((spec) => {
    const item = menuItem(spec.title, () => {
      if (layout.isOpen(spec.id)) layout.close(spec.id);
      else layout.open(spec.id);
    });
    item.setAttribute('role', 'menuitemcheckbox');
    return { spec, item };
  });
  const separator = document.createElement('div');
  separator.className = 'windows-menu-separator';
  const reset = menuItem('Reset layout', () => layout.reset());
  reset.title = 'Close all windows and forget their positions';
  menu.append(...items.map((i) => i.item), separator, reset);

  const refresh = (): void => {
    for (const { spec, item } of items) item.setAttribute('aria-checked', String(layout.isOpen(spec.id)));
  };
  layout.onChange(refresh);
  refresh();

  const setOpen = (open: boolean): void => {
    menu.hidden = !open;
    button.classList.toggle('active', open);
    if (open) {
      refresh();
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
  };
  button.addEventListener('click', () => setOpen(menu.hidden));
  menu.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('.windows-menu-item')) setOpen(false);
  });

  wrap.append(button, menu);
  return wrap;
}

function menuItem(label: string, run: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'windows-menu-item';
  b.textContent = label;
  b.addEventListener('click', run);
  return b;
}
