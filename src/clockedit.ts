// The clock chooser of a board: a dropdown that unfolds the part bar (like the
// value and name editors, barfold.ts) with the emulated clock choices and a
// short note on what the setting does. Picking one applies it and folds the bar
// back; Escape or clicking away cancels. A popup next to the bar when it cannot
// unfold.

import type { FoldHost, FoldHostProvider } from './barfold';
import type { ScreenRect } from './grid';
import { leave } from './leave';
import { CLOCK_CHOICES, formatClock } from './mcu/clock';

const NOTE =
  'Applies at the next Run from stopped, or Reset. The firmware is still built for 16 MHz, so delay() and the baud rate count in 16 MHz time.';

export class ClockEditor {
  private el: HTMLDivElement | null = null;
  private provider: FoldHostProvider | null = null;
  private hostedBy: FoldHost | null = null;

  setHost(provider: FoldHostProvider): void {
    this.provider = provider;
  }

  get isOpen(): boolean {
    return this.el !== null;
  }

  /** `current`: the board's clock in hertz; `apply` gets the chosen one; `onDone` runs after it. */
  open(current: number, anchor: ScreenRect, bounds: DOMRect, apply: (hz: number) => void, onDone: () => void): void {
    this.close();
    const el = document.createElement('div');
    el.className = 'value-editor clock-editor';
    const label = document.createElement('label');
    label.textContent = 'Clock';
    const select = document.createElement('select');
    for (const hz of CLOCK_CHOICES) {
      const option = document.createElement('option');
      option.value = String(hz);
      option.textContent = formatClock(hz);
      option.selected = hz === current;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      this.close();
      apply(Number(select.value));
      onDone();
    });
    label.append(select);
    const note = document.createElement('div');
    note.className = 'clock-note';
    note.textContent = NOTE;
    el.append(label, note);
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.close();
    });

    const host = this.provider?.() ?? null;
    this.el = el;
    if (host?.available()) {
      el.classList.add('in-bar');
      this.hostedBy = host;
      host.show(el);
    } else {
      this.hostedBy = null;
      document.body.appendChild(el);
      el.style.left = `${Math.max(bounds.left + 8, Math.min(anchor.left, bounds.right - el.offsetWidth - 8))}px`;
      el.style.top = `${Math.max(bounds.top + 8, Math.min(anchor.bottom + 8, bounds.bottom - el.offsetHeight - 8))}px`;
    }
    // Closes when the focus leaves the editor altogether (its glass list does not take the focus).
    el.addEventListener('focusout', (e) => {
      const next = e.relatedTarget;
      if (!(next instanceof Node && el.contains(next))) this.close();
    });
    select.focus();
    queueMicrotask(() => el.querySelector<HTMLElement>('.gs-trigger')?.focus()); // the glass button replaces the native select
  }

  close(): void {
    const el = this.el;
    this.el = null;
    if (!el) return;
    const host = this.hostedBy;
    this.hostedBy = null;
    if (host) host.hide(el);
    else leave(el);
  }
}
