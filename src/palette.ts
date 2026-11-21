import { attachDrop } from './droplight';
import { groupParts } from './partcategories';
import { isNavKey, moveIndex } from './palettenav';
import { searchNamed, searchParts } from './partsearch';
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

/** Size factor of the whole menu, from the `--gh-menu-scale` token in tokens.css (1 when it is missing). */
function menuScale(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--gh-menu-scale');
  const scale = parseFloat(raw);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** Columns of a CSS grid as it is laid out right now (the tiles are two per row today). */
function gridColumns(list: HTMLElement): number {
  return Math.max(1, getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean).length);
}

/**
 * Retractable parts menu, a column on the right of `parent` (the Circuit
 * panel's row: the grid area beside it takes the rest of the width and its
 * canvas resizes when the menu folds).
 * The parts are sorted into named sections (partcategories.ts); a click on a
 * section's header unfolds or folds it with a smooth height animation. A
 * search box above them filters parts and examples (partsearch.ts). Tiles
 * show only the icon, the name shows in a bubble on hover or keyboard focus.
 * With the mouse, pressing on a tile calls `onGrab`, which starts dragging
 * that part onto the grid. With the keyboard, arrow keys move between headers
 * and tiles and Enter or Space on a tile calls `onAdd`, which puts the part
 * in the middle of the grid (return true when it was added). `examples`
 * become buttons in their own section.
 */
