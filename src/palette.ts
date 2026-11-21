import { groupParts } from './partcategories';
import { PARTS, type PartType } from './parts';
import { partImageUrl } from './sprites';
import { TipBubble } from './tipbubble';

const ICON_CELL = 12; // pixels per grid cell in menu icons
const ICON_BOX = { w: 72, h: 48 }; // .palette-icon; big parts (boards) are scaled down to fit
const OPEN_KEY = 'gatehouse.palette.open'; // per-user: which sections are unfolded

export interface PaletteAction {
  name: string;
  hint: string;
  run: () => void;
}

const NARROW_SCREEN = 600; // CSS px: start with the menu folded away, so the grid keeps some room

function loadOpen(): Set<string> {
  try {
    const raw = window.localStorage.getItem(OPEN_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveOpen(open: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
  } catch {
    // storage blocked: the sections just start folded next time
  }
}

/**
 * Retractable parts menu, a column on the right of `parent` (the Circuit
 * panel's row: the grid area beside it takes the rest of the width and its
 * canvas resizes when the menu folds).
 * The parts are sorted into named sections (partcategories.ts); a click on a
 * section's header unfolds or folds it with a smooth height animation. Tiles
 * show only the icon, the name shows in a bubble on hover. Pressing on a tile
 * calls `onGrab`, which starts dragging that part onto the grid. `examples`
 * become buttons under the list.
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

  const bubble = new TipBubble('left');

  const cats = document.createElement('div');
  cats.className = 'palette-cats';
  cats.addEventListener('scroll', () => bubble.hide());
  panel.appendChild(cats);

  const open = loadOpen();

  const makeTile = (part: PartType): HTMLElement => {
    const item = document.createElement('div');
    item.className = 'palette-item';
    // Tiles show only the icon; the name shows in a bubble while the mouse is over the tile.
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `${part.name}: drag onto the grid`);

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

    item.append(iconBox);
    item.addEventListener('pointerenter', () => bubble.show(item, part.name));
    item.addEventListener('pointerleave', () => bubble.hide());
    item.addEventListener('pointerdown', (e) => {
      bubble.hide(); // out of the way while the part is dragged onto the grid
      if (e.button === 0) onGrab(part.id, e);
    });
    return item;
  };

  /** One foldable section: a header button and a body that animates open and closed. */
  const addSection = (id: string, label: string, count: number, content: HTMLElement): void => {
    const section = document.createElement('section');
    section.className = 'palette-cat';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'palette-cat-head';
    head.id = `palette-cat-${id}`;
    const chevron = document.createElement('span');
    chevron.className = 'palette-cat-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'palette-cat-name';
    name.textContent = label;
    const total = document.createElement('span');
    total.className = 'palette-cat-count';
    total.textContent = String(count);
    head.append(chevron, name, total);

    // The body animates its height from 0fr to 1fr (a grid trick, no measuring); the inner box clips it.
    const body = document.createElement('div');
    body.className = 'palette-cat-body';
    body.id = `palette-cat-body-${id}`;
    body.setAttribute('role', 'region');
    body.setAttribute('aria-labelledby', head.id);
    const inner = document.createElement('div');
    inner.className = 'palette-cat-inner';
    inner.appendChild(content);
    body.appendChild(inner);

    head.setAttribute('aria-controls', body.id);
    const setSection = (unfold: boolean): void => {
      section.classList.toggle('open', unfold);
      head.setAttribute('aria-expanded', String(unfold));
      body.inert = !unfold; // folded content can not be reached or hovered
    };
    setSection(open.has(id));
    head.addEventListener('click', () => {
      const unfold = !section.classList.contains('open');
      setSection(unfold);
      if (unfold) open.add(id);
      else open.delete(id);
      saveOpen(open);
      bubble.hide();
    });

    section.append(head, body);
    cats.appendChild(section);
  };

  for (const group of groupParts(PARTS)) {
    const list = document.createElement('div');
    list.className = 'palette-list';
    for (const part of group.parts) list.appendChild(makeTile(part));
    addSection(group.id, group.name, group.parts.length, list);
  }

  if (examples.length > 0) {
    const list = document.createElement('div');
    list.className = 'palette-examples';
    for (const example of examples) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'palette-example';
      b.textContent = example.name;
      b.title = example.hint;
      b.addEventListener('click', example.run);
      list.appendChild(b);
    }
    addSection('examples', 'Examples', examples.length, list);
  }

  const setOpen = (isOpen: boolean): void => {
    panel.classList.toggle('closed', !isOpen);
    toggle.textContent = isOpen ? '›' : '‹';
    bubble.hide();
  };
  toggle.addEventListener('click', () => setOpen(panel.classList.contains('closed')));
  setOpen(window.innerWidth > NARROW_SCREEN);

  parent.appendChild(panel);
}
