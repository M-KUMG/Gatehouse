// Floating round buttons next to the selection: rotate, duplicate, edit
// value, delete. Also the small readouts along the bottom edge.

import type { ScreenRect } from './grid';

const GAP = 8; // between the selection and the toolbar
const MARGIN = 6; // to the edges of the visible grid
const TAB_WIDTH = 28; // the menu's show/hide tab sticks out to its left

const svg = (body: string): string =>
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  `stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  rotate: svg('<path d="M20 11a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>'),
  duplicate: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
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
}

/** Which buttons make sense for the current selection (delete always does). */
export interface ToolbarButtons {
  rotate: boolean;
  duplicate: boolean;
  edit: boolean;
}

export class Toolbar {
  private readonly el: HTMLDivElement;
  private readonly buttons: Record<keyof ToolbarButtons, HTMLButtonElement>;

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
    this.el.append(
      this.buttons.rotate, this.buttons.duplicate, this.buttons.edit,
      button('Delete (Del)', ICONS.delete, actions.delete, 'danger'),
    );
    document.body.appendChild(this.el);
    this.show(null);
  }

  /** Show the toolbar beside a viewport rectangle, or hide it with null. */
  show(target: ScreenRect | null, buttons: ToolbarButtons = { rotate: true, duplicate: true, edit: false }): void {
    const el = this.el;
    for (const name of ['rotate', 'duplicate', 'edit'] as const) {
      this.buttons[name].style.display = buttons[name] ? '' : 'none';
    }
    const area = this.visibleArea();
    const onScreen =
      target && target.right > area.left && target.left < area.right && target.bottom > area.top && target.top < area.bottom;
    if (!target || !onScreen) {
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

  /** The canvas area that is not covered by the parts menu. */
  private visibleArea(): ScreenRect {
    const c = this.canvas.getBoundingClientRect();
    let right = c.right;
    const menu = document.getElementById('palette');
    if (menu) right = Math.min(right, menu.getBoundingClientRect().left - TAB_WIDTH);
    return { left: c.left + MARGIN, top: c.top + MARGIN, right: right - MARGIN, bottom: c.bottom - MARGIN };
  }
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

/** "100%" label in the bottom-left corner; clicking it resets the zoom. */
export function createZoomReadout(getZoom: () => number, reset: () => void): () => void {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'zoom-readout';
  el.title = 'Zoom (mouse wheel). Click to reset to 100%';
  el.addEventListener('click', reset);
  document.body.appendChild(el);
  let shown = '';
  return () => {
    const text = `${Math.round(getZoom() * 100)}%`;
    if (text !== shown) el.textContent = shown = text;
  };
}

/** One line of text along the bottom edge; returns a function that sets it. */
export function createStatusLine(): (text: string) => void {
  const el = document.createElement('div');
  el.className = 'status-line';
  document.body.appendChild(el);
  let shown = '';
  return (text) => {
    if (text !== shown) el.textContent = shown = text;
  };
}
