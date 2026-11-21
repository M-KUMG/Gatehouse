// The right-click menu on the grid: a small glass menu at the mouse with the
// actions for what was clicked (the content comes from contextmenumodel.ts, the
// Editor runs the chosen action). It closes on Escape, on a press anywhere else,
// on scroll or zoom, when the window loses focus, and after a choice. The arrow
// keys move through it, Enter or Space picks. UI-only: nothing here is saved.

import { formatHint, type MenuItemId, type MenuModel } from './contextmenumodel';
import { isMacPlatform } from './shortcuts';

const EDGE = 8; // px kept free between the menu and the window edges

export class ContextMenu {
  private readonly el = document.createElement('div');
  private readonly mac = isMacPlatform(navigator.platform);
  private isOpen = false;

  constructor() {
    const el = this.el;
    el.className = 'context-menu';
    el.setAttribute('role', 'menu');
    el.hidden = true;
    document.body.appendChild(el);

    // A press anywhere outside the menu closes it (the press itself still does its own job).
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (this.isOpen && !(e.target instanceof Node && el.contains(e.target))) this.close();
      },
      true,
    );
    document.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('blur', () => this.close());
    window.addEventListener('resize', () => this.close());
    window.addEventListener('wheel', () => this.close(), { capture: true, passive: true });
    window.addEventListener('scroll', () => this.close(), true);
  }

  get opened(): boolean {
    return this.isOpen;
  }

  /** Show the menu with its top-left corner at (x, y) in the window, moved if it would not fit. `onPick` gets the chosen action. */
  show(model: MenuModel, x: number, y: number, onPick: (id: MenuItemId) => void): void {
    const el = this.el;
    el.replaceChildren();

    const title = document.createElement('div');
    title.className = 'context-menu-title';
    title.textContent = model.title;
    el.appendChild(title);

    for (const entry of model.entries) {
      if (entry.kind === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'context-menu-sep';
        sep.setAttribute('role', 'separator');
        el.appendChild(sep);
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = entry.danger ? 'context-menu-item danger' : 'context-menu-item';
      b.setAttribute('role', 'menuitem');
      b.disabled = entry.disabled === true;
      const label = document.createElement('span');
      label.className = 'context-menu-label';
      label.textContent = entry.label;
      b.appendChild(label);
      if (entry.hint) {
        const hint = document.createElement('span');
        hint.className = 'context-menu-hint';
        hint.textContent = formatHint(entry.hint, this.mac);
        b.appendChild(hint);
      }
      b.addEventListener('click', () => {
        this.close();
        onPick(entry.id);
      });
      el.appendChild(b);
    }

    // Measure while it is on screen but invisible, then place it inside the window.
    el.hidden = false;
    el.classList.remove('open');
    el.style.left = '0px';
    el.style.top = '0px';
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(EDGE, Math.min(x, window.innerWidth - w - EDGE));
    const top = Math.max(EDGE, Math.min(y, window.innerHeight - h - EDGE));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    // Grow out of the click point.
    el.style.transformOrigin = `${Math.round(x - left)}px ${Math.round(y - top)}px`;
    void el.offsetWidth; // flush, so the transition starts from the closed state
    el.classList.add('open');
    this.isOpen = true;
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('open');
    this.el.hidden = true;
  }

  private items(): HTMLButtonElement[] {
    return [...this.el.querySelectorAll<HTMLButtonElement>('.context-menu-item:not(:disabled)')];
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    const items = this.items();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (items.length === 0) return;
      const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at <= 0 ? items.length - 1 : at - 1);
      items[next]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      (e.key === 'Home' ? items[0] : items[items.length - 1])?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation(); // the focused item's own button handles it; the grid must not also react
    } else {
      this.close(); // any other key closes the menu and still does its own job
    }
  };
}
