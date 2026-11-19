// The electrolytic capacitor and the IGBT parts: registration, art, rating
// rules (burnWhen / warnWhen), burned state through save / load and undo, and
// the IGBT example.

import { describe, expect, it } from 'vitest';
import { ART_CELL } from './art/common';
import { clickPart } from './controls';
import { EXAMPLES } from './examples';
import type { PartState, PlacedPart } from './model';
import { ECAP_RATED_VOLTS, PARTS, burnReason, canMirror, ecapEsr, getPart, partWarning } from './parts';
import { stringifyProject } from './project/format';
import { editKey, withLiveState } from './project/history';
import { Project } from './project/project';
import { readProject } from './project/read';
import { modelPins, type PartResult } from './sim';
import { inspect } from './sim/inspect';
import { Simulation } from './simulation';

const result = (voltage: number, current = 0, extra: Partial<PartResult> = {}): PartResult => ({
  voltage, current, power: voltage * current, pins: {}, ...extra,
});

function expectRegistered(id: string, pins: string[]): void {
  const t = getPart(id)!;
  expect(t, id).toBeDefined();
  expect(PARTS.filter((p) => p.id === id)).toHaveLength(1);
  expect(t.pins.map((p) => p.id)).toEqual(pins);
  for (const p of t.pins) {
    expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
    expect(p.x >= 0 && p.x <= t.cols && p.y >= 0 && p.y <= t.rows).toBe(true);
  }
  expect(t.svg).toContain(`viewBox="0 0 ${t.cols * ART_CELL} ${t.rows * ART_CELL}"`);
  for (const pin of modelPins(t.sim!(t.defaults ?? {}))) expect(pins).toContain(pin);
}

/** A 9 V battery (or two in series for 18 V) across an electrolytic, `reversed` puts + on battery -. */
function ecapCircuit(opts: { reversed?: boolean; volts18?: boolean; farads?: number } = {}) {
  const p = new Project();
  const s = p.scene;
  const b1 = s.add({ typeId: 'battery9v', col: 0, row: 0, rotation: 0 });
  const gnd = s.add({ typeId: 'ground', col: 0, row: 10, rotation: 0 });
  const cap = s.add({ typeId: 'ecap', col: 20, row: 0, rotation: 0, state: { value: opts.farads ?? 100e-6 } });
  let top = { partId: b1.id, pinId: 'pos' };
  if (opts.volts18) {
    const b2 = s.add({ typeId: 'battery9v', col: 8, row: 6, rotation: 0 });
    s.addWire({ partId: b1.id, pinId: 'pos' }, { partId: b2.id, pinId: 'neg' });
    top = { partId: b2.id, pinId: 'pos' };
  }
  s.addWire({ partId: b1.id, pinId: 'neg' }, { partId: gnd.id, pinId: 'gnd' });
  const plus = opts.reversed ? { partId: b1.id, pinId: 'neg' } : top;
  const minus = opts.reversed ? top : { partId: b1.id, pinId: 'neg' };
  expect(s.addWire(plus, { partId: cap.id, pinId: 'pos' })).not.toBeNull();
  expect(s.addWire(minus, { partId: cap.id, pinId: 'neg' })).not.toBeNull();
  const sim = new Simulation(s);
  sim.update();
  return { p, sim, cap: s.find(cap.id)! };
}

