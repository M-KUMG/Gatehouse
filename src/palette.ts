import { PARTS } from './parts';
import { partImageUrl } from './sprites';

const ICON_CELL = 12; // pixels per grid cell in menu icons
const ICON_BOX = { w: 72, h: 48 }; // .palette-icon; big parts (boards) are scaled down to fit

export interface PaletteAction {
  name: string;
  hint: string;
  run: () => void;
}

/**
 * Retractable parts menu on the right. Pressing on an item calls `onGrab`,
 * which starts dragging that part onto the grid. `examples` become buttons
 * under the list.
 */
export function createPalette(
  parent: HTMLElement,
  onGrab: (typeId: string, e: PointerEvent) => void,
  examples: readonly PaletteAction[] = [],
): void {
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
    const cell = Math.min(ICON_CELL, ICON_BOX.w / part.cols, ICON_BOX.h / part.rows);
    icon.width = Math.round(part.cols * cell);
    icon.height = Math.round(part.rows * cell);
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

  if (examples.length > 0) {
    const heading = document.createElement('h2');
    heading.textContent = 'Examples';
    heading.className = 'palette-section';
    panel.appendChild(heading);
    for (const example of examples) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'palette-example';
      b.textContent = example.name;
      b.title = example.hint;
      b.addEventListener('click', example.run);
      panel.appendChild(b);
    }
  }

  const setOpen = (open: boolean): void => {
    panel.classList.toggle('closed', !open);
    toggle.textContent = open ? '›' : '‹';
  };
  toggle.addEventListener('click', () => setOpen(panel.classList.contains('closed')));
  setOpen(true);

  parent.appendChild(panel);
}
