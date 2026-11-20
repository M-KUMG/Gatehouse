// The programmable power supply ('psu', model 'supply' in sim/supply.ts):
// the set voltage up to its current limit, constant current beyond.

import { describe, expect, it } from 'vitest';
import { psuLabel, psuSvg } from './art/psu';
import { DEFAULT_PSU_LIMIT, DEFAULT_PSU_VOLTS, PSU_MAX_VOLTS, getPart } from './parts';
import { stringifyProject } from './project/format';
import { Project } from './project/project';
import { readProject } from './project/read';
import { initialState, solveCircuit, solveStep, type SimInput } from './sim';
import { inspect } from './sim/inspect';
import { limiterCurve } from './sim/supply';

const psu = getPart('psu')!;
const PSU = 1;
const LOAD = 2;

/** The supply `state` across a resistor of `ohms` (ground on its - pole). */
function loaded(state: { value?: number; limit?: number }, ohms: number): SimInput {
  return {
    components: [
      { id: PSU, model: psu.sim!(state) },
      { id: LOAD, model: { kind: 'resistor', ohms } },
      { id: 3, model: { kind: 'ground' } },
    ],
    links: [
      [{ part: PSU, pin: 'pos' }, { part: LOAD, pin: 'a' }],
      [{ part: LOAD, pin: 'b' }, { part: PSU, pin: 'neg' }],
      [{ part: PSU, pin: 'neg' }, { part: 3, pin: 'gnd' }],
    ],
  };
}

describe('programmable power supply', () => {
  it('is registered with + and - pins on grid points', () => {
    expect(psu.pins.map((p) => p.id)).toEqual(['pos', 'neg']);
    for (const p of psu.pins) {
      expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
      expect(p.x <= psu.cols && p.y <= psu.rows).toBe(true);
    }
  });
  it('gives the set voltage, as much as 1000 V, while the load is well below the limit', () => {
    for (const volts of [0, 1.5, 5, 12.34, 100, PSU_MAX_VOLTS]) {
      const ohms = Math.max(volts, 1) * 10; // a tenth of the 1 A limit at most
      const r = solveCircuit(loaded({ value: volts, limit: 1 }, ohms));
      expect(r.converged).toBe(true);
      expect(r.parts[LOAD].voltage).toBeCloseTo(volts, 1); // about 50 mohm of droop at 0.1 A
      expect(r.parts[PSU].volts?.cc).toBe(0);
    }
  });
  it('holds the current limit into a heavy load: 5 V into 10 ohm at 0.1 A gives 1 V, 0.1 A', () => {
    const r = solveCircuit(loaded({ value: 5, limit: 0.1 }, 10));
    expect(r.converged).toBe(true);
    expect(r.parts[LOAD].current).toBeGreaterThan(0.0995);
    expect(r.parts[LOAD].current).toBeLessThan(0.1005);
    expect(r.parts[LOAD].voltage).toBeCloseTo(1, 1);
    expect(r.parts[PSU].volts?.cc).toBe(1);
    expect(r.parts[PSU].current).toBeCloseTo(r.parts[LOAD].current, 6);
  });
  it('a short circuit draws the limit, not volts / 50 mohm', () => {
    for (const volts of [5, 100, 1000]) {
      const r = solveCircuit(loaded({ value: volts, limit: 2 }, 1e-3));
      expect(r.converged).toBe(true);
      expect(Math.abs(r.parts[PSU].current)).toBeGreaterThan(1.99);
      expect(Math.abs(r.parts[PSU].current)).toBeLessThan(2.01);
    }
  });
  it('limiter curve: 50 mohm below the limit, saturating at it, odd', () => {
    const m = { kind: 'limiter' as const, amps: 2 };
    expect(limiterCurve(m, 0).g).toBeCloseTo(1 / 0.05, 6);
    expect(limiterCurve(m, 1e-3).i).toBeCloseTo(0.02, 4);
    expect(limiterCurve(m, 5).i).toBeCloseTo(2, 9);
    expect(limiterCurve(m, -5).i).toBeCloseTo(-2, 9);
    expect(limiterCurve(m, 0.1).g).toBeGreaterThan(0);
  });
  it('works in time steps with a capacitor load: constant-current charging ramp', () => {
    const input: SimInput = {
      components: [
        { id: PSU, model: psu.sim!({ value: 10, limit: 0.01 }) },
        { id: LOAD, model: { kind: 'capacitor', farads: 1e-3 } },
        { id: 3, model: { kind: 'ground' } },
      ],
      links: [
        [{ part: PSU, pin: 'pos' }, { part: LOAD, pin: 'a' }],
        [{ part: LOAD, pin: 'b' }, { part: PSU, pin: 'neg' }],
        [{ part: PSU, pin: 'neg' }, { part: 3, pin: 'gnd' }],
      ],
    };
    let state = initialState(input, { charged: false });
    let last = solveStep(input, state, 1e-3);
    for (let i = 0; i < 500; i++) {
      last = solveStep(input, state, 1e-3);
      state = last.state; // 0.5 s at 10 mA into 1 mF: dV/dt = 10 V/s -> 5 V
    }
    expect(last.result.parts[LOAD].voltage).toBeGreaterThan(4.8);
    expect(last.result.parts[LOAD].voltage).toBeLessThan(5.2);
    expect(last.result.parts[PSU].volts?.cc).toBe(1);
  });
  it('defaults to 5 V, 1 A and limits the value from 0 to 1000 V, the limit from 1 mA to 20 A', () => {
    expect(psu.defaults).toEqual({ value: DEFAULT_PSU_VOLTS, limit: DEFAULT_PSU_LIMIT });
    expect(psu.value).toMatchObject({ unit: 'V', min: 0, max: PSU_MAX_VOLTS });
    expect(psu.fields?.[0]).toMatchObject({ key: 'limit', unit: 'A', min: 0.001, max: 20 });
  });
  it('shows the set voltage on its display and the mode in the inspector', () => {
    expect(psuLabel(5)).toBe('5.00 V');
    expect(psuLabel(12.5)).toBe('12.50 V');
    expect(psuLabel(100)).toBe('100.0 V');
    expect(psuSvg(7.25)).toContain('7.25 V');
    expect(psu.variant?.({ value: 7.25 })?.svg).toContain('7.25 V');
    expect(psu.variant?.({ value: 5 })).toBeNull();
    const heavy = solveCircuit(loaded({ value: 5, limit: 0.1 }, 10));
    const q = new Map(inspect(psu.sim!({ value: 5, limit: 0.1 }), heavy, { id: PSU, type: 'psu' }).map((x) => [x.id, x]));
    expect(q.get('mode')?.text).toMatch(/constant current/);
    expect(q.get('limit')?.value).toBeCloseTo(0.1, 9);
  });
  it('saves and loads the limit; bad limits are refused', () => {
    const p = new Project();
    p.scene.add({ typeId: 'psu', col: 0, row: 0, rotation: 0, state: { value: 12, limit: 0.5 } });
    const first = p.serialize();
    const b = new Project();
    b.load(readProject(stringifyProject(first)));
    expect(b.serialize()).toEqual(first);
    expect(b.scene.parts[0].state).toEqual({ value: 12, limit: 0.5 });
    const bad = (state: object) => {
      const doc = JSON.parse(stringifyProject(first));
      doc.parts[0].state = state;
      return () => readProject(JSON.stringify(doc));
    };
    expect(bad({ limit: 0 })).toThrow(/limit/);
    expect(bad({ limit: 50 })).toThrow(/limit/);
    expect(bad({ limit: 2 })).not.toThrow();
  });
});