describe('electrolytic capacitor', () => {
  it('is registered with + and - pins on the grid, not mirrorable, after the plain capacitor', () => {
    expectRegistered('ecap', ['pos', 'neg']);
    const t = getPart('ecap')!;
    expect(t.name).toBe('Electrolytic capacitor');
    expect(canMirror(t)).toBe(false);
    const ids = PARTS.map((p) => p.id);
    expect(ids.indexOf('ecap')).toBe(ids.indexOf('capacitor') + 1);
    // The pins sit on the centre line: a 180-degree turn swaps them.
    expect(t.pins.map((p) => p.y)).toEqual([t.rows / 2, t.rows / 2]);
  });

  it('simulates as a capacitor with the default 100 uF, its ESR and the rating data', () => {
    const t = getPart('ecap')!;
    expect(t.sim!({ ...t.defaults })).toEqual({ kind: 'capacitor', farads: 100e-6, esr: 0.5, polarized: true, ratedVolts: 16 });
    expect(ecapEsr(1e-6)).toBeCloseTo(5, 9);
    expect(ecapEsr(1000e-6)).toBeCloseTo(0.158, 3);
    expect(ecapEsr(1)).toBe(0.01);
    expect(ecapEsr(1e-12)).toBe(20);
    expect(t.sim!({ value: 470e-6 })).toMatchObject({ farads: 470e-6 });
    expect(t.sim!({ value: 470e-6, burned: true })).toEqual({ kind: 'open' });
    expect(ECAP_RATED_VOLTS).toBe(16);
  });

  it('validates the editable value (1 pF..1 F) when a project is read', () => {
    const file = (value: number) => {
      const p = new Project();
      p.scene.add({ typeId: 'ecap', col: 0, row: 0, rotation: 0, state: { value } });
      return stringifyProject(p.serialize());
    };
    expect(() => readProject(file(2200e-6))).not.toThrow();
    for (const bad of [2, 0, -1, 1e-13]) expect(() => readProject(file(bad))).toThrow();
  });

  it('works normally the right way round below its rating (no warning, no burn)', () => {
    const { sim, cap } = ecapCircuit();
    expect(cap.state?.burned).toBeUndefined();
    const r = sim.partResult(cap.id)!;
    expect(r.voltage).toBeCloseTo(9, 1);
    expect(partWarning(getPart('ecap')!, r, cap.state ?? {})).toBeNull();
  });

  it('burns for good when reversed, and then is an open circuit', () => {
    const { sim, cap } = ecapCircuit({ reversed: true });
    expect(cap.state?.burned).toBe(true);
    expect(cap.state?.burnedBy).toMatch(/reverse voltage/);
    expect(getPart('ecap')!.sim!(cap.state!)).toEqual({ kind: 'open' });
    expect(getPart('ecap')!.variant!(cap.state!)?.key).toBe('burned');
    expect(sim.partResult(cap.id)!.current).toBe(0);
    // Staying burned: the next update changes nothing.
    sim.update();
    expect(cap.state?.burned).toBe(true);
  });

  it('burns above its rated voltage (18 V on a 16 V part)', () => {
    const { cap } = ecapCircuit({ volts18: true });
    expect(cap.state?.burned).toBe(true);
    expect(cap.state?.burnedBy).toMatch(/over-voltage/);
  });

  it('warns before it burns: reversed beyond -0.3 V, or above 90 % of the rating', () => {
    const t = getPart('ecap')!;
    const s: PartState = { value: 100e-6 };
    expect(partWarning(t, result(-0.5), s)).toMatch(/^Reversed!/);
    expect(burnReason(t, result(-0.5), s)).toBeNull();
    expect(burnReason(t, result(-1.2), s)).toMatch(/reverse/);
    expect(partWarning(t, result(15), s)).toMatch(/rating/);
    expect(burnReason(t, result(15), s)).toBeNull();
    expect(burnReason(t, result(16.01), s)).toMatch(/over-voltage/);
    expect(partWarning(t, result(-0.2), s)).toBeNull();
    // The ESR drop does not count: 16.2 V at the leads with 1 A charging current is 15.7 V on the dielectric.
    expect(burnReason(t, result(16.2, 1), s)).toBeNull();
  });

  it('shows ESR, rated voltage and its state in the inspector', () => {
    const model = getPart('ecap')!.sim!({ value: 100e-6 });
    const at = (v: number) => {
      const r = { time: 0, converged: true, iterations: 1, reference: 'ground' as const, connectedNets: 1, nets: { '1:pos': 1, '1:neg': 0 }, voltages: [0, v], parts: { 1: result(v) } };
      return new Map(inspect(model, r, { id: 1 }).map((q) => [q.id, q]));
    };
    const ok = at(9);
    expect(ok.get('esr')?.value).toBeCloseTo(0.5, 9);
    expect(ok.get('rated')?.value).toBe(16);
    expect(ok.get('state')?.text).toBe('ok');
    expect(at(-0.5).get('state')?.text).toBe('reverse!');
    expect(at(15).get('state')?.text).toBe('over-voltage!');
  });

  it('a burned part persists through save and load, and a click replaces it', () => {
    const { p, cap } = ecapCircuit({ reversed: true });
    const b = new Project();
    b.load(readProject(stringifyProject(p.serialize())));
    const loaded = b.scene.parts.find((x) => x.typeId === 'ecap')!;
    expect(loaded.state).toMatchObject({ burned: true, burnedBy: cap.state!.burnedBy });
    clickPart(loaded);
    expect(loaded.state?.burned).toBe(false);
    expect(loaded.state?.burnedBy).toBeUndefined();
    // burnedBy is validated: a string of 1..200 characters.
    const bad = JSON.parse(stringifyProject(p.serialize()));
    bad.circuit ? (bad.circuit.parts[2].state.burnedBy = 5) : (bad.parts.find((x: PlacedPart) => x.typeId === 'ecap').state.burnedBy = 5);
    expect(() => readProject(JSON.stringify(bad))).toThrow();
  });

  it('burning is live state like the LED: no undo step, and undo / redo keep it', () => {
    const { p, cap } = ecapCircuit({ reversed: true });
    const burned = p.circuit();
    const fresh = JSON.parse(JSON.stringify(burned)) as typeof burned;
    const freshCap = fresh.parts.find((x) => x.id === cap.id)!;
    freshCap.state = { value: freshCap.state!.value };
    expect(editKey(fresh)).toBe(editKey(burned));
    // Undoing to a snapshot taken before it burned keeps it burned (and why).
    const restored = withLiveState(fresh, p.scene.parts);
    expect(restored.parts.find((x) => x.id === cap.id)!.state).toMatchObject({ burned: true, burnedBy: cap.state!.burnedBy });
  });
});

