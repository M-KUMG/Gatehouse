// The bar next to the selection (same glass look as the file bar): a chip with
// the name and value of what is selected (a click edits the value), then rotate,
// flip, duplicate, delete, and for one selected board Run / Pause, Build, Reset,
// the Serial console and Rename. Also the zoom controls and small readouts.

import type { BoardToolbar, ToolbarButtons } from './boardcontrols';
import './partbar.css';
import type { FoldHost } from './barfold';
import { attachDrop } from './droplight';
import type { SelectionLabel } from './partlabel';
import { MAX_ZOOM, MIN_ZOOM } from './camera';
import type { ScreenRect } from './grid';

const GAP = 8; // between the selection and the toolbar
const FOLD_WIDTH = 300; // the bar's width while an editor is unfolded
const FOLD_MS = 420; // a little over the fold transition (partbar.css)
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

const SIMPLE_BUTTONS = ['rotate', 'flipH', 'flipV', 'duplicate'] as const;

export class Toolbar {
  private readonly el: HTMLDivElement;
  private readonly buttons: Record<(typeof SIMPLE_BUTTONS)[number], HTMLButtonElement>;
  /** The first row: the chip and the buttons. The fold below it holds the value and name editors. */
  private readonly row = document.createElement('div');
  private readonly fold = document.createElement('div');
  private readonly foldBody = document.createElement('div');
  private foldContent: HTMLElement | null = null;
  private foldTimer = 0;
  private chipWasOpen = false;
  /** The bar's left edge while an editor is unfolded, else null. */
  /** While an editor is unfolded: the bar's left edge, as an offset from the selection's right edge (null when closed). */
  private anchorLeft: number | null = null;
  private lastTargetRight = 0;
  private readonly chip = document.createElement('button');
  private readonly chipTitle = document.createElement('span');
  private readonly chipValue = document.createElement('span');
  private readonly runButton: HTMLButtonElement;
  private readonly buildButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly consoleButton: HTMLButtonElement;
  private readonly renameButton: HTMLButtonElement;
  private readonly boardGroup = document.createElement('div');
  /** What the board buttons show now (so they are only touched when it changes). */
  private runIcon = '';
  private boardShown = '';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    actions: ToolbarActions,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'selection-toolbar';
    attachDrop(this.el, '.tool-button, .tool-chip.editable');
    this.chip.type = 'button';
    this.chip.className = 'tool-chip';
    this.chipTitle.className = 'tool-chip-title';
    this.chipValue.className = 'tool-chip-value';
    this.chip.append(this.chipTitle, this.chipValue);
    // A press on the chip first takes the focus away from an open editor, which closes it: the click then
    // must not open it again (so the chip works as a toggle).
    this.chip.addEventListener('pointerdown', () => {
      this.chipWasOpen = this.foldContent !== null;
    });
    this.chip.addEventListener('click', () => {
      if (this.chip.classList.contains('editable') && !this.chipWasOpen) actions.edit();
    });
    this.buttons = {
      rotate: button('Rotate 90° clockwise (R)', ICONS.rotate, actions.rotate),
      flipH: button('Flip horizontal (H)', ICONS.flipH, actions.flipH),
      flipV: button('Flip vertical (V)', ICONS.flipV, actions.flipV),
      duplicate: button('Duplicate (Ctrl+D)', ICONS.duplicate, actions.duplicate),
    };
    this.runButton = button('Run', ICONS.run, actions.run, 'run');
    this.buildButton = button('Build (compile only)', ICONS.build, actions.build, 'build');
    this.resetButton = button('Reset (rebuild from files)', ICONS.reset, actions.reset);
    this.consoleButton = button('Open serial console', ICONS.console, actions.console);
    this.renameButton = button('Rename board (display name only)', ICONS.rename, actions.rename);
    this.boardGroup.className = 'tool-group';
    this.boardGroup.append(this.runButton, this.buildButton, this.resetButton, this.consoleButton, this.renameButton);
    this.row.className = 'tool-row';
    this.row.append(
      this.chip,
      this.boardGroup,
      ...SIMPLE_BUTTONS.map((name) => this.buttons[name]),
      button('Delete (Del)', ICONS.delete, actions.delete, 'danger'),
    );
    // The fold: grows from 0 to its content's height (a grid-rows transition, no measuring) under the row.
    this.fold.className = 'tool-fold';
    this.fold.inert = true;
    const inner = document.createElement('div');
    inner.className = 'tool-fold-inner';
    this.foldBody.className = 'tool-fold-body';
    inner.append(this.foldBody);
    this.fold.append(inner);
    this.el.append(this.row, this.fold);
    document.body.appendChild(this.el);
    this.show(null);
  }

  /** Show the toolbar beside a viewport rectangle, or hide it with null. */
  show(target: ScreenRect | null, buttons: ToolbarButtons = NO_BUTTONS, label: SelectionLabel | null = null): void {
    const el = this.el;
    this.showChip(label, buttons.edit);
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
    // While an editor is unfolded the bar keeps its left edge (it only shifts left when it would leave the
    // grid), so unfolding never makes it jump to the other side of the part.
    // The kept edge is an offset from the selection, so panning and zooming move the bar with the part.
    this.lastTargetRight = target.right;
    let left = this.anchorLeft !== null ? target.right + this.anchorLeft : target.right + GAP;
    if (this.anchorLeft === null && left + w > area.right) left = target.left - GAP - w;
    left = Math.max(area.left, Math.min(left, area.right - w));
    const top = Math.max(area.top, Math.min(target.top - 4, area.bottom - h));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  /** Lets the value and name editors unfold the bar instead of opening a popup (barfold.ts). */
  readonly foldHost: FoldHost = {
    available: () => this.el.style.display !== 'none',
    show: (content) => this.showFold(content),
    hide: (content) => this.hideFold(content),
  };

  private showFold(content: HTMLElement): void {
    window.clearTimeout(this.foldTimer);
    if (this.anchorLeft === null) this.anchorLeft = this.el.getBoundingClientRect().left - this.lastTargetRight;
    this.foldBody.replaceChildren(content);
    this.foldContent = content;
    // The bar widens to the editor (a width transition needs numbers, so from its own width to the new one).
    const closed = this.row.offsetWidth + 8; // padding and border of the bar
    if (!this.fold.classList.contains('open')) this.el.style.width = `${this.el.offsetWidth}px`;
    void this.el.offsetWidth;
    this.el.style.width = `${Math.max(closed, FOLD_WIDTH)}px`;
    this.fold.inert = false;
    this.fold.classList.add('open');
  }

  private hideFold(content: HTMLElement): void {
    if (this.foldContent !== content) return; // another editor has taken the fold meanwhile
    this.foldContent = null;
    this.fold.inert = true;
    this.fold.classList.remove('open');
    this.el.style.width = `${this.row.offsetWidth + 8}px`;
    window.clearTimeout(this.foldTimer);
    this.foldTimer = window.setTimeout(() => {
      if (this.foldContent !== null) return;
      this.foldBody.replaceChildren();
      this.anchorLeft = null;
      this.el.style.width = ''; // the bar is as wide as its row again, whatever the chip says next
    }, FOLD_MS);
  }

  /** The name chip: what is selected and its value; a click edits the value when the part has one. Touched only when it changes. */
  private showChip(label: SelectionLabel | null, editable: boolean): void {
    this.chip.style.display = label ? '' : 'none';
    if (!label) return;
    if (this.chipTitle.textContent !== label.title) this.chipTitle.textContent = label.title;
    if (this.chipValue.textContent !== label.value) this.chipValue.textContent = label.value;
    this.chipValue.style.display = label.value ? '' : 'none';
    this.chip.classList.toggle('editable', editable);
    this.chip.title = editable ? 'Edit the value (or double-click the part)' : label.title;
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
    // Only when the icon changes: replacing the svg under the pointer between press and release drops the click.
    if (this.runIcon !== run.icon) {
      this.runIcon = run.icon;
      this.runButton.innerHTML = run.icon === 'pause' ? ICONS.pause : ICONS.run;
    }
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
  attachDrop(group, '.zoom-button, .zoom-readout');
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
