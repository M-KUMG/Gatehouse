// "Graphics" button for the file bar: a small menu to choose how the interface
// is drawn (graphics.ts: Glass or Solid). The current look is ticked; a choice
// applies at once and closes the menu.

import { setBarMenuOpen } from '../barmenu';
import { attachDrop } from '../droplight';
import { GRAPHICS_MODES, graphicsMode, onGraphicsChange, setGraphics } from '../graphics';

/** Builds the button with its menu; the caller puts it in the file bar. */
export function createGraphicsMenu(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'windows-menu graphics-menu';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'file-button file-menu-button';
  button.title = 'Graphics: glass or solid (no transparency)';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.textContent = 'Graphics';

  const menu = document.createElement('div');
  menu.className = 'windows-menu-list';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  const items = GRAPHICS_MODES.map((mode) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'windows-menu-item';
    item.setAttribute('role', 'menuitemradio');
    item.textContent = mode.label;
    item.title = mode.hint;
    item.addEventListener('click', () => {
      setGraphics(mode.id);
      setOpen(false);
      button.focus();
    });
    return { mode, item };
  });
  menu.append(...items.map((i) => i.item));
  attachDrop(menu, '.windows-menu-item');

  const refresh = (): void => {
    for (const { mode, item } of items) item.setAttribute('aria-checked', String(mode.id === graphicsMode()));
  };
  onGraphicsChange(refresh);
  refresh();

  const setOpen = (open: boolean): void => {
    menu.hidden = !open;
    button.classList.toggle('active', open);
    button.setAttribute('aria-expanded', String(open));
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
    button.focus();
  };
  button.addEventListener('click', () => setOpen(menu.hidden));

  wrap.append(button, menu);
  return wrap;
}
