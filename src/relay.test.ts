// The SPDT relay (sim/relay.ts, part 'relay'): coil current with L/R delay,
// pull-in / drop-out hysteresis, contacts, results under the relay's own pin
// names, save / load and the part's ratings.

import { describe, expect, it } from 'vitest';
import { burnReason, getPart, partWarning } from './parts';
import { stringifyProject } from './project/format';
import { Project } from './project/project';
import { readProject } from './project/read';
import { initialState, solveCircuit, solveStep, type SimInput, type TransientState } from './sim';
import { inspect } from './sim/inspect';
import { RELAY_COILS, decideRelay, relayModel } from './sim/relay';

const RELAY = 2;
const NO_LOAD = 3;
const NC_LOAD = 4;

/** coilVolts across the coil; COM on a 9 V supply, NO and NC each through 1 kohm to ground. */
function circuit(coilVolts: number, nominal = 5): SimInput {
  const t = (part: number, pin: string) => ({ part, pin });
  return {
    components: [
      { id: 1, model: { kind: 'battery', volts: coilVolts, rInternal: 0.05 } },
      { id: RELAY, model: relayModel(nominal) },
      { id: NO_LOAD, model: { kind: 'resistor', ohms: 1000 } },
      { id: NC_LOAD, model: { kind: 'resistor', ohms: 1000 } },
      { id: 5, model: { kind: 'battery', volts: 9, rInternal: 0.05 } },
      { id: 6, model: { kind: 'ground' } },
    ],
    links: [
      [t(1, 'pos'), t(RELAY, 'coil1')], [t(1, 'neg'), t(RELAY, 'coil2')], [t(1, 'neg'), t(6, 'gnd')],
      [t(5, 'pos'), t(RELAY, 'com')], [t(5, 'neg'), t(6, 'gnd')],
      [t(RELAY, 'no'), t(NO_LOAD, 'a')], [t(NO_LOAD, 'b'), t(6, 'gnd')],
      [t(RELAY, 'nc'), t(NC_LOAD, 'a')], [t(NC_LOAD, 'b'), t(6, 'gnd')],
    ],
  };
}

/** Steps `ms` milliseconds of 100 us steps from `state`. */
function run(input: SimInput, state: TransientState, ms: number): { state: TransientState; times: Record<number, boolean> } {
  let s = state;
  const on: Record<number, boolean> = {};
  for (let i = 1; i <= ms * 10; i++) {
    const step = solveStep(input, s, 1e-4);
    s = step.state;
    on[i / 10] = (step.result.parts[RELAY].volts?.['logic.on'] ?? 0) >= 0.5;
  }
  return { state: s, times: on };
}

describe('relay model', () => {
  it('has the coil table of a cube relay and thresholds at 75 % / 10 % of the nominal current', () => {
    expect(RELAY_COILS[5]).toBe(70);
    expect(RELAY_COILS[12]).toBe(400);
    const m = relayModel(5);
    expect(m.coilOhms).toBe(70);
    expect(m.pullAmps).toBeCloseTo(0.75 * (5 / 70), 9);
    expect(m.dropAmps).toBeCloseTo(0.1 * (5 / 70), 9);
    expect(relayModel(7).coilVolts).toBe(5); // not a catalogue voltage: the default
  });
  it('decides with hysteresis on the coil current', () => {
    const m = relayModel(5);
    expect(decideRelay({ on: false }, m.pullAmps * 1.01, m).on).toBe(true);
    expect(decideRelay({ on: false }, (m.pullAmps + m.dropAmps) / 2, m).on).toBe(false);
    expect(decideRelay({ on: true }, (m.pullAmps + m.dropAmps) / 2, m).on).toBe(true);
    expect(decideRelay({ on: true }, m.dropAmps * 0.99, m).on).toBe(false);
    expect(decideRelay({ on: false }, -m.pullAmps * 1.01, m).on).toBe(true); // the coil has no polarity
  });
});

