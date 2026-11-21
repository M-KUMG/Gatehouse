// Which menu section each part belongs to (the parts menu on the right shows
// one collapsible section per category). Pure data and a pure function, no DOM.
// A part that no category claims lands in an "Other" section instead of
// vanishing, and partcategories.test.ts fails until it gets a real category.

import type { PartType } from './parts';

export interface PartCategory {
  id: string;
  name: string;
  /** Part ids in the order they are shown. */
  ids?: readonly string[];
  /** Every part whose id starts with this belongs here too (in the order of the parts list). */
  prefix?: string;
}

export const CATEGORIES: readonly PartCategory[] = [
  { id: 'boards', name: 'Arduino boards', ids: ['uno', 'nano'] },
  { id: 'power', name: 'Power & sources', ids: ['battery', 'battery9v', 'psu', 'siggen', 'ground'] },
  { id: 'passive', name: 'Passive parts', ids: ['resistor', 'capacitor', 'ecap', 'inductor', 'pot', 'ldr', 'ntc'] },
  { id: 'diodes', name: 'Diodes', ids: ['diode', 'zener', 'schottky'] },
  { id: 'transistors', name: 'Transistors', ids: ['bjt', 'pnp', 'nmos', 'pmos', 'igbt', 'pigbt', 'halfdriver'] },
  { id: 'logic', name: 'Logic gates', prefix: 'gate-' },
  { id: 'switches', name: 'Switches & relays', ids: ['switch', 'button', 'relay'] },
  { id: 'outputs', name: 'Lights, sound & motion', ids: ['led', 'rgbled', 'buzzer', 'sevenseg', 'motor'] },
];

export const OTHER_CATEGORY: PartCategory = { id: 'other', name: 'Other' };

export interface PartGroup {
  id: string;
  name: string;
  parts: PartType[];
}

/**
 * Sort `parts` into sections, in the order of `categories`. A part goes to the
 * first category that claims it. Empty sections are left out; unclaimed parts
 * come last under "Other".
 */
export function groupParts(parts: readonly PartType[], categories: readonly PartCategory[] = CATEGORIES): PartGroup[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const placed = new Set<string>();
  const groups: PartGroup[] = [];

  for (const cat of categories) {
    const found: PartType[] = [];
    for (const id of cat.ids ?? []) {
      const part = byId.get(id);
      if (part && !placed.has(id)) found.push(part);
    }
    if (cat.prefix) {
      for (const part of parts) {
        if (part.id.startsWith(cat.prefix) && !placed.has(part.id) && !found.includes(part)) found.push(part);
      }
    }
    for (const part of found) placed.add(part.id);
    if (found.length > 0) groups.push({ id: cat.id, name: cat.name, parts: found });
  }

  const rest = parts.filter((p) => !placed.has(p.id));
  if (rest.length > 0) groups.push({ id: OTHER_CATEGORY.id, name: OTHER_CATEGORY.name, parts: rest });
  return groups;
}
