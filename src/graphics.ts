// The graphics setting: how the interface is drawn. 'glass' is the liquid glass
// look (translucent panels with blur); 'solid' has no transparency and no blur
// (solid.css): easier to read on a projector, lighter on weak graphics cards.
// A choice is kept in the browser (localStorage), and applied as
// <html data-graphics="...">, which is all the stylesheets look at. More looks
// can be added to GRAPHICS_MODES (and a block in a stylesheet) without touching
// the menu.

export type GraphicsMode = 'glass' | 'solid';

export interface GraphicsChoice {
  id: GraphicsMode;
  label: string;
  hint: string;
}

export const GRAPHICS_MODES: readonly GraphicsChoice[] = [
  { id: 'glass', label: 'Glass', hint: 'Liquid glass: translucent panels with blur' },
  { id: 'solid', label: 'Solid', hint: 'No transparency or blur: easier to read and lighter on the graphics card' },
];

export const DEFAULT_GRAPHICS: GraphicsMode = 'glass';
const STORAGE_KEY = 'gatehouse.graphics';

/** A saved value as a mode, or null when it is not one. */
export function parseGraphics(value: unknown): GraphicsMode | null {
  return GRAPHICS_MODES.find((m) => m.id === value)?.id ?? null;
}

/** What to start with: the saved choice; without one, solid for people who asked their system for less transparency. */
export function initialGraphics(saved: string | null, reducedTransparency: boolean): GraphicsMode {
  return parseGraphics(saved) ?? (reducedTransparency ? 'solid' : DEFAULT_GRAPHICS);
}

let current: GraphicsMode = DEFAULT_GRAPHICS;
const listeners: ((mode: GraphicsMode) => void)[] = [];

export function graphicsMode(): GraphicsMode {
  return current;
}

/** Call `fn` after every change of the mode. Returns an unsubscribe. */
export function onGraphicsChange(fn: (mode: GraphicsMode) => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function apply(mode: GraphicsMode): void {
  current = mode;
  if (typeof document !== 'undefined') document.documentElement.dataset.graphics = mode;
}

/** Switch the look, keep the choice. */
export function setGraphics(mode: GraphicsMode): void {
  if (mode === current) return;
  apply(mode);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Private window or blocked storage: the choice just lasts until the page closes.
  }
  for (const fn of [...listeners]) fn(mode);
}

/** Apply the saved (or default) look; call once, before the interface is built. */
export function initGraphics(): GraphicsMode {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // no storage: the default applies
  }
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-transparency: reduce)').matches;
  apply(initialGraphics(saved, reduced));
  return current;
}
