// The keyboard shortcuts sheet: a glass card listing every shortcut, opened with
// the ? key or the round ? button in the corner of the grid, closed with Esc, the
// x, or a click outside it. While it is open it owns the keyboard: nothing else
// (rotate, delete, undo ...) reacts to a key press behind it. UI-only state.
// The list itself is in shortcuts.ts.

import { SHORTCUT_GROUPS, formatKey, isMacPlatform } from './shortcuts';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** True when the key press is going into a text field, where "?" is just a character. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export class ShortcutSheet {
  private readonly backdrop = document.createElement('div');
  private readonly card = document.createElement('div');
  private readonly closeButton = document.createElement('button');
  private readonly mac = isMacPlatform(navigator.platform);
  private returnFocus: HTMLElement | null = null;
  private isOpen = false;

  /** `buttonParent`: where the round ? button goes (the corner of the grid). */
  constructor(buttonParent: HTMLElement) {
    const backdrop = this.backdrop;
    backdrop.className = 'shortcut-backdrop';
    backdrop.hidden = true;
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) this.close(); // a click outside the card
    });

    const card = this.card;
    card.className = 'shortcut-sheet';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Keyboard shortcuts');

    const header = document.createElement('div');
    header.className = 'shortcut-header';
    const title = document.createElement('h2');
    title.className = 'shortcut-title';
    title.textContent = 'Keyboard shortcuts';
    this.closeButton.type = 'button';
    this.closeButton.className = 'shortcut-close';
    this.closeButton.textContent = '×';
    this.closeButton.title = 'Close (Esc)';
    this.closeButton.setAttribute('aria-label', 'Close the shortcuts');
    this.closeButton.addEventListener('click', () => this.close());
    header.append(title, this.closeButton);

    const body = document.createElement('div');
    body.className = 'shortcut-body';
    for (const group of SHORTCUT_GROUPS) {
      const section = document.createElement('section');
      section.className = 'shortcut-group';
      const heading = document.createElement('h3');
      heading.textContent = group.title;
      const list = document.createElement('dl');
      for (const item of group.items) {
        const row = document.createElement('div');
        row.className = 'shortcut-row';
        const label = document.createElement('dt');
        label.textContent = item.label;
        const keys = document.createElement('dd');
        item.keys.forEach((chord, i) => {
          if (i > 0) {
            const or = document.createElement('span');
            or.className = 'shortcut-or';
            or.textContent = 'or';
            keys.appendChild(or);
          }
          const combo = document.createElement('span');
          combo.className = 'shortcut-combo';
          chord.forEach((key, j) => {
            if (j > 0) combo.append('+');
            const cap = document.createElement('kbd');
            cap.className = 'shortcut-key';
            cap.textContent = formatKey(key, this.mac);
            combo.appendChild(cap);
          });
          keys.appendChild(combo);
        });
        row.append(label, keys);
        list.appendChild(row);
      }
      section.append(heading, list);
      body.appendChild(section);
    }

    card.append(header, body);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    const help = document.createElement('button');
    help.type = 'button';
    help.className = 'help-button';
    help.textContent = '?';
    help.title = 'Keyboard shortcuts (?)';
    help.setAttribute('aria-label', 'Keyboard shortcuts');
    help.addEventListener('click', () => this.toggle());
    buttonParent.appendChild(help);

    // Capture phase on the document: runs before the grid's own key handling on the window.
    document.addEventListener('keydown', this.onKeyDown, true);
  }

  get opened(): boolean {
    return this.isOpen;
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.backdrop.hidden = false;
    this.closeButton.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.backdrop.hidden = true;
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back && back.isConnected) back.focus({ preventScroll: true });
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.isOpen) {
      // "?" opens it, except while typing in a field and with Ctrl / Alt held.
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        this.open();
      }
      return;
    }
    // Open: this card owns the keyboard.
    e.stopPropagation();
    if (e.key === 'Escape' || e.key === '?') {
      e.preventDefault();
      this.close();
    } else if (e.key === 'Tab') {
      // Keep the focus inside the card.
      const focusable = [...this.card.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !this.card.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !this.card.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
  };
}
