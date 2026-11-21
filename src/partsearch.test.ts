import { describe, expect, it } from 'vitest';
import { groupParts } from './partcategories';
import { matchesQuery, searchNamed, searchParts } from './partsearch';
import { PARTS } from './parts';

const categoryOf = new Map(groupParts(PARTS).flatMap((g) => g.parts.map((p) => [p.id, g.name] as const)));
const find = (query: string): string[] => searchParts(PARTS, query, (id) => categoryOf.get(id) ?? '').map((p) => p.id);

describe('matchesQuery', () => {
  it('ignores case and needs every word', () => {
    expect(matchesQuery('Arduino Nano', 'NANO')).toBe(true);
    expect(matchesQuery('Arduino Nano', 'ard nan')).toBe(true);
    expect(matchesQuery('Arduino Nano', 'nano uno')).toBe(false);
  });

  it('matches the start of a word, not the middle', () => {
    expect(matchesQuery('A relay controlled by a pin', 'led')).toBe(false);
    expect(matchesQuery('LED + switch', 'led')).toBe(true);
    expect(matchesQuery('N-MOSFET (logic level)', 'mos')).toBe(true);
    expect(matchesQuery('N-MOSFET (logic level)', 'fet')).toBe(false);
  });

  it('treats punctuation as a separator', () => {
    expect(matchesQuery('gate-and', 'gate and')).toBe(true);
    expect(matchesQuery('Diode (1N4148)', '1n4148')).toBe(true);
  });

  it('matches everything for an empty or blank query', () => {
    expect(matchesQuery('anything', '')).toBe(true);
    expect(matchesQuery('anything', '   ')).toBe(true);
  });
});

describe('searchParts on the real parts', () => {
  it('returns all parts for a blank query', () => {
    expect(find('  ')).toHaveLength(PARTS.length);
  });

  it('finds a part by its name', () => {
    expect(find('nano')).toContain('nano');
    expect(find('led')).toContain('led');
    expect(find('resistor')).toContain('resistor');
  });

  it('finds parts through their section name', () => {
    const hits = find('transistor');
    for (const id of ['bjt', 'pnp', 'nmos', 'pmos']) expect(hits).toContain(id);
  });

  it('finds parts by id and by several words', () => {
    expect(find('gate-and').length).toBeGreaterThan(0);
    expect(find('n mos')).toContain('nmos');
  });

  it('finds nothing for nonsense', () => {
    expect(find('qwertyuiop')).toEqual([]);
  });

  it('puts name matches before matches found only through the section name', () => {
    const hits = find('diode');
    const diodeAt = hits.indexOf('diode');
    const zenerAt = hits.indexOf('zener'); // "Zener diode": name contains it
    expect(diodeAt).toBeGreaterThanOrEqual(0);
    expect(zenerAt).toBeGreaterThanOrEqual(0);
    // "Diode (1N4148)" starts with the query, so it comes first.
    expect(diodeAt).toBeLessThan(zenerAt);
  });

  it('puts a name that starts with the query first', () => {
    expect(find('res')[0]).toBe('resistor');
  });
});

describe('searchNamed', () => {
  const items = [
    { name: 'LED + switch', hint: 'A switch lights an LED' },
    { name: 'Uno blink', hint: 'The board blinks its LED' },
    { name: 'Seven-segment', hint: 'Counts on a display' },
  ];

  it('searches names and hints, keeping the order', () => {
    expect(searchNamed(items, 'led').map((i) => i.name)).toEqual(['LED + switch', 'Uno blink']);
    expect(searchNamed(items, 'display').map((i) => i.name)).toEqual(['Seven-segment']);
    expect(searchNamed(items, 'zzz')).toEqual([]);
  });
});
