// Tiny popup to type a part's value (e.g. a resistance: "330", "4.7k", "1M"),
// or to pick it from a short list when the part allows only some values
// (a logic gate's supply level: PartType.value.options).

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
    const type = getPart(part.typeId);
    const spec = type?.value;
    if (!spec) return;
    const key = spec.key ?? 'value';
    const current = part.state?.[key] ?? type?.defaults?.[key] ?? spec.min;
    const set = (value: number): void => {
      part.state = { ...part.state, [key]: value };
      this.close();
      onChange();
    };

    const el = document.createElement('div');
    el.className = 'value-editor';
    const label = document.createElement('label');
    label.textContent = spec.label;
    const unit = document.createElement('span');
    unit.textContent = spec.unit;
    let field: HTMLInputElement | HTMLSelectElement;
    if (spec.options) {
      const select = document.createElement('select');
      for (const v of spec.options) {
        const option = document.createElement('option');
        option.value = String(v);
        option.textContent = String(v);
        option.selected = v === current;
        select.appendChild(option);
      }
      select.addEventListener('change', () => set(Number(select.value)));
      field = select;
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.spellcheck = false;
      input.value = formatSI(current, '', 6).trim().replace(' ', '');
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const value = parseSI(input.value);
          if (value === null || value < spec.min || value > spec.max) {
            input.classList.add('invalid');
            return;
          }
          set(value);
        } else if (e.key !== 'Escape') {
          input.classList.remove('invalid');
        }
      });
      field = input;
    }
    field.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') this.close();
    });
    label.append(field, unit);
    el.append(label);
    document.body.appendChild(el);
    this.el = el;

    el.style.left = `${Math.max(bounds.left + 8, Math.min(anchor.left, bounds.right - el.offsetWidth - 8))}px`;
    el.style.top = `${Math.max(bounds.top + 8, Math.min(anchor.bottom + 8, bounds.bottom - el.offsetHeight - 8))}px`;

    field.addEventListener('blur', () => this.close());
    field.focus();
    if (field instanceof HTMLInputElement) field.select();
  }

  close(): void {
    const el = this.el;
    this.el = null;
    el?.remove(); // removing a focused input fires blur, which finds el already cleared
  }
}
