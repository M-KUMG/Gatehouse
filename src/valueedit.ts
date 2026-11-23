// Tiny popup to type a part's value (e.g. a resistance: "330", "4.7k", "1M"),
// or to pick it from a short list when the part allows only some values
// (a logic gate's supply level: PartType.value.options). A part with more
// settings (PartType.fields: a function generator's waveform, amplitude,
// offset, duty) gets one row per field; the popup then stays open after each
// change and closes when the focus leaves it.

import { leave } from './leave';
import type { FoldHost, FoldHostProvider } from './barfold';
import { DEFAULT_DIODE_SETTINGS, DEFAULT_SCHOTTKY_SETTINGS, isDiodeField } from './diodepresets';
import { formatSI, parseSI } from './format';
import type { ScreenRect } from './grid';
import type { PlacedPart } from './model';
import { partPresetName } from './partpresets';
import { partPresetSearch } from './partpresetsearch';
import { getPart, type ExtraField, type PartState } from './parts';

export class ValueEditor {
  private el: HTMLDivElement | null = null;
  private resize: ResizeObserver | null = null;
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
    if (!type) return;
    const { value: spec, fields: extraFields = [], catalog } = type;
    const diodeDefaults = type.id === 'schottky' ? DEFAULT_SCHOTTKY_SETTINGS : DEFAULT_DIODE_SETTINGS;
    const multi = extraFields.length > 0 || !!catalog;
    if (!spec && !multi) return;
    const presetFields = new Map<keyof PartState, (value: number) => void>();
    const refreshDefaults: (() => void)[] = [];
    const set = (key: keyof PartState, value: number | string | undefined): string | null => {
      const state = { ...part.state, [key]: value };
      if (value === undefined) delete state[key];
      const error = type.validateSettings?.(state);
      if (error) return error;
      part.state = state;
      for (const refresh of refreshDefaults) refresh();
      if (!multi) this.close();
      onChange();
      return null;
    };

    const el = document.createElement('div');
    el.className = 'value-editor';
    if (multi) el.classList.add('value-editor-multi');
    const feedback = document.createElement('div');
    feedback.className = 'value-editor-error';
    feedback.setAttribute('role', 'status');
    const showError = (message: string | null): void => {
      feedback.textContent = message;
      feedback.hidden = !message;
    };
    showError(null);
    const fields: HTMLElement[] = [];

    const numberRow = (labelText: string, unitText: string, key: keyof PartState, current: number | undefined,
      min: number, max: number, options?: readonly number[], defaultValue?: ExtraField['defaultValue']): void => {
      const label = document.createElement('label');
      label.textContent = labelText;
      const unit = document.createElement('span');
      unit.className = 'value-editor-unit';
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
        select.addEventListener('change', () => {
          const value = Number(select.value);
          const error = set(key, value);
          if (error) select.value = String(current);
          else current = value;
          showError(error);
        });
        if (catalog) presetFields.set(key, (value) => {
          current = value;
          select.value = String(value);
        });
        field = select;
      } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.spellcheck = false;
        // A fraction such as a duty cycle is shown as 0.5, not as "500m".
        const formatted = (n: number) => key === 'duty' ? String(+n.toFixed(4))
          : !unitText || unitText === '°C' ? String(n) : formatSI(n, '', 6).trim().replace(' ', '');
        input.value = current === undefined ? '' : formatted(current);
        if (defaultValue) {
          const refresh = () => {
            input.placeholder = formatted(defaultValue(part.state ?? {}));
            input.title = 'Clear and press Enter to restore the default.';
          };
          refresh();
          refreshDefaults.push(refresh);
        }
        input.addEventListener('input', () => {
          input.classList.remove('invalid');
          showError(null);
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            const value = defaultValue && input.value.trim() === '' ? undefined : parseSI(input.value);
            const valid = value === undefined || (value !== null && value >= min && value <= max);
            const error = valid ? set(key, value) : `Enter a value between ${min} and ${max} ${unitText}.`;
            input.classList.toggle('invalid', error !== null);
            showError(error);
          }
        });
        if (catalog) presetFields.set(key, (value) => {
          input.value = formatted(value);
          input.classList.remove('invalid');
        });
        field = input;
      }
      label.append(field, unit);
      el.append(label);
      fields.push(field);
    };

    const choiceRow = (labelText: string, key: keyof PartState, current: string, choices: readonly string[]): void => {
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

    // The extra fields first when there are some (the waveform is what the rest depends on).
    const extra = (f: ExtraField): void => {
      const current = part.state?.[f.key] ?? type.defaults?.[f.key]
        ?? (isDiodeField(f.key) ? diodeDefaults[f.key] : undefined);
      if (f.choices) choiceRow(f.label, f.key, String(current ?? f.choices[0]), f.choices);
      else numberRow(f.label, f.unit, f.key, typeof current === 'number' ? current : f.defaultValue ? undefined : f.min,
        f.min, f.max, undefined, f.defaultValue);
    };
    for (const f of extraFields) if (f.choices) extra(f);
    if (spec) {
      const mainKey = spec.key ?? 'value';
      const mainCurrent = part.state?.[mainKey] ?? type.defaults?.[mainKey] ?? spec.min;
      numberRow(spec.label, spec.unit, mainKey, mainCurrent as number, spec.min, spec.max, spec.options);
    }
    for (const f of extraFields) if (!f.choices) extra(f);
    el.append(feedback);
    if (catalog) el.append(partPresetSearch(type, catalog, partPresetName(type, part.state), (preset) => {
      const state = { ...part.state, ...preset.settings, [catalog.nameKey ?? 'partPreset']: preset.name };
      const error = type.validateSettings?.(state) ?? null;
      showError(error);
      if (error) return false;
      part.state = state;
      for (const key of catalog.keys) {
        const value = preset.settings[key];
        if (value !== undefined) presetFields.get(key)?.(value);
      }
      for (const refresh of refreshDefaults) refresh();
      onChange();
      return true;
    }));

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    const host = this.provider?.() ?? null;
    const placePopup = (): void => {
      el.style.left = `${Math.max(bounds.left + 8, Math.min(anchor.left, bounds.right - el.offsetWidth - 8))}px`;
      el.style.top = `${Math.max(bounds.top + 8, Math.min(anchor.bottom + 8, bounds.bottom - el.offsetHeight - 8))}px`;
    };
    this.el = el;
    if (host?.available()) {
      el.classList.add('in-bar'); // no popup: the bar unfolds to hold it
      this.hostedBy = host;
      host.show(el);
    } else {
      this.hostedBy = null;
      document.body.appendChild(el);
      placePopup();
    }
    if (catalog) {
      // Keep the bottom row reachable near the edge as the result list unfolds.
      this.resize = new ResizeObserver(this.hostedBy ? onChange : placePopup);
      this.resize.observe(el);
    }

    // Closes when the focus leaves the popup altogether (moving between its rows keeps it open).
    el.addEventListener('focusout', (e) => {
      const next = e.relatedTarget;
      if (!(next instanceof Node && el.contains(next))) this.close();
    });
    const first = fields[multi ? fields.findIndex((f) => f instanceof HTMLInputElement) : 0] ?? fields[0]
      ?? el.querySelector<HTMLInputElement>('input[type="search"]');
    first?.focus();
    if (first instanceof HTMLInputElement) first.select();
  }

  close(): void {
    const el = this.el;
    this.el = null;
    if (!el) return;
    this.resize?.disconnect();
    this.resize = null;
    const host = this.hostedBy;
    this.hostedBy = null;
    if (host) host.hide(el);
    else leave(el); // a focused input that goes away fires focusout, which finds el already cleared
  }
}