export function createPalette(
  parent: HTMLElement,
  onGrab: (typeId: string, e: PointerEvent) => void,
  examples: readonly PaletteAction[] = [],
  onAdd: (typeId: string) => boolean = () => false,
): void {
  const panel = document.createElement('aside');
  panel.id = 'palette';
  panel.setAttribute('aria-label', 'Parts');

  const toggle = document.createElement('button');
  toggle.id = 'palette-toggle';
  toggle.type = 'button';
  toggle.title = 'Show or hide parts';
  toggle.setAttribute('aria-label', 'Show or hide the parts menu');
  // One arrow that turns around as the menu folds (not two glyphs swapped): see motion.css.
  const arrow = document.createElement('span');
  arrow.className = 'palette-toggle-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '›';
  toggle.appendChild(arrow);
  panel.appendChild(toggle);

  const title = document.createElement('h2');
  title.textContent = 'Parts';
  panel.appendChild(title);

  const bubble = new TipBubble('left');

  // Spoken confirmation for keyboard and screen-reader users (nothing visible).
  const live = document.createElement('div');
  live.className = 'sr-only';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  panel.appendChild(live);

  // Search box: while it holds text, matching parts (and examples) show as one list instead of the sections.
  const searchBox = document.createElement('div');
  searchBox.className = 'palette-search';
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'palette-search-input';
  input.placeholder = 'Search parts…';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Search parts');
  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'palette-search-clear';
  clearButton.textContent = '×';
  clearButton.hidden = true;
  clearButton.setAttribute('aria-label', 'Clear search');
  clearButton.title = 'Clear search (Esc)';
  searchBox.append(input, clearButton);
  panel.appendChild(searchBox);

  const cats = document.createElement('div');
  cats.className = 'palette-cats';
  cats.addEventListener('scroll', () => bubble.hide());
  panel.appendChild(cats);

  const results = document.createElement('div');
  results.className = 'palette-cats palette-results';
  results.hidden = true;
  results.setAttribute('role', 'region');
  results.setAttribute('aria-label', 'Search results');
  results.addEventListener('scroll', () => bubble.hide());
  panel.appendChild(results);

  const open = loadOpen();
  const headers: HTMLButtonElement[] = [];
  const categoryOf = new Map(groupParts(PARTS).flatMap((g) => g.parts.map((p) => [p.id, g.name] as const)));
  let resultTiles: HTMLElement[] = [];

  const makeTile = (part: PartType, tiles: HTMLElement[], onLeave?: (key: 'ArrowUp' | 'ArrowDown') => void): HTMLElement => {
    const item = document.createElement('div');
    item.className = 'palette-item';
    // Tiles show only the icon; the name shows in a bubble while the mouse is over the tile or it has the keyboard focus.
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `${part.name}: drag onto the grid, or press Enter to add it`);
    item.tabIndex = -1; // roving: the section makes one tile tabbable

    const icon = document.createElement('img');
    icon.src = partImageUrl(part);
    const scale = menuScale(); // icons grow with the menu (the box in style.css does too)
    const cell = Math.min(ICON_CELL * scale, (ICON_BOX.w * scale) / part.cols, (ICON_BOX.h * scale) / part.rows);
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
    // Keyboard focus (not a mouse press) shows the name too.
    item.addEventListener('focus', () => {
      if (item.matches(':focus-visible')) bubble.show(item, part.name);
    });
    item.addEventListener('blur', () => bubble.hide());
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (e.repeat) return;
        live.textContent = onAdd(part.id) ? `Added ${part.name} to the grid` : `Could not add ${part.name}`;
        return;
      }
      if (!isNavKey(e.key)) return;
      e.preventDefault();
      const here = tiles.indexOf(item);
      const next = moveIndex(here, e.key, tiles.length, gridColumns(item.parentElement ?? item));
      if (next === null) {
        if (onLeave) {
          onLeave(e.key === 'ArrowUp' ? 'ArrowUp' : 'ArrowDown');
          return;
        }
        // Out of the grid: up goes to the section header, down to the next header.
        const header = headers.findIndex((h) => h.getAttribute('aria-controls') === item.closest('.palette-cat-body')?.id);
        const target = e.key === 'ArrowUp' ? header : header + 1;
        headers[target]?.focus();
      } else {
        focusTile(tiles, next);
      }
    });
    tiles.push(item);
    return item;
  };

  /** Roving tabindex: only the focused (or first) tile of a section is a Tab stop. */
  const focusTile = (tiles: HTMLElement[], index: number): void => {
    tiles.forEach((t, i) => {
      t.tabIndex = i === index ? 0 : -1;
    });
    tiles[index]?.focus();
  };

  /** One foldable section: a header button and a body that animates open and closed. */
  const addSection = (id: string, label: string, count: number, content: HTMLElement, tiles: HTMLElement[] = []): void => {
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
    // Arrow keys walk the headers; Right (or Down on an open section) steps into its tiles.
    head.addEventListener('keydown', (e) => {
      if (!isNavKey(e.key)) return;
      const here = headers.indexOf(head);
      if (e.key === 'ArrowRight' || (e.key === 'ArrowDown' && section.classList.contains('open') && tiles.length > 0)) {
        if (section.classList.contains('open') && tiles.length > 0) {
          e.preventDefault();
          focusTile(tiles, 0);
        }
        return;
      }
      if (e.key === 'ArrowLeft') {
        if (section.classList.contains('open')) {
          e.preventDefault();
          head.click(); // fold it
        }
        return;
      }
      e.preventDefault();
      const next = moveIndex(here, e.key, headers.length, 1);
      if (next !== null) headers[next]?.focus();
      else if (e.key === 'ArrowUp') input.focus(); // up from the first header goes back to the search box
    });

    if (tiles[0]) tiles[0].tabIndex = 0;
    headers.push(head);
    section.append(head, body);
    cats.appendChild(section);
  };

  for (const group of groupParts(PARTS)) {
    const list = document.createElement('div');
    list.className = 'palette-list';
    attachDrop(list, '.palette-item', { over: true });
    const tiles: HTMLElement[] = [];
    for (const part of group.parts) list.appendChild(makeTile(part, tiles));
    addSection(group.id, group.name, group.parts.length, list, tiles);
  }

  const makeExampleButton = (example: PaletteAction): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'palette-example';
    b.textContent = example.name;
    b.title = example.hint;
    b.addEventListener('click', example.run);
    return b;
  };

  if (examples.length > 0) {
    const list = document.createElement('div');
    list.className = 'palette-examples';
    for (const example of examples) list.appendChild(makeExampleButton(example));
    addSection('examples', 'Examples', examples.length, list);
  }

  // ---- Search: matches replace the sections until the box is empty again ----
  const showResults = (): void => {
    const query = input.value;
    const searching = query.trim() !== '';
    clearButton.hidden = !searching;
    cats.hidden = searching;
    results.hidden = !searching;
    bubble.hide();
    results.replaceChildren();
    resultTiles = [];
    if (!searching) {
      live.textContent = '';
      return;
    }

    const foundParts = searchParts(PARTS, query, (id) => categoryOf.get(id) ?? '');
    const foundExamples = searchNamed(examples, query);
    const total = foundParts.length + foundExamples.length;
    const summary = total === 0 ? 'No results' : `${total} result${total === 1 ? '' : 's'}`;

    const heading = document.createElement('div');
    heading.className = 'palette-results-count';
    heading.textContent = total === 0 ? `No parts match “${query.trim()}”` : summary;
    results.appendChild(heading);

    if (foundParts.length > 0) {
      const list = document.createElement('div');
      list.className = 'palette-list';
      attachDrop(list, '.palette-item', { over: true });
      for (const part of foundParts) {
        list.appendChild(makeTile(part, resultTiles, (key) => {
          if (key === 'ArrowUp') input.focus();
        }));
      }
      results.appendChild(list);
      if (resultTiles[0]) resultTiles[0].tabIndex = 0;
    }
    if (foundExamples.length > 0) {
      const label = document.createElement('div');
      label.className = 'palette-results-count';
      label.textContent = 'Examples';
      results.appendChild(label);
      const list = document.createElement('div');
      list.className = 'palette-examples';
      for (const example of foundExamples) list.appendChild(makeExampleButton(example));
      results.appendChild(list);
    }
    live.textContent = summary;
  };

  input.addEventListener('input', showResults);
  clearButton.addEventListener('click', () => {
    input.value = '';
    showResults();
    input.focus();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value !== '') {
      e.preventDefault();
      e.stopPropagation();
      input.value = '';
      showResults();
    } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      if (input.value.trim() === '') headers[0]?.focus();
      else if (resultTiles[0]) focusTile(resultTiles, 0);
      else results.querySelector<HTMLElement>('.palette-example')?.focus();
    }
  });

  const setOpen = (isOpen: boolean): void => {
    panel.classList.toggle('closed', !isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
    bubble.hide();
  };
  toggle.addEventListener('click', () => setOpen(panel.classList.contains('closed')));
  setOpen(window.innerWidth > NARROW_SCREEN);

  parent.appendChild(panel);
}