describe('IGBT parts', () => {
  it('are registered (N: g c e, P: g e c), mirrorable, after the MOSFETs, each with its own model', () => {
    expectRegistered('igbt', ['g', 'c', 'e']);
    expectRegistered('pigbt', ['g', 'e', 'c']);
    const ids = PARTS.map((p) => p.id);
    expect(ids.slice(ids.indexOf('pmos') + 1, ids.indexOf('pmos') + 3)).toEqual(['igbt', 'pigbt']);
    for (const id of ['igbt', 'pigbt']) {
      const t = getPart(id)!;
      expect(canMirror(t)).toBe(true);
      expect(t.svg).toContain('IGBT');
      expect(t.sim!({})).toMatchObject({ kind: 'igbt', polarity: id === 'igbt' ? 1 : -1 });
      expect(t.sim!({ burned: true })).toEqual({ kind: 'open' });
      expect(t.variant!({ burned: true })?.key).toBe('burned');
    }
    expect(getPart('igbt')!.pins.map((p) => p.name)).toEqual(['Gate', 'Collector', 'Emitter']);
  });

  it('burn above 60 A or 650 V, warn above 20 A or 600 V (device frame for the P part)', () => {
    const n = getPart('igbt')!;
    const p = getPart('pigbt')!;
    const on = (vce: number, ic: number) => result(vce, ic, { volts: { g: 15, c: vce, e: 0 } });
    expect(burnReason(n, on(2, 10), {})).toBeNull();
    expect(partWarning(n, on(2, 10), {})).toBeNull();
    expect(partWarning(n, on(2, 25), {})).toMatch(/continuous/);
    expect(burnReason(n, on(3, 61), {})).toMatch(/collector current/);
    expect(burnReason(n, on(660, 0.001), {})).toMatch(/over-voltage/);
    expect(partWarning(n, on(620, 0.001), {})).toMatch(/limit/);
    // The P part reads its values with the signs turned round.
    const pOn = (vce: number, ic: number) => result(vce, ic, { volts: { g: -15, c: vce, e: 0 } });
    expect(burnReason(p, pOn(-660, -0.001), {})).toMatch(/over-voltage/);
    expect(burnReason(p, pOn(660, 0), {})).toBeNull();
    expect(burnReason(p, pOn(-3, -61), {})).toMatch(/collector current/);
    expect(burnReason(n, on(3, 61), { burned: true })).toBeNull();
  });

  it('round-trip through save and load, mirrored and turned', () => {
    const a = new Project();
    a.scene.add({ typeId: 'igbt', col: 0, row: 0, rotation: 90, mirrorX: true });
    a.scene.add({ typeId: 'pigbt', col: 10, row: 0, rotation: 0 });
    a.scene.add({ typeId: 'ecap', col: 20, row: 0, rotation: 180 });
    const first = a.serialize();
    const b = new Project();
    b.load(readProject(stringifyProject(first)));
    expect(b.serialize()).toEqual(first);
  });
});

describe('IGBT low-side switch example', () => {
  const example = EXAMPLES.find((e) => e.name === 'IGBT low-side switch')!;

  function load() {
    const p = new Project();
    p.scene.insert(example.state);
    const sim = new Simulation(p.scene);
    sim.update();
    const find = (typeId: string) => p.scene.parts.find((x) => x.typeId === typeId)!;
    return { p, sim, led: find('led'), sw: find('switch'), igbt: find('igbt') };
  }

  it('says that the gate needs 9 V', () => {
    expect(example.hint).toMatch(/9 V/);
    expect(example.hint).toMatch(/5 V/);
  });

  it('lights the LED with the switch closed and not at all when open', () => {
    const { sim, led, sw, igbt } = load();
    expect(sim.result?.converged).toBe(true);
    expect(Math.abs(sim.partResult(led.id)!.current)).toBeLessThan(1e-5);
    expect(sim.partResult(igbt.id)!.volts?.g).toBeLessThan(1e-3); // the pulldown holds the gate low
    clickPart(sw);
    sim.update();
    expect(sim.result?.converged).toBe(true);
    const on = sim.partResult(led.id)!.current;
    expect(on).toBeGreaterThan(0.02);
    expect(on).toBeLessThan(0.03); // 220 ohm keeps it below the LED's warning
    expect(sim.partResult(igbt.id)!.volts?.g).toBeGreaterThan(8.9);
    expect(sim.partResult(igbt.id)!.voltage).toBeLessThan(1); // saturated
    expect(led.state?.burned).toBeUndefined();
    clickPart(sw);
    sim.update();
    expect(Math.abs(sim.partResult(led.id)!.current)).toBeLessThan(1e-5);
  });
});
