// The name chip of the selection bar: what is selected and, for a part with a
// value, that value ("Resistor" + "330 Ω"). Pure.

import { formatSI } from './format';
import { ledColorName } from './ledcolor';
import type { PlacedPart } from './model';
import { getPart, placedPartName } from './parts';

export interface SelectionLabel {
  title: string;
  /** The main value with its unit, or '' (no value, several parts, a board). */
  value: string;
}

/** `boardName`: the display name when the single selected part is a board. */
export function selectionLabel(parts: readonly PlacedPart[], boardName?: string): SelectionLabel | null {
  if (parts.length === 0) return null;
  if (parts.length > 1) return { title: `${parts.length} parts`, value: '' };
  const part = parts[0];
  if (boardName) return { title: boardName, value: '' };
  const type = getPart(part.typeId);
  if (!type) return { title: 'Part', value: '' };
  if (type.colorable) return { title: type.name, value: ledColorName(part.state?.color) };
  const key = type.value?.key ?? 'value';
  const raw = part.state?.[key] ?? type.defaults?.[key];
  const value = type.value && typeof raw === 'number' ? formatSI(raw, type.value.unit) : '';
  return { title: placedPartName(type, part.state), value };
}
