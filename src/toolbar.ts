// Floating round buttons next to the selection: rotate, duplicate, edit
// value, delete, and for one selected board Run / Pause, Reset, the Serial
// console and Rename. Also the small readouts along the bottom edge.

import type { BoardToolbar, ToolbarButtons } from './boardcontrols';
import type { ScreenRect } from './grid';

const GAP = 8; // between the selection and the toolbar
const MARGIN = 6; // to the edges of the visible grid

const svg = (body: string): string =>
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  `stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  rotate: svg('<path d="M20 11a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>'),
  duplicate: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  run: svg('<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>'),
  pause: svg('<path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="3"/>'),
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
  duplicate: () => void;
  edit: () => void;
  delete: () => void;
  /** Board buttons: Run or Pause (whichever the button shows), Reset, Serial console. */
  run: () => void;
  reset: () => void;
  console: () => void;
  /** Board button: open the rename popup. */
  rename: () => void;
}

const NO_BUTTONS: ToolbarButtons = { rotate: true, duplicate: true, edit: false, board: null };

export class Toolbar {
  private readonly el: HTMLDivElement;
  private readonly buttons: Record<'rotate' | 'duplicate' | 'edit', HTMLButtonElement>;
  private readonly runButton: HTMLButtonElement;
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
      duplicate: button('Duplicate (Ctrl+D)', ICONS.duplicate, actions.duplicate),
      edit: button('Edit value (double-click)', ICONS.edit, actions.edit),
    };
    this.runButton = button('Run', ICONS.run, actions.run, 'run');
    this.resetButton = button('Reset (rebuild from files)', ICONS.reset, actions.reset);
    this.consoleButton = button('Open serial console', ICONS.console, actions.console);
    this.renameButton = button('Rename board (display name only)', ICONS.rename, actions.rename);
    this.boardGroup.className = 'tool-group';
    this.boardGroup.append(this.runButton, this.resetButton, this.consoleButton, this.renameButton);
    this.el.append(
      this.boardGroup,
      this.buttons.rotate, this.buttons.duplicate, this.buttons.edit,
      button('Delete (Del)', ICONS.delete, actions.delete, 'danger'),
    );
    document.body.appendChild(this.el);
    this.show(null);
  }

  /** Show the toolbar beside a viewport rectangle, or hide it with null. */
  show(target: ScreenRect | null, buttons: ToolbarButtons = NO_BUTTONS): void {
    const el = this.el;
    for (const name of ['rotate', 'duplicate', 'edit'] as const) {
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

  /** Run / Reset / Serial console / Rename: shown for one selected board; touched only when what they show changes. */
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

/** "100%" label in the bottom-left corner of `parent`; clicking it resets the zoom. */
export function createZoomReadout(parent: HTMLElement, getZoom: () => number, reset: () => void): () => void {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'zoom-readout';
  el.title = 'Zoom (mouse wheel). Click to reset to 100%';
  el.addEventListener('click', reset);
  parent.appendChild(el);
  let shown = '';
  return () => {
    const text = `${Math.round(getZoom() * 100)}%`;
    if (text !== shown) el.textContent = shown = text;
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
