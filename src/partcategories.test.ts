import { describe, expect, it } from 'vitest';
import { CATEGORIES, groupParts, type PartCategory } from './partcategories';
import { PARTS, type PartType } from './parts';

const fake = (id: string): PartType => ({ id, name: id, cols: 1, rows: 1, svg: '', pins: [] });

describe('groupParts with the real parts', () => {
  const groups = groupParts(PARTS);

  it('puts every part in exactly one section', () => {
    const all = groups.flatMap((g) => g.parts.map((p) => p.id));
    expect(all.length).toBe(PARTS.length);
    expect(new Set(all).size).toBe(PARTS.length);
  });

  it('leaves no part in "Other": a new part needs a category in partcategories.ts', () => {
    const other = groups.find((g) => g.id === 'other');
    expect(other?.parts.map((p) => p.id) ?? []).toEqual([]);
  });

  it('has the Arduino boards first, holding the Uno and the Nano', () => {
    expect(groups[0]?.name).toBe('Arduino boards');
    expect(groups[0]?.parts.map((p) => p.id)).toEqual(['uno', 'nano']);
  });

  it('collects all logic gates in one section', () => {
    const logic = groups.find((g) => g.id === 'logic');
    expect(logic?.parts.length).toBeGreaterThan(0);
    expect(logic?.parts.every((p) => p.id.startsWith('gate-'))).toBe(true);
    expect(PARTS.filter((p) => p.id.startsWith('gate-')).length).toBe(logic?.parts.length);
  });

  it('names every configured category only once and uses known ids only', () => {
    const ids = CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const known = new Set(PARTS.map((p) => p.id));
    for (const cat of CATEGORIES) for (const id of cat.ids ?? []) expect(known.has(id), `${cat.id}: ${id}`).toBe(true);
  });
});

describe('groupParts rules', () => {
  const cats: PartCategory[] = [
    { id: 'a', name: 'A', ids: ['x', 'y'] },
    { id: 'b', name: 'B', ids: ['y', 'z'] },
    { id: 'c', name: 'C', ids: ['nothing'] },
  ];

  it('gives a part to the first category that claims it, skips empty sections, shows its order', () => {
    const groups = groupParts([fake('z'), fake('y'), fake('x')], cats);
    expect(groups.map((g) => [g.id, g.parts.map((p) => p.id)])).toEqual([
      ['a', ['x', 'y']],
      ['b', ['z']],
    ]);
  });

  it('collects unclaimed parts under "Other", last', () => {
    const groups = groupParts([fake('x'), fake('q'), fake('r')], cats);
    expect(groups.at(-1)).toMatchObject({ id: 'other', name: 'Other' });
    expect(groups.at(-1)?.parts.map((p) => p.id)).toEqual(['q', 'r']);
  });
});
