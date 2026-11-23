import { describe, expect, it } from 'vitest';
import { ART_CELL } from './art/common';
import { formatSI, parseSI } from './format';
import { PARTS, getPart } from './parts';
import { stringifyProject } from './project/format';
import { Project } from './project/project';
import { readProject } from './project/read';
import { modelPins } from './sim';

const IDS = ['capacitor', 'inductor'];

describe('capacitor and inductor parts', () => {
  it('are registered with unique pins on the grid and art matching cols x rows', () => {
    for (const id of IDS) {
      const t = getPart(id)!;
      expect(t, id).toBeDefined();
      expect(PARTS.filter((p) => p.id === id)).toHaveLength(1);
      expect(new Set(t.pins.map((p) => p.id)).size).toBe(t.pins.length);
      expect(t.pins.map((p) => p.id)).toEqual(['a', 'b']);
      for (const p of t.pins) {
        expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
        expect(p.x >= 0 && p.x <= t.cols && p.y >= 0 && p.y <= t.rows).toBe(true);
      }
      expect(t.svg).toContain(`viewBox="0 0 ${t.cols * ART_CELL} ${t.rows * ART_CELL}"`);
      expect(t.svg).toContain(`width="${t.cols * ART_CELL}" height="${t.rows * ART_CELL}"`);
      for (const pin of modelPins(t.sim!(t.defaults ?? {}))) expect(t.pins.map((p) => p.id)).toContain(pin);
    }
  });

  it('simulate with the default values and a small series resistance', () => {
    expect(getPart('capacitor')!.sim!({ ...getPart('capacitor')!.defaults })).toEqual({ kind: 'capacitor', farads: 100e-9, esr: 0.01, ratedVolts: 50 });
    expect(getPart('inductor')!.sim!({ ...getPart('inductor')!.defaults })).toEqual({ kind: 'inductor', henries: 0.01, dcr: 0.01 });
    expect(getPart('capacitor')!.sim!({ value: 4.7e-6 })).toMatchObject({ farads: 4.7e-6 });
  });

  it('parse and format values with SI prefixes', () => {
    expect(parseSI('100n')).toBeCloseTo(100e-9, 15);
    expect(parseSI('4.7u')).toBeCloseTo(4.7e-6, 12);
    expect(parseSI('10m')).toBeCloseTo(0.01, 12);
    expect(parseSI('22pF')).toBeCloseTo(22e-12, 18);
    expect(parseSI('10 mH')).toBeCloseTo(0.01, 12);
    expect(parseSI('4.5e-9 A')).toBe(4.5e-9);
    expect(parseSI('-1,2E+2 Ω')).toBe(-120);
    expect(parseSI('1e999')).toBeNull();
    expect(parseSI('1')).toBe(1);
    expect(parseSI('abc')).toBeNull();
    expect(parseSI('')).toBeNull();
    expect(formatSI(100e-9, 'F')).toBe('100 nF');
    expect(formatSI(10e-3, 'H')).toBe('10 mH');
    expect(formatSI(22e-12, 'F')).toBe('22 pF');
    for (const v of [1e-12, 4.7e-12, 100e-9, 4.7e-6, 0.01, 1, 100]) {
      const text = formatSI(v, '', 6).trim().replace(' ', '');
      expect(parseSI(text)).toBeCloseTo(v, 12);
    }
  });

  it('validates the editable value like the resistor', () => {
    const base = (typeId: string, value: number) => {
      const p = new Project();
      p.scene.add({ typeId, col: 0, row: 0, rotation: 0, state: { value } });
      return JSON.parse(stringifyProject(p.serialize()));
    };
    for (const [id, good, bad] of [['capacitor', 4.7e-6, 2], ['inductor', 0.01, 1000]] as const) {
      expect(() => readProject(JSON.stringify(base(id, good)))).not.toThrow();
      expect(() => readProject(JSON.stringify(base(id, bad)))).toThrow();
      expect(() => readProject(JSON.stringify(base(id, 0)))).toThrow();
      expect(() => readProject(JSON.stringify(base(id, -1)))).toThrow();
    }
  });

  it('round-trip through save and load with edited values', () => {
    const a = new Project();
    a.scene.add({ typeId: 'capacitor', col: 0, row: 0, rotation: 0, state: { value: 4.7e-6 } });
    a.scene.add({ typeId: 'inductor', col: 0, row: 4, rotation: 90 });
    const first = a.serialize();
    const b = new Project();
    b.load(readProject(stringifyProject(first)));
    expect(b.serialize()).toEqual(first);
    expect(b.scene.parts[0].state).toEqual({ value: 4.7e-6 });
  });
});
