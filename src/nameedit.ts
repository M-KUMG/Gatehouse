// Small popup to type a board's display name (the grid's counterpart of the
// File explorer's rename). Same look as the value popup (valueedit.ts): Enter
// commits, Escape or clicking away cancels, a refused name stays open with the
// reason under the field. An empty name restores the default.

import type { ScreenRect } from './grid';
import { leave } from './leave';
import type { FileOpResult } from './project/boardfiles';

const GAP = 8;

export class NameEditor {
  private el: HTMLDivElement | null = null;

  get isOpen(): boolean {
    return this.el !== null;
  }

  /**
   * Open under a viewport rectangle (the toolbar), kept inside `bounds` (the
   * grid's canvas). `text` is what the field starts with, selected; `placeholder`
   * is shown when it is emptied (the default name). `apply` tries the name and
   * says whether it was accepted; `onDone` runs after it was.
   */
  open(
    text: string,
    placeholder: string,
    anchor: ScreenRect,
    bounds: DOMRect,
    apply: (input: string) => FileOpResult,
    onDone: () => void,
  ): void {
    this.close();
    const el = document.createElement('div');
    el.className = 'value-editor name-editor';
    const label = document.createElement('label');
    label.textContent = 'Board name';
    const input = document.createElement('input');
    input.type = 'text';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.placeholder = placeholder;
    input.value = text;
    input.title = 'Display name only: the board folder keeps its name. Empty restores the default name.';
    label.append(input);
    const error = document.createElement('div');
    error.className = 'name-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    el.append(label, error);
    document.body.appendChild(el);
    this.el = el;

    const place = (): void => {
      el.style.left = `${Math.max(bounds.left + 8, Math.min(anchor.left, bounds.right - el.offsetWidth - 8))}px`;
      el.style.top = `${Math.max(bounds.top + 8, Math.min(anchor.bottom + GAP, bounds.bottom - el.offsetHeight - 8))}px`;
    };
    place();

    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing belongs to the field, not to the grid shortcuts
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const result = apply(input.value);
        if (result.ok) {
          this.close();
          onDone();
          return;
        }
        error.textContent = result.error;
        error.hidden = false;
        input.classList.add('invalid');
        place();
      } else if (!error.hidden) {
        error.hidden = true;
        input.classList.remove('invalid');
      }
    });
    input.addEventListener('blur', () => this.close());
    input.focus();
    input.select();
  }

  close(): void {
    const el = this.el;
    this.el = null;
    if (el) leave(el); // a focused input that goes away fires blur, which finds el already cleared
  }
}
