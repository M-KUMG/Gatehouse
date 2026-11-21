// Tiny popup to type a part's value (e.g. a resistance: "330", "4.7k", "1M"),
// or to pick it from a short list when the part allows only some values
// (a logic gate's supply level: PartType.value.options). A part with more
// settings (PartType.fields: a function generator's waveform, amplitude,
// offset, duty) gets one row per field; the popup then stays open after each
// change and closes when the focus leaves it.

import { leave } from './leave';
import type { FoldHost, FoldHostProvider } from './barfold';
import { formatSI, parseSI } from './format';
import type { ScreenRect } from './grid';
import type { PlacedPart } from './model';
import { getPart, type ExtraField } from './parts';

export class ValueEditor {
  private el: HTMLDivElement | null = null;
  private provider: FoldHostProvider | null = null;
  /** The bar fold this editor is in, or null when it is a popup. */
  private hostedBy: FoldHost | null = null;

  /** Where editors go: the part bar's fold (they fall back to a popup when it is not available). */
  setHost(provider: FoldHostProvider): void {
    this.provider = provider;
  }

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
    const multi = (type?.fields?.length ?? 0) > 0;
    const set = (key: string, value: number | string): void => {
      part.state = { ...part.state, [key]: value };
      if (!multi) this.close();
      onChange();
    };

    const el = document.createElement('div');
    el.className = 'value-editor';
    if (multi) el.classList.add('value-editor-multi');
    const fields: HTMLElement[] = [];

    const numberRow = (labelText: string, unitText: string, key: string, current: number, min: number, max: number, options?: readonly number[]): void => {
      const label = document.createElement('label');
      label.textContent = labelText;
      const unit = document.createElement('span');
      unit.textContent = unitText;
      let field: HTMLInputElement | HTMLSelectElement;
      if (options) {
        const select = document.createElement('select');
        for (const v of options) {
          const option = document.createElement('option');
          option.value = String(v);
          option.textContent = String(v);
          option.selected = v === current;
          select.appendChild(option);
        }
        select.addEventListener('change', () => set(key, Number(select.value)));
        field = select;
      } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.spellcheck = false;
        // A fraction such as a duty cycle is shown as 0.5, not as "500m".
        input.value = key === 'duty' ? String(+current.toFixed(4)) : formatSI(current, '', 6).trim().replace(' ', '');
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            const value = parseSI(input.value);
            if (value === null || value < min || value > max) {
              input.classList.add('invalid');
              return;
            }
            set(key, value);
          } else if (e.key !== 'Escape') {
            input.classList.remove('invalid');
          }
        });
        field = input;
      }
      label.append(field, unit);
      el.append(label);
      fields.push(field);
    };

    const choiceRow = (labelText: string, key: string, current: string, choices: readonly string[]): void => {
      const label = document.createElement('label');
      label.textContent = labelText;
      const select = document.createElement('select');
      for (const c of choices) {
        const option = document.createElement('option');
        option.value = c;
        option.textContent = c;
        option.selected = c === current;
        select.appendChild(option);
      }
      select.addEventListener('change', () => set(key, select.value));
      label.append(select);
      el.append(label);
      fields.push(select);
    };

    const mainKey = spec.key ?? 'value';
    const mainCurrent = part.state?.[mainKey] ?? type?.defaults?.[mainKey] ?? spec.min;
    // The extra fields first when there are some (the waveform is what the rest depends on).
    const extra = (f: ExtraField): void => {
      const current = part.state?.[f.key] ?? type?.defaults?.[f.key];
      if (f.choices) choiceRow(f.label, f.key, String(current ?? f.choices[0]), f.choices);
      else numberRow(f.label, f.unit, f.key, typeof current === 'number' ? current : f.min, f.min, f.max);
    };
    for (const f of type?.fields ?? []) if (f.choices) extra(f);
    numberRow(spec.label, spec.unit, mainKey, mainCurrent as number, spec.min, spec.max, spec.options);
    for (const f of type?.fields ?? []) if (!f.choices) extra(f);

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    const host = this.provider?.() ?? null;
    this.el = el;
    if (host?.available()) {
      el.classList.add('in-bar'); // no popup: the bar unfolds to hold it
      this.hostedBy = host;
      host.show(el);
    } else {
      this.hostedBy = null;
      document.body.appendChild(el);
      el.style.left = `${Math.max(bounds.left + 8, Math.min(anchor.left, bounds.right - el.offsetWidth - 8))}px`;
      el.style.top = `${Math.max(bounds.top + 8, Math.min(anchor.bottom + 8, bounds.bottom - el.offsetHeight - 8))}px`;
    }

    // Closes when the focus leaves the popup altogether (moving between its rows keeps it open).
    el.addEventListener('focusout', (e) => {
      const next = e.relatedTarget;
      if (!(next instanceof Node && el.contains(next))) this.close();
    });
    const first = fields[multi ? fields.findIndex((f) => f instanceof HTMLInputElement) : 0] ?? fields[0];
    (first as HTMLElement).focus();
    if (first instanceof HTMLInputElement) first.select();
  }

  close(): void {
    const el = this.el;
    this.el = null;
    if (!el) return;
    const host = this.hostedBy;
    this.hostedBy = null;
    if (host) host.hide(el);
    else leave(el); // a focused input that goes away fires focusout, which finds el already cleared
  }
}
