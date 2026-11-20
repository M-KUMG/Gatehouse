import { describe, expect, it } from 'vitest';
import { psuLabel, psuSvg } from './art/psu';
import { DEFAULT_PSU_VOLTS, PSU_MAX_VOLTS, getPart } from './parts';
import { solveCircuit } from './sim';

const psu = getPart('psu')!;

describe('programmable power supply', () => {
  it('is registered with + and - pins on grid points', () => {
    expect(psu.pins.map((p) => p.id)).toEqual(['pos', 'neg']);
    for (const p of psu.pins) {
      expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
      expect(p.x <= psu.cols && p.y <= psu.rows).toBe(true);
    }
  });
  it('gives the set voltage, as much as 1000 V, through 50 mohm', () => {
    for (const volts of [0, 1.5, 5, 12.34, 100, PSU_MAX_VOLTS]) {
      const model = psu.sim!({ value: volts });
      const r = solveCircuit({
        components: [{ id: 1, model }, { id: 2, model: { kind: 'resistor', ohms: 1000 } }, { id: 3, model: { kind: 'ground' } }],
        links: [[{ part: 1, pin: 'pos' }, { part: 2, pin: 'a' }], [{ part: 2, pin: 'b' }, { part: 1, pin: 'neg' }], [{ part: 1, pin: 'neg' }, { part: 3, pin: 'gnd' }]],
      });
      expect(r.converged).toBe(true);
      const v = r.parts[2].voltage;
      expect(v).toBeCloseTo(volts * (1000 / 1000.05), 3);
    }
  });
  it('defaults to 5 V and limits the value from 0 to 1000 V', () => {
    expect(psu.defaults?.value).toBe(DEFAULT_PSU_VOLTS);
    expect(psu.value).toMatchObject({ unit: 'V', min: 0, max: PSU_MAX_VOLTS });
  });
  it('shows the set voltage on its display', () => {
    expect(psuLabel(5)).toBe('5.00 V');
    expect(psuLabel(12.5)).toBe('12.50 V');
    expect(psuLabel(100)).toBe('100.0 V');
    expect(psuSvg(7.25)).toContain('7.25 V');
    expect(psu.variant?.({ value: 7.25 })?.svg).toContain('7.25 V');
    expect(psu.variant?.({ value: 5 })).toBeNull();
  });
});
