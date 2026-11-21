// Floating round buttons next to the selection: rotate, flip, duplicate, edit
// value, delete, and for one selected board Run / Pause, Build, Reset, the Serial
// console and Rename. Also the small readouts along the bottom edge.

import type { BoardToolbar, ToolbarButtons } from './boardcontrols';
import { MAX_ZOOM, MIN_ZOOM } from './camera';
import type { ScreenRect } from './grid';

const GAP = 8; // between the selection and the toolbar
const MARGIN = 6; // to the edges of the visible grid

const svg = (body: string): string =>
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  `stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  rotate: svg('<path d="M20 11a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>'),
  // A dashed mirror line between a filled shape and its outlined mirror image.
  flipH: svg('<path d="M12 3v18" stroke-dasharray="2 2.5"/><path d="M9 6L3 18h6z" fill="currentColor"/><path d="M15 6l6 12h-6z"/>'),
  flipV: svg('<path d="M3 12h18" stroke-dasharray="2 2.5"/><path d="M6 9L18 3v6z" fill="currentColor"/><path d="M6 15l12 6v-6z"/>'),
  duplicate: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  run: svg('<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>'),
  pause: svg('<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="3"/>'),
  build: svg('<rect x="10" y="6" width="11" height="5" rx="1" transform="rotate(45 15.5 8.5)"/><path d="M4.5 19.5L14 10"/>'),
  reset: svg('<path d="M12 3.5v8"/><path d="M6.6 6.8a8 8 0 1 0 10.8 0"/>'),
  console: svg('<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M7.5 9.5l3 2.5-3 2.5"/><path d="M13 15h4"/>'),
  rename: svg('<path d="M5 15.5L15.5 5l3.5 3.5L8.5 19H5z"/><path d="M13 7.5l3.5 3.5"/><path d="M12 21.5h8"/>'),
  delete: svg(
    '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/>' +
      '<path d="M9 7V4h6v3"/>',
  ),
};

export interface ToolbarActions {
  rotate: () => void;
  /** Mirror left/right and top/bottom. */
  flipH: () => void;
  flipV: () => void;
  duplicate: () => void;
  edit: () => void;
  delete: () => void;
  /** Board buttons: Run or Pause (whichever the button shows), Build (compile only), Reset, Serial console. */
  run: () => void;
  build: () => void;
  reset: () => void;
  console: () => void;
  /** Board button: open the rename popup. */
  rename: () => void;
}

const NO_BUTTONS: ToolbarButtons = { rotate: true, flipH: true, flipV: true, duplicate: true, edit: false, board: null };

const SIMPLE_BUTTONS = ['rotate', 'flipH', 'flipV', 'duplicate', 'edit'] as const;

export class Toolbar {
  private readonly el: HTMLDivElement;
  private readonly buttons: Record<(typeof SIMPLE_BUTTONS)[number], HTMLButtonElement>;
  private readonly runButton: HTMLButtonElement;
  private readonly buildButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly consoleButton: HTMLButtonElement;
  private readonly renameButton: HTMLButtonElement;
  private readonly boardGroup = document.createElement('div');
  /** What the board buttons show now (so they are only touched when it changes). */
  private boardShown = '';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    actions: ToolbarActions,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'selection-toolbar';
    this.buttons = {
      rotate: button('Rotate 90° clockwise (R)', ICONS.rotate, actions.rotate),
      flipH: button('Flip horizontal (H)', ICONS.flipH, actions.flipH),
      flipV: button('Flip vertical (V)', ICONS.flipV, actions.flipV),
      duplicate: button('Duplicate (Ctrl+D)', ICONS.duplicate, actions.duplicate),
      edit: button('Edit value (double-click)', ICONS.edit, actions.edit),
    };
    this.runButton = button('Run', ICONS.run, actions.run, 'run');
    this.buildButton = button('Build (compile only)', ICONS.build, actions.build, 'build');
    this.resetButton = button('Reset (rebuild from files)', ICONS.reset, actions.reset);
    this.consoleButton = button('Open serial console', ICONS.console, actions.console);
    this.renameButton = button('Rename board (display name only)', ICONS.rename, actions.rename);
    this.boardGroup.className = 'tool-group';
    this.boardGroup.append(this.runButton, this.buildButton, this.resetButton, this.consoleButton, this.renameButton);
    this.el.append(
      this.boardGroup,
      ...SIMPLE_BUTTONS.map((name) => this.buttons[name]),
      button('Delete (Del)', ICONS.delete, actions.delete, 'danger'),
    );
    document.body.appendChild(this.el);
    this.show(null);
  }

  /** Show the toolbar beside a viewport rectangle, or hide it with null. */
  show(target: ScreenRect | null, buttons: ToolbarButtons = NO_BUTTONS): void {
    const el = this.el;
    for (const name of SIMPLE_BUTTONS) {
      this.buttons[name].style.display = buttons[name] ? '' : 'none';
    }
    this.showBoardButtons(buttons.board);
    const area = visibleArea(this.canvas);
    if (!target || !isOnScreen(target, area)) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    const w = el.offsetWidth;
    const h = el.offsetHeight;

    // Prefer the top-right of the selection, else its top-left, then clamp.
    let left = target.right + GAP;
    if (left + w > area.right) left = target.left - GAP - w;
    left = Math.max(area.left, Math.min(left, area.right - w));
    const top = Math.max(area.top, Math.min(target.top - 4, area.bottom - h));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  /** The toolbar's viewport rectangle while it is shown, else null (popups open next to it). */
  get rect(): ScreenRect | null {
    if (this.el.style.display === 'none') return null;
    const r = this.el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }

  /** Run / Build / Reset / Serial console / Rename: shown for one selected board; touched only when what they show changes. */
  private showBoardButtons(board: BoardToolbar | null): void {
    this.boardGroup.style.display = board ? '' : 'none';
    const key = board ? JSON.stringify(board) : '';
    if (!board || key === this.boardShown) return;
    this.boardShown = key;
    const run = board.run;
    this.runButton.innerHTML = run.icon === 'pause' ? ICONS.pause : ICONS.run;
    this.runButton.title = run.title;
    this.runButton.setAttribute('aria-label', run.title.split('\n')[0]);
    this.runButton.disabled = run.disabled;
    this.runButton.classList.toggle('has-error', run.error);
    this.buildButton.title = board.build.title;
    this.buildButton.setAttribute('aria-label', board.build.title);
    this.buildButton.disabled = board.build.disabled;
    this.buildButton.classList.toggle('has-error', board.build.error);
    for (const [b, view] of [[this.resetButton, board.reset], [this.consoleButton, board.console], [this.renameButton, board.rename]] as const) {
      b.title = view.title;
      b.setAttribute('aria-label', view.title);
      b.disabled = view.disabled;
    }
  }
}

/** The canvas' own rectangle (it only covers the centre area), less a margin. */
export function visibleArea(canvas: HTMLCanvasElement): ScreenRect {
  const c = canvas.getBoundingClientRect();
  return { left: c.left + MARGIN, top: c.top + MARGIN, right: c.right - MARGIN, bottom: c.bottom - MARGIN };
}

/** True when `target` shows at least partly inside `area`. */
export function isOnScreen(target: ScreenRect, area: ScreenRect): boolean {
  return target.right > area.left && target.left < area.right && target.bottom > area.top && target.top < area.bottom;
}

function button(title: string, icon: string, onClick: () => void, extraClass?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = extraClass ? `tool-button ${extraClass}` : 'tool-button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = icon;
  b.addEventListener('click', onClick);
  return b;
}

export interface ZoomActions {
  getZoom: () => number;
  /** True when there is something on the grid to fit (the fit button is off otherwise). */
  hasContent: () => boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Back to 100%. */
  reset: () => void;
  /** Show everything on the grid. */
  fit: () => void;
}

const ZOOM_ICONS = {
  out: svg('<path d="M5 12h14"/>'),
  in: svg('<path d="M5 12h14M12 5v14"/>'),
  // Four corner brackets: "everything in view".
  fit: svg('<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>'),
};

/**
 * Zoom controls in the bottom-left corner of `parent`: zoom out, the zoom level
 * (a click goes back to 100%), zoom in, and fit everything. Returns a function
 * to call after every frame; it updates the level and which buttons are enabled.
 */
export function createZoomControls(parent: HTMLElement, actions: ZoomActions): () => void {
  const group = document.createElement('div');
  group.className = 'zoom-controls';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Zoom');

  const zoomButton = (title: string, icon: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'zoom-button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = icon;
    b.addEventListener('click', onClick);
    return b;
  };

  const out = zoomButton('Zoom out (−)', ZOOM_ICONS.out, actions.zoomOut);
  const level = document.createElement('button');
  level.type = 'button';
  level.className = 'zoom-readout';
  level.title = 'Zoom level (mouse wheel zooms too). Click to reset to 100% (0)';
  level.addEventListener('click', actions.reset);
  const zoomIn = zoomButton('Zoom in (+)', ZOOM_ICONS.in, actions.zoomIn);
  const divider = document.createElement('span');
  divider.className = 'zoom-divider';
  divider.setAttribute('aria-hidden', 'true');
  const fit = zoomButton('Fit everything in view (F)', ZOOM_ICONS.fit, actions.fit);

  group.append(out, level, zoomIn, divider, fit);
  parent.appendChild(group);

  let shown = '';
  return () => {
    const zoom = actions.getZoom();
    const text = `${Math.round(zoom * 100)}%`;
    if (text !== shown) level.textContent = shown = text;
    out.disabled = zoom <= MIN_ZOOM + 0.001;
    zoomIn.disabled = zoom >= MAX_ZOOM - 0.001;
    fit.disabled = !actions.hasContent();
  };
}

/** One line of text along the bottom edge of `parent`; returns a function that sets it. */
export function createStatusLine(parent: HTMLElement): (text: string) => void {
  const el = document.createElement('div');
  el.className = 'status-line';
  parent.appendChild(el);
  let shown = '';
  return (text) => {
    if (text !== shown) el.textContent = shown = text;
  };
}
