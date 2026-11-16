import { PARTS } from './parts';
import { partImageUrl } from './sprites';

const ICON_CELL = 12; // pixels per grid cell in menu icons

/**
 * Retractable parts menu on the right. Pressing on an item calls `onGrab`,
 * which starts dragging that part onto the grid.
 */
export function createPalette(parent: HTMLElement, onGrab: (typeId: string, e: PointerEvent) => void): void {
  const panel = document.createElement('aside');
  panel.id = 'palette';

  const toggle = document.createElement('button');
  toggle.id = 'palette-toggle';
  toggle.type = 'button';
  toggle.title = 'Show or hide parts';
  panel.appendChild(toggle);

  const title = document.createElement('h2');
  title.textContent = 'Parts';
  panel.appendChild(title);

  const list = document.createElement('div');
  list.className = 'palette-list';
  panel.appendChild(list);

  for (const part of PARTS) {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.title = `Drag ${part.name} onto the grid`;

    const icon = document.createElement('img');
    icon.src = partImageUrl(part);
    icon.width = part.cols * ICON_CELL;
    icon.height = part.rows * ICON_CELL;
    icon.alt = '';
    icon.draggable = false;
    const iconBox = document.createElement('div');
    iconBox.className = 'palette-icon';
    iconBox.appendChild(icon);

    const label = document.createElement('span');
    label.textContent = part.name;

    item.append(iconBox, label);
    item.addEventListener('pointerdown', (e) => {
      if (e.button === 0) onGrab(part.id, e);
    });
    list.appendChild(item);
  }

  const setOpen = (open: boolean): void => {
    panel.classList.toggle('closed', !open);
    toggle.textContent = open ? '›' : '‹';
  };
  toggle.addEventListener('click', () => setOpen(panel.classList.contains('closed')));
  setOpen(true);

  parent.appendChild(panel);
}
