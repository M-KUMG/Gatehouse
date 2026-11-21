// Search in the parts menu: pure text matching, no DOM. The query is split into
// words and every word must be the START of some word in the item's text (its
// name, its id and the name of its menu section), ignoring case and
// punctuation: "led" finds "LED" but not "controlled", "mos" finds "N-MOSFET".
// Results with the query at the start of the name come first.

import type { PartType } from './parts';

/** Lower-case words of a text: letters and digits, everything else separates. */
function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** True when every word of `query` starts a word of `text` (an empty query matches everything). */
export function matchesQuery(text: string, query: string): boolean {
  const have = words(text);
  return words(query).every((q) => have.some((w) => w.startsWith(q)));
}

/** Lower is better: 0 name starts with the query, 1 name contains it, 2 only found through id or section. */
function rank(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.trim().toLowerCase();
  if (n.startsWith(q)) return 0;
  if (n.includes(q)) return 1;
  return 2;
}

/**
 * Parts that match `query`, best matches first (ties keep the menu order).
 * `categoryName` gives the name of a part's menu section, so "transistor"
 * also finds a MOSFET whose own name does not say it.
 */
export function searchParts(parts: readonly PartType[], query: string, categoryName: (partId: string) => string = () => ''): PartType[] {
  if (words(query).length === 0) return [...parts];
  return parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => matchesQuery(`${part.name} ${part.id} ${categoryName(part.id)}`, query))
    .sort((a, b) => rank(a.part.name, query) - rank(b.part.name, query) || a.index - b.index)
    .map(({ part }) => part);
}

/** Items with a name and a hint (the example circuits) that match `query`, in their own order. */
export function searchNamed<T extends { name: string; hint: string }>(items: readonly T[], query: string): T[] {
  return items.filter((item) => matchesQuery(`${item.name} ${item.hint}`, query));
}
