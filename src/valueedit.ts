// Tiny popup to type a part's value (e.g. a resistance: "330", "4.7k", "1M").

import { formatSI, parseSI } from './format';
import type { ScreenRect } from './grid';
import type { PlacedPart } from './model';
import { getPart } from './parts';

export class ValueEditor {
  private el: HTMLDivElement | null = null;

  get isOpen(): boolean {
    return this.el !== null;
  }

  /**
   * Open under a viewport rectangle, kept inside `bounds` (the grid's canvas).
   * `onChange` runs after a new value is set.
   */
  open(part: PlacedPart, anchor: ScreenRect, bounds: DOMRect, onChange: () => void): void {
    this.close();
    const spec = getPart(part.typeId)?.value;
    if (!spec) return;

    const el = document.createElement('div');
    el.className = 'value-editor';
    const label = document.createElement('label');
    label.textContent = spec.label;
    const input = document.createElement('input');
    input.type = 'text';
    input.spellcheck = false;
    input.value = formatSI(part.state?.value ?? spec.min, '', 6).trim().replace(' ', '');
    const unit = document.createElement('span');
    unit.textContent = spec.unit;
    label.append(input, unit);
    el.append(label);
    document.body.appendChild(el);
    this.el = el;

    el.style.left = `${Math.max(bounds.left + 8, Math.min(anchor.left, bounds.right - el.offsetWidth - 8))}px`;
    el.style.top = `${Math.max(bounds.top + 8, Math.min(anchor.bottom + 8, bounds.bottom - el.offsetHeight - 8))}px`;

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      } else if (e.key === 'Enter') {
        const value = parseSI(input.value);
        if (value === null || value < spec.min || value > spec.max) {
          input.classList.add('invalid');
          return;
        }
        part.state = { ...part.state, value };
        this.close();
        onChange();
      } else {
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
    el?.remove(); // removing a focused input fires blur, which finds el already cleared
  }
}