describe('relay in a circuit', () => {
  it('is released at 0 V: COM connects to NC only, in DC', () => {
    const r = solveCircuit(circuit(0));
    expect(r.converged).toBe(true);
    expect(r.parts[NC_LOAD].current).toBeCloseTo(9 / 1000, 4);
    expect(Math.abs(r.parts[NO_LOAD].current)).toBeLessThan(1e-9);
  });
  it('pulls in after a few milliseconds, never instantly, and releases again', () => {
    const input = circuit(5);
    let state = initialState(circuit(0), { charged: false });
    const a = run(input, state, 20);
    expect(a.times[0.1]).toBe(false); // the coil current has not built up yet
    expect(a.times[20]).toBe(true);
    const pullIn = Object.entries(a.times).find(([, v]) => v)![0];
    expect(Number(pullIn)).toBeGreaterThan(1);
    expect(Number(pullIn)).toBeLessThan(10);
    // Contacts have moved: 9 V now reaches NO, not NC.
    const last = solveStep(input, a.state, 1e-4).result;
    expect(last.parts[NO_LOAD].current).toBeCloseTo(9 / 1000, 3);
    expect(Math.abs(last.parts[NC_LOAD].current)).toBeLessThan(1e-6);
    // Switch the coil off (the 50 mohm source is a short, so the coil current dies away through it).
    const off = run(circuit(0), a.state, 40);
    expect(off.times[40]).toBe(false);
    expect(Object.entries(off.times).find(([, v]) => !v)).toBeDefined();
  });
  it('a 12 V relay does not pull in on 5 V (coil current 12 mA of its 30 mA nominal)', () => {
    const state = initialState(circuit(0, 12), { charged: false });
    const r = run(circuit(5, 12), state, 40);
    expect(r.times[40]).toBe(false);
    const full = run(circuit(12, 12), state, 40);
    expect(full.times[40]).toBe(true);
  });
  it('reports the coil and the contacts under the relay\'s own pin names', () => {
    const r = solveCircuit(circuit(5));
    const p = r.parts[RELAY];
    expect(Object.keys(p.pins).sort()).toEqual(['coil1', 'coil2', 'com', 'nc', 'no']);
    expect(p.pins.coil1).toBeCloseTo(5 / 70, 3);
    expect(p.pins.coil1 + p.pins.coil2).toBeCloseTo(0, 9);
    expect(p.pins.com).toBeCloseTo(9 / 1000, 4); // 5 V in DC: pulled in, COM -> NO
    expect(p.pins.no).toBeCloseTo(-9 / 1000, 4);
    expect(Math.abs(p.pins.nc)).toBeLessThan(1e-9);
    expect(r.nets[`${RELAY}:com`]).toBeDefined();
    expect(Object.keys(r.parts).every((id) => Number(id) >= 0)).toBe(true); // no helper parts left over
  });
  it('is repeatable', () => {
    const go = (): boolean[] => {
      let s = initialState(circuit(0), { charged: false });
      const out: boolean[] = [];
      for (let i = 0; i < 300; i++) {
        const step = solveStep(circuit(i < 150 ? 5 : 0), s, 1e-4);
        s = step.state;
        out.push((step.result.parts[RELAY].volts?.['logic.on'] ?? 0) >= 0.5);
      }
      return out;
    };
    expect(go()).toEqual(go());
  });
});

describe('relay part', () => {
  const type = getPart('relay')!;
  it('has 5 pins on the grid, a coil voltage choice and mirror', () => {
    expect(type.pins.map((p) => p.id).sort()).toEqual(['coil1', 'coil2', 'com', 'nc', 'no']);
    for (const p of type.pins) expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
    expect(type.value?.options).toEqual([3, 5, 6, 9, 12, 24]);
    expect(type.sim!({}).kind).toBe('relay');
    expect(type.sim!({ value: 12 })).toMatchObject({ kind: 'relay', coilVolts: 12, coilOhms: 400 });
    expect(type.sim!({ burned: true })).toEqual({ kind: 'open' });
  });
  it('warns above 1.3 x the coil voltage and burns above 2 x; contacts above 3 A / 10 A', () => {
    const r = (voltage: number, com = 0) => ({ voltage, current: 0, power: 0, pins: { com } });
    expect(partWarning(type, r(5), {})).toBeNull();
    expect(partWarning(type, r(7), {})).toMatch(/Coil/);
    expect(burnReason(type, r(9), {})).toBeNull();
    expect(burnReason(type, r(11), {})).toMatch(/coil overvoltage/);
    expect(partWarning(type, r(5, 4), {})).toMatch(/Contacts/);
    expect(burnReason(type, r(5, 12), {})).toMatch(/contacts/);
  });
  it('shows the armature state in the inspector', () => {
    const res = solveCircuit(circuit(5));
    const q = new Map(inspect(relayModel(5), res, { id: RELAY, type: 'relay' }).map((x) => [x.id, x]));
    expect(q.get('state')?.text).toMatch(/pulled in/); // 5 V across the coil in a DC solve
    expect(q.get('vcoil')?.value).toBeCloseTo(5, 1);
  });
  it('saves and loads the coil voltage; the value is checked', () => {
    const p = new Project();
    p.scene.add({ typeId: 'relay', col: 0, row: 0, rotation: 0, state: { value: 12 } });
    const first = p.serialize();
    const b = new Project();
    b.load(readProject(stringifyProject(first)));
    expect(b.serialize()).toEqual(first);
    const doc = JSON.parse(stringifyProject(first));
    doc.parts[0].state = { value: 100 };
    expect(() => readProject(JSON.stringify(doc))).toThrow(/value/);
  });
});
