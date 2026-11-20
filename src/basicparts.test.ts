// The basic parts of basicparts.ts: Zener and Schottky diodes, LDR, active
// buzzer and 7-segment display. Registration, models (hand-computed values),
// convergence of the Zener breakdown, ratings, inspector and readouts,
// save / load, undo and burned persistence, and the example.

import { describe, expect, it } from 'vitest';
import { ART_CELL } from './art/common';
import { LDR_DEFAULT_LUX, SCHOTTKY_1N5819, ldrOhms, zenerVolts } from './basicparts';
import { clickPart } from './controls';
import { buzzerReadout, sevensegReadout, zenerReadout } from './devicereadouts';
import { EXAMPLES } from './examples';
import type { PartState } from './model';
import { PARTS, burnReason, canMirror, getPart, partWarning } from './parts';
import { stringifyProject } from './project/format';
import { editKey, withLiveState } from './project/history';
import { Project } from './project/project';
import { readProject } from './project/read';
import { describePart } from './readout';
import {
  D1N4148, RED_LED, initialState, modelPins, solveCircuit, solveStep,
  type ComponentModel, type PartResult, type SimInput, type SimResult, type Terminal,
} from './sim';
import { ACTIVE_BUZZER, buzzerCurve } from './sim/buzzer';
import { VT } from './sim/devices';
import { inspect } from './sim/inspect';
import { zenerNominal } from './sim/partinspect';
import { ZENER_REF_AMPS, ZENER_RS, zenerModel } from './sim/zener';
import { Simulation } from './simulation';

const result = (voltage: number, current = 0, extra: Partial<PartResult> = {}): PartResult => ({
  voltage, current, power: voltage * current, pins: {}, ...extra,
});

function circuit(models: ComponentModel[], wires: [string, string][]): SimInput {
  const terminal = (s: string): Terminal => ({ part: Number(s.split('.')[0]), pin: s.split('.')[1] });
  return { components: models.map((model, i) => ({ id: i + 1, model })), links: wires.map(([a, b]) => [terminal(a), terminal(b)]) };
}

const battery = (volts: number, rInternal = 0): ComponentModel => ({ kind: 'battery', volts, rInternal });
const resistor = (ohms: number): ComponentModel => ({ kind: 'resistor', ohms });
const GROUND: ComponentModel = { kind: 'ground' };

/** Parts 1 battery, 2 series resistor, 3 the part (pins `pins`, the first on the resistor), 4 ground, then `extra` on the node. */
function series(bat: ComponentModel, ohms: number, part: ComponentModel, pins: [string, string], extra: ComponentModel[] = []): SimInput {
  const models = [bat, resistor(ohms), part, GROUND, ...extra];
  const wires: [string, string][] = [['1.neg', '4.gnd'], ['1.pos', '2.a'], [`2.b`, `3.${pins[0]}`], [`3.${pins[1]}`, '4.gnd']];
  extra.forEach((m, i) => {
    const [a, b] = modelPins(m);
    wires.push([`${5 + i}.${a}`, `3.${pins[0]}`], [`${5 + i}.${b}`, '4.gnd']);
  });
  return circuit(models, wires);
}

/** A part of type `typeId` straight across a 9 V battery (or two in series), in a Project with a Simulation. */
function across(typeId: string, pins: [string, string], state: PartState = {}, opts: { volts18?: boolean; series?: number } = {}) {
  const p = new Project();
  const s = p.scene;
  const b1 = s.add({ typeId: 'battery9v', col: 0, row: 0, rotation: 0 });
  const gnd = s.add({ typeId: 'ground', col: 0, row: 10, rotation: 0 });
  const part = s.add({ typeId, col: 30, row: 0, rotation: 0, state: { ...getPart(typeId)!.defaults, ...state } });
  let top = { partId: b1.id, pinId: 'pos' };
  if (opts.volts18) {
    const b2 = s.add({ typeId: 'battery9v', col: 8, row: 6, rotation: 0 });
    s.addWire({ partId: b1.id, pinId: 'pos' }, { partId: b2.id, pinId: 'neg' });
    top = { partId: b2.id, pinId: 'pos' };
  }
  if (opts.series !== undefined) {
    const r = s.add({ typeId: 'resistor', col: 16, row: 0, rotation: 0, state: { value: opts.series } });
    s.addWire(top, { partId: r.id, pinId: 'a' });
    top = { partId: r.id, pinId: 'b' };
  }
  s.addWire({ partId: b1.id, pinId: 'neg' }, { partId: gnd.id, pinId: 'gnd' });
  expect(s.addWire(top, { partId: part.id, pinId: pins[0] })).not.toBeNull();
  expect(s.addWire({ partId: b1.id, pinId: 'neg' }, { partId: part.id, pinId: pins[1] })).not.toBeNull();
  const sim = new Simulation(s);
  sim.update();
  return { p, sim, part: s.find(part.id)! };
}

const IDS = ['zener', 'schottky', 'ldr', 'buzzer', 'sevenseg'];

describe('basic parts: registration', () => {
  it('are registered once, pins on grid points, the art fits the box, every model pin is a part pin', () => {
    const pins: Record<string, string[]> = {
      zener: ['anode', 'cathode'], schottky: ['anode', 'cathode'], ldr: ['a', 'b'], buzzer: ['pos', 'neg'],
      sevenseg: ['g', 'f', 'com', 'a', 'b', 'e', 'd', 'c', 'dp'],
    };
    for (const id of IDS) {
      const t = getPart(id)!;
      expect(PARTS.filter((p) => p.id === id), id).toHaveLength(1);
      expect(t.pins.map((p) => p.id)).toEqual(pins[id]);
      expect(new Set(t.pins.map((p) => `${p.x},${p.y}`)).size, id).toBe(t.pins.length);
      for (const p of t.pins) {
        expect(Number.isInteger(p.x) && Number.isInteger(p.y), `${id}.${p.id}`).toBe(true);
        expect(p.x >= 0 && p.x <= t.cols && p.y >= 0 && p.y <= t.rows, `${id}.${p.id}`).toBe(true);
        expect(p.name.length).toBeGreaterThan(0);
      }
      expect(t.svg).toContain(`viewBox="0 0 ${t.cols * ART_CELL} ${t.rows * ART_CELL}"`);
      const model = t.sim!(t.defaults ?? {});
      for (const pin of modelPins(model)) expect(pins[id], id).toContain(pin);
      expect(canMirror(t), id).toBe(false);
      // Rated: a burned one is open and drawn burned.
      expect(t.sim!({ ...t.defaults, burned: true })).toEqual({ kind: 'open' });
      expect(t.variant!({ burned: true })?.key).toBe('burned');
      expect(t.variant!({})).toBeNull();
    }
    expect(getPart('zener')!.svg).toContain('ZENER');
    expect(getPart('schottky')!.svg).toContain('1N5819');
  });

  it('sit in the menu after the IGBTs (diodes) and after the LED (the others)', () => {
    const ids = PARTS.map((p) => p.id);
    expect(ids.slice(ids.indexOf('pigbt') + 1, ids.indexOf('pigbt') + 3)).toEqual(['zener', 'schottky']);
    expect(ids.slice(ids.indexOf('led') + 1, ids.indexOf('led') + 4)).toEqual(['ldr', 'buzzer', 'sevenseg']);
  });
});

describe('Zener diode', () => {
  it('sets bv from Vz at 20 mA through 7 ohm and a 1 mA knee', () => {
    const m = zenerModel(5.1) as Extract<ComponentModel, { kind: 'diode' }>;
    // bv = 5.1 - 0.02 * 7 - VT ln(20) = 4.8825 V
    expect(m.bv).toBeCloseTo(5.1 - 0.14 - VT * Math.log(20), 12);
    expect(m.bv).toBeCloseTo(4.8825, 3);
    expect(m).toMatchObject({ rs: ZENER_RS, ibv: 1e-3, nbv: 1 });
    expect(zenerNominal(m)).toBeCloseTo(5.1, 12);
    // The part: value = Vz, default 5.1 V, editable 2.4..75 V.
    const t = getPart('zener')!;
    expect(t.defaults).toEqual({ value: 5.1 });
    expect(t.value).toMatchObject({ unit: 'V', min: 2.4, max: 75 });
    expect(t.sim!({ value: 12 })).toEqual(zenerModel(12));
    expect(zenerVolts(undefined)).toBe(5.1);
    expect(zenerVolts(100)).toBe(5.1);
  });

  it('holds Vz at its reference current (solver, 20 mA forced through a stiff source)', () => {
    // Vz + 100 V behind 5 kOhm: 20 mA through the Zener.
    for (const vz of [2.4, 5.1, 12, 75]) {
      const r = solveCircuit(series(battery(100 + vz), 100 / ZENER_REF_AMPS, zenerModel(vz), ['cathode', 'anode']));
      expect(r.converged, `${vz} V`).toBe(true);
      const z = r.parts[3];
      expect(-z.current).toBeCloseTo(0.02, 3);
      expect(-z.voltage).toBeCloseTo(vz + ZENER_RS * (-z.current - 0.02) + VT * Math.log(-z.current / 0.02), 6);
    }
  });

  it('regulates 9 V through 330 ohm to 5.1 V +- 0.2 V, with and without a 1 kOhm load (DC)', () => {
    const noLoad = solveCircuit(series(battery(9, 1.5), 330, zenerModel(5.1), ['cathode', 'anode']));
    expect(noLoad.converged).toBe(true);
    const vz = -noLoad.parts[3].voltage;
    expect(Math.abs(vz - 5.1)).toBeLessThan(0.2);
    // Hand check: Iz = (9 - Vz) / 331.5 and Vz = bv + VT ln(Iz / 1 mA) + 7 Iz.
    const iz = (9 - vz) / 331.5;
    expect(-noLoad.parts[3].current).toBeCloseTo(iz, 6);
    expect(vz).toBeCloseTo(4.8825 + VT * Math.log(iz / 1e-3) + 7 * iz, 3);
    expect(vz).toBeCloseTo(5.03, 2);

    const loaded = solveCircuit(series(battery(9, 1.5), 330, zenerModel(5.1), ['cathode', 'anode'], [resistor(1000)]));
    expect(loaded.converged).toBe(true);
    const vl = -loaded.parts[3].voltage;
    expect(Math.abs(vl - 5.1)).toBeLessThan(0.2);
    expect(vl).toBeLessThan(vz);
    // The load takes about 5 mA from the Zener (less the little more the resistor passes at the lower voltage).
    expect(-noLoad.parts[3].current - -loaded.parts[3].current).toBeCloseTo(vl / 1000 - (vz - vl) / 331.5, 6);
    // Too heavy a load (220 ohm): out of regulation, a divider, the Zener nearly off.
    const heavy = solveCircuit(series(battery(9, 1.5), 330, zenerModel(5.1), ['cathode', 'anode'], [resistor(220)]));
    expect(heavy.converged).toBe(true);
    expect(-heavy.parts[3].voltage).toBeCloseTo(9 * 220 / 551.5, 2);
    expect(-heavy.parts[3].current).toBeLessThan(1e-6);
  });

  it('regulates through a load step in a transient run (10 uF on the output)', () => {
    const build = (closed: boolean): SimInput => {
      const input = series(battery(9, 1.5), 330, zenerModel(5.1), ['cathode', 'anode'], [{ kind: 'capacitor', farads: 10e-6, esr: 0.01 }]);
      // Part 6: a switch from the output to part 7, a 1 kOhm load to ground.
      input.components.push({ id: 6, model: { kind: 'switch', closed } }, { id: 7, model: resistor(1000) });
      input.links.push([{ part: 6, pin: 'a' }, { part: 3, pin: 'cathode' }], [{ part: 6, pin: 'b' }, { part: 7, pin: 'a' }], [{ part: 7, pin: 'b' }, { part: 4, pin: 'gnd' }]);
      return input;
    };
    let state = initialState(build(false), { charged: false });
    let r: SimResult | null = null;
    const vout = (res: SimResult): number => -res.parts[3].voltage;
    for (let k = 0; k < 100; k++) {
      ({ result: r, state } = solveStep(build(false), state, 1e-4));
      expect(r.converged).toBe(true);
    }
    expect(Math.abs(vout(r!) - 5.1)).toBeLessThan(0.2);
    const before = vout(r!);
    const iterations: number[] = [];
    for (let k = 0; k < 100; k++) {
      ({ result: r, state } = solveStep(build(true), state, 1e-4));
      expect(r.converged).toBe(true);
      iterations.push(r.iterations);
      expect(Math.abs(vout(r) - 5.1)).toBeLessThan(0.2);
    }
    expect(vout(r!)).toBeLessThan(before);
    // Warm-started steps settle quickly.
    expect(Math.max(...iterations.slice(10))).toBeLessThan(20);
  });

  it('converges cold over a sweep of supplies and Zener voltages, forward and reverse', () => {
    for (const vz of [2.4, 5.1, 33, 75]) {
      for (const v of [0, 0.5, 2, vz - 0.5, vz, vz + 0.05, vz + 1, 2 * vz, 120]) {
        for (const pins of [['cathode', 'anode'], ['anode', 'cathode']] as [string, string][]) {
          const r = solveCircuit(series(battery(v, 0.5), 100, zenerModel(vz), pins));
          expect(r.converged, `${vz} V Zener on ${v} V ${pins[0]} up`).toBe(true);
          expect(r.iterations).toBeLessThan(700);
          const d = r.parts[3];
          // Kirchhoff: the resistor carries the Zener current (anode to cathode is from the resistor when the anode is on it).
          const iz = pins[0] === 'anode' ? d.current : -d.current;
          expect(Math.abs(r.parts[2].current - iz)).toBeLessThan(1e-9 + 1e-6 * Math.abs(iz));
        }
      }
    }
    // Forward: an ordinary junction (about 0.69 V + 7 ohm drop at 25 mA).
    const fwd = solveCircuit(series(battery(9, 1.5), 330, zenerModel(5.1), ['anode', 'cathode']));
    expect(fwd.parts[3].voltage).toBeGreaterThan(0.6);
    expect(fwd.parts[3].voltage).toBeLessThan(0.9);
  });

  it('leaves an ordinary reverse-biased diode as it was (no breakdown)', () => {
    for (const v of [9, 50, 200]) {
      const r = solveCircuit(series(battery(v), 1000, D1N4148, ['cathode', 'anode']));
      expect(r.converged).toBe(true);
      expect(r.parts[3].voltage).toBeCloseTo(-v, 4);
      expect(Math.abs(r.parts[3].current)).toBeLessThan(1e-8);
    }
    // And an LED forward exactly as before: 2.0 V at 20 mA by construction.
    const led = solveCircuit(series(battery(2.0 + 0.02 * 100), 100, RED_LED, ['anode', 'cathode']));
    expect(led.parts[3].current).toBeCloseTo(0.02, 4);
  });

  it('rates 1 W (warn at 0.8 W, burn above 2 W) and 200 mA forward', () => {
    const t = getPart('zener')!;
    const s = { value: 5.1 };
    expect(partWarning(t, result(-5.1, -0.15), s)).toBeNull();
    expect(partWarning(t, result(-5.1, -0.17), s)).toMatch(/^P .* rating\.$/);
    expect(burnReason(t, result(-5.1, -0.3), s)).toBeNull();
    expect(burnReason(t, result(-5.2, -0.4), s)).toMatch(/^too much power/);
    expect(burnReason(t, result(1.5, 0.31), s)).toMatch(/forward current/);
  });

  it('burns straight across 9 V (about 0.48 A, 4 W), persists through save / load, a click replaces it', () => {
    const { p, part, sim } = across('zener', ['cathode', 'anode']);
    expect(part.state?.burned).toBe(true);
    expect(part.state?.burnedBy).toMatch(/^too much power \(P [34]\.\d+ W, rated 1 W\)$/);
    expect(sim.partResult(part.id)!.current).toBe(0);
    const b = new Project();
    b.load(readProject(stringifyProject(p.serialize())));
    const loaded = b.scene.parts.find((x) => x.typeId === 'zener')!;
    expect(loaded.state).toMatchObject({ value: 5.1, burned: true, burnedBy: part.state!.burnedBy });
    clickPart(loaded);
    expect(loaded.state?.burned).toBe(false);
  });

  it('regulates in the editor with 330 ohm and shows breakdown in the readout and the inspector', () => {
    const { sim, part } = across('zener', ['cathode', 'anode'], {}, { series: 330 });
    expect(part.state?.burned).toBeUndefined();
    const r = sim.partResult(part.id)!;
    expect(-r.voltage).toBeCloseTo(5.03, 1);
    expect(describePart(part, sim)!.lines[0]).toMatch(/^Vz 5\.0\d V · Iz 1[12](\.\d+)? mA \(breakdown\)$/);
    expect(describePart(part, sim)!.warning).toBeUndefined();
    const q = new Map(inspect(zenerModel(5.1), sim.result!, { id: part.id, type: 'zener' }).map((x) => [x.id, x]));
    expect(q.get('region')?.text).toBe('breakdown');
    expect(q.get('vz')?.value).toBeCloseTo(-r.voltage, 12);
    expect(q.get('iz')?.value).toBeCloseTo(-r.current, 12);
    expect(q.get('vznom')?.value).toBeCloseTo(5.1, 9);
    expect(q.get('rating')?.text).toBe('ok');
    expect(zenerReadout(result(0.7, 0.01))[0]).toMatch(/^Vf/);
    expect(zenerReadout(result(-3, -1e-9))[0]).toMatch(/^Blocking 3 V/);
  });

  it('validates the Zener voltage (2.4..75 V) when a project is read', () => {
    const file = (value: number) => {
      const p = new Project();
      p.scene.add({ typeId: 'zener', col: 0, row: 0, rotation: 0, state: { value } });
      return stringifyProject(p.serialize());
    };
    expect(() => readProject(file(12))).not.toThrow();
    for (const bad of [2, 80, 0, -5.1]) expect(() => readProject(file(bad))).toThrow();
  });
});

describe('Schottky diode (1N5819)', () => {
  const m = SCHOTTKY_1N5819 as Extract<ComponentModel, { kind: 'diode' }>;
  const vf = (i: number) => m.n * VT * Math.log(i / m.is + 1) + m.rs * i;

  it('matches the datasheet forward voltages at 0.1 / 1 / 3 A', () => {
    expect(m.n).toBe(1);
    expect(m.rs).toBeCloseTo(0.0593, 4);
    expect(m.is).toBeCloseTo(2.44e-7, 9);
    expect(vf(0.1)).toBeCloseTo(0.34, 3);
    expect(vf(1)).toBeCloseTo(0.45, 2);
    expect(vf(3)).toBeCloseTo(0.6, 3);
    expect(m.bv).toBeUndefined();
  });

  it('solves to the same curve, and leaks only about 0.24 uA reversed', () => {
    const r = solveCircuit(series(battery(5), 10, SCHOTTKY_1N5819, ['anode', 'cathode']));
    const d = r.parts[3];
    expect(d.voltage).toBeCloseTo(vf(d.current), 6);
    expect(d.current).toBeCloseTo((5 - d.voltage) / 10, 9);
    const rev = solveCircuit(series(battery(20), 1000, SCHOTTKY_1N5819, ['cathode', 'anode']));
    expect(-rev.parts[3].current).toBeCloseTo(m.is, 8);
  });

  it('rates If 1 A (burns above 3 A) and Vr 40 V (burns above 60 V)', () => {
    const t = getPart('schottky')!;
    expect(partWarning(t, result(0.45, 0.9), {})).toBeNull();
    expect(partWarning(t, result(0.47, 1.2), {})).toMatch(/^If 1\.2 A exceeds its 1 A rating\.$/);
    expect(burnReason(t, result(0.7, 3.1), {})).toMatch(/forward current/);
    expect(partWarning(t, result(-45, 0), {})).toMatch(/^Vr/);
    expect(burnReason(t, result(-61, 0), {})).toMatch(/reverse over-voltage/);
    // Straight across 9 V: well beyond 3 A, burns.
    expect(across('schottky', ['anode', 'cathode']).part.state?.burnedBy).toMatch(/forward current/);
  });
});

describe('photoresistor (LDR)', () => {
  it('follows R = 10 k (10 / lux)^0.7 within 100 ohm .. 2 MOhm', () => {
    expect(ldrOhms(10)).toBeCloseTo(10_000, 6);
    expect(ldrOhms(100)).toBeCloseTo(1995.26, 1);
    expect(ldrOhms(1)).toBeCloseTo(50_118.7, 0);
    expect(ldrOhms(0.1)).toBeCloseTo(251_188.6, 0);
    expect(ldrOhms(1000)).toBeCloseTo(398.1, 1);
    expect(ldrOhms(10_000)).toBe(100);
    expect(ldrOhms(100_000)).toBe(100);
    expect(ldrOhms(0.001)).toBeCloseTo(ldrOhms(0.1), 6); // clamped to the light range
  });

  it('is a resistor model with the light as data; default 100 lx, popup edits state.lux', () => {
    const t = getPart('ldr')!;
    expect(t.defaults).toEqual({ lux: LDR_DEFAULT_LUX });
    expect(t.value).toMatchObject({ key: 'lux', unit: 'lx', min: 0.1, max: 100_000 });
    expect(t.sim!({ lux: 10 })).toEqual({ kind: 'resistor', ohms: ldrOhms(10), lux: 10 });
    expect(t.sim!({})).toEqual({ kind: 'resistor', ohms: ldrOhms(100), lux: 100 });
  });

  it('divides like its resistance, shows lux and R in the inspector, R in the readout', () => {
    const { sim, part } = across('ldr', ['a', 'b'], { lux: 10 }, { series: 10_000 });
    const r = sim.partResult(part.id)!;
    expect(r.voltage).toBeCloseTo(9 * 10_000 / 20_001.5, 4);
    const q = new Map(inspect(getPart('ldr')!.sim!({ lux: 10 }), sim.result!, { id: part.id, type: 'ldr' }).map((x) => [x.id, x]));
    expect(q.get('lux')?.value).toBe(10);
    expect(q.get('r')?.value).toBeCloseTo(10_000, 6);
    expect(q.get('rating')?.text).toBe('ok');
    const text = describePart(part, sim)!;
    expect(text.title).toBe('Photoresistor (LDR) · 10 lx');
    expect(text.lines[0]).toBe('R 10 kΩ');
  });

  it('burns above 200 mW (bright light straight on 9 V: 0.8 W)', () => {
    const { part } = across('ldr', ['a', 'b'], { lux: 100_000 });
    expect(part.state?.burnedBy).toMatch(/^too much power \(P .*, rated 100 mW\)$/);
  });

  it('validates and saves lux; a light change is an edit (an undo step)', () => {
    const p = new Project();
    const ldr = p.scene.add({ typeId: 'ldr', col: 0, row: 0, rotation: 0, state: { lux: 2500 } });
    const first = p.serialize();
    const b = new Project();
    b.load(readProject(stringifyProject(first)));
    expect(b.serialize()).toEqual(first);
    expect(b.scene.parts[0].state).toEqual({ lux: 2500 });
    const before = editKey(p.circuit());
    p.scene.find(ldr.id)!.state = { lux: 5 };
    expect(editKey(p.circuit())).not.toBe(before);
    const bad = (state: object, typeId = 'ldr') => {
      const doc = JSON.parse(stringifyProject(first));
      doc.parts[0].state = state;
      doc.parts[0].typeId = typeId;
      return () => readProject(JSON.stringify(doc));
    };
    expect(bad({ lux: 0.05 })).toThrow(/lux/);
    expect(bad({ lux: 200_000 })).toThrow(/lux/);
    expect(bad({ lux: 'dark' })).toThrow(/lux/);
    expect(bad({ lux: 10 }, 'resistor')).toThrow(/lux/);
    expect(bad({ lux: 0.1 })).not.toThrow();
  });
});

describe('active buzzer', () => {
  it('is off below 2.0 V (1 MOhm), V / 150 ohm above 2.5 V, smooth between, ~0 reversed', () => {
    const m = ACTIVE_BUZZER;
    expect(buzzerCurve(m, 1.9).i).toBeCloseTo(1.9e-6, 12);
    expect(buzzerCurve(m, 2.0).i).toBeCloseTo(2e-6, 12);
    expect(buzzerCurve(m, 2.25).i).toBeCloseTo(2.25 * (1e-6 + 0.5 / 150), 12);
    expect(buzzerCurve(m, 5).i).toBeCloseTo(5 / 150 + 5e-6, 12);
    expect(buzzerCurve(m, -5).i).toBeCloseTo(-5e-6, 12);
    // The slope is the derivative of the current (finite differences), continuous across the knees.
    for (const v of [-1, 0.5, 1.99, 2.0, 2.01, 2.2, 2.3, 2.49, 2.5, 2.51, 4]) {
      const h = 1e-6;
      const fd = (buzzerCurve(m, v + h).i - buzzerCurve(m, v - h).i) / (2 * h);
      expect(buzzerCurve(m, v).g).toBeCloseTo(fd, 5);
      expect(buzzerCurve(m, v).g).toBeGreaterThan(0);
    }
  });

  it('draws about 33 mA at 5 V and sounds; silent at 1.5 V and reversed', () => {
    const on = solveCircuit(series(battery(5), 0.001, ACTIVE_BUZZER, ['pos', 'neg']));
    expect(on.converged).toBe(true);
    expect(on.parts[3].current).toBeCloseTo(5 / 150, 4);
    expect(on.parts[3].pins).toMatchObject({ pos: on.parts[3].current });
    const q = (r: SimResult) => new Map(inspect(ACTIVE_BUZZER, r, { id: 3, type: 'buzzer' }).map((x) => [x.id, x]));
    expect(q(on).get('state')?.text).toBe('sounding');
    expect(buzzerReadout(on.parts[3])).toEqual(['5 V · 33.3 mA', 'sounding']);
    const low = solveCircuit(series(battery(1.5), 0.001, ACTIVE_BUZZER, ['pos', 'neg']));
    expect(low.parts[3].current).toBeCloseTo(1.5e-6, 9);
    expect(q(low).get('state')?.text).toBe('silent');
    const rev = solveCircuit(series(battery(5), 0.001, ACTIVE_BUZZER, ['neg', 'pos']));
    expect(rev.parts[3].current).toBeCloseTo(-5e-6, 9);
    expect(q(rev).get('state')?.text).toBe('reversed (silent)');
  });

  it('converges over a supply sweep through the turn-on range behind 0..470 ohm', () => {
    for (const ohms of [0.001, 10, 150, 470]) {
      for (let v = 0; v <= 8; v += 0.25) {
        const r = solveCircuit(series(battery(v), ohms, ACTIVE_BUZZER, ['pos', 'neg']));
        expect(r.converged, `${v} V behind ${ohms} ohm`).toBe(true);
        const b = r.parts[3];
        expect(b.current).toBeCloseTo(buzzerCurve(ACTIVE_BUZZER, b.voltage).i, 9);
      }
    }
  });

  it('warns above 6.5 V, burns above 15 V forward and 12 V reversed', () => {
    const t = getPart('buzzer')!;
    expect(partWarning(t, result(5, 0.033), {})).toBeNull();
    expect(partWarning(t, result(9, 0.06), {})).toBe('V 9 V exceeds its 6.5 V rating.');
    expect(burnReason(t, result(14, 0.09), {})).toBeNull();
    expect(burnReason(t, result(16, 0.1), {})).toMatch(/^over-voltage/);
    expect(burnReason(t, result(-11, 0), {})).toBeNull();
    expect(burnReason(t, result(-12.5, 0), {})).toMatch(/^reverse voltage/);
    // In the editor: 9 V warns, 18 V forward and 18 V reversed burn.
    const nine = across('buzzer', ['pos', 'neg']);
    expect(nine.part.state?.burned).toBeUndefined();
    expect(describePart(nine.part, nine.sim)).toMatchObject({ lines: [expect.stringMatching(/V · \d+(\.\d+)? mA$/), 'sounding'] });
    expect(describePart(nine.part, nine.sim)!.warning).toMatch(/exceeds its 6\.5 V rating/);
    expect(across('buzzer', ['pos', 'neg'], {}, { volts18: true }).part.state?.burnedBy).toMatch(/^over-voltage/);
    expect(across('buzzer', ['neg', 'pos'], {}, { volts18: true }).part.state?.burnedBy).toMatch(/^reverse voltage/);
  });
});

describe('7-segment display', () => {
  it('lights one segment through 330 ohm (about 21 mA), the rest stay dark', () => {
    const input = circuit(
      [battery(9, 1.5), resistor(330), getPart('sevenseg')!.sim!({}), GROUND],
      [['1.neg', '4.gnd'], ['1.pos', '2.a'], ['2.b', '3.a'], ['3.com', '4.gnd']],
    );
    const r = solveCircuit(input);
    expect(r.converged).toBe(true);
    const d = r.parts[3];
    const ia = d.pins.a;
    // Hand check: (9 V - Vf) / 331.5 ohm with Vf of the red LED (2.0 V at 20 mA, slope n VT / I + 2.5 ohm).
    expect(ia).toBeCloseTo((9 - d.voltage) / 331.5, 6);
    expect(ia).toBeGreaterThan(0.0205);
    expect(ia).toBeLessThan(0.0215);
    expect(d.voltage).toBeCloseTo(2.0 + (2 * VT) * Math.log(ia / 0.02) + 2.5 * (ia - 0.02), 3);
    for (const s of ['b', 'c', 'd', 'e', 'f', 'g', 'dp']) expect(Math.abs(d.pins[s])).toBeLessThan(1e-9);
    expect(d.pins.com).toBeCloseTo(-ia, 9);
    expect(d.current).toBeCloseTo(ia, 9);
    const q = new Map(inspect(getPart('sevenseg')!.sim!({}), r, { id: 3, type: 'sevenseg' }).map((x) => [x.id, x]));
    expect(q.get('i:a')?.value).toBeCloseTo(ia, 12);
    expect(q.get('i:b')?.value).toBeCloseTo(0, 9);
    expect(q.get('i')?.value).toBeCloseTo(ia, 9);
    expect(q.get('lit')?.text).toBe('a');
    expect(q.get('rating')?.text).toBe('ok');
    expect(sevensegReadout(d)[0]).toBe('Lit: a');
  });

  it('rates each segment like the LED: 30 mA warns, 100 mA burns', () => {
    const t = getPart('sevenseg')!;
    const seg = (amps: number) => result(2, amps, { pins: { a: 0.01, c: amps, com: -amps - 0.01 } });
    expect(partWarning(t, seg(0.025), {})).toBeNull();
    expect(partWarning(t, seg(0.035), {})).toBe('If 35 mA exceeds its 30 mA rating.');
    expect(burnReason(t, seg(0.09), {})).toBeNull();
    expect(burnReason(t, seg(0.12), {})).toMatch(/^too much segment current \(If 120 mA/);
  });

  it('a segment straight on 9 V burns the display; it persists, undo keeps it, a click replaces it', () => {
    const { p, part, sim } = across('sevenseg', ['b', 'com']);
    expect(part.state?.burned).toBe(true);
    expect(part.state?.burnedBy).toMatch(/segment current/);
    expect(sim.partResult(part.id)!.current).toBe(0);
    const burned = p.circuit();
    const fresh = JSON.parse(JSON.stringify(burned)) as typeof burned;
    fresh.parts.find((x) => x.id === part.id)!.state = {};
    expect(editKey(fresh)).toBe(editKey(burned));
    const restored = withLiveState(fresh, p.scene.parts);
    expect(restored.parts.find((x) => x.id === part.id)!.state).toMatchObject({ burned: true });
    const b = new Project();
    b.load(readProject(stringifyProject(p.serialize())));
    const loaded = b.scene.parts.find((x) => x.typeId === 'sevenseg')!;
    expect(loaded.state).toMatchObject({ burned: true, burnedBy: part.state!.burnedBy });
    clickPart(loaded);
    expect(loaded.state?.burned).toBe(false);
  });
});

describe('basic parts: save / load', () => {
  it('round-trips every new part, turned, with its state', () => {
    const a = new Project();
    a.scene.add({ typeId: 'zener', col: 0, row: 0, rotation: 90, state: { value: 3.3 } });
    a.scene.add({ typeId: 'schottky', col: 6, row: 0, rotation: 180 });
    a.scene.add({ typeId: 'ldr', col: 12, row: 0, rotation: 0, state: { lux: 0.5 } });
    a.scene.add({ typeId: 'buzzer', col: 0, row: 8, rotation: 270 });
    const seg = a.scene.add({ typeId: 'sevenseg', col: 10, row: 8, rotation: 0 });
    const buz = a.scene.parts.find((x) => x.typeId === 'buzzer')!;
    expect(a.scene.addWire({ partId: buz.id, pinId: 'pos' }, { partId: seg.id, pinId: 'dp' })).not.toBeNull();
    const first = a.serialize();
    const b = new Project();
    b.load(readProject(stringifyProject(first)));
    expect(b.serialize()).toEqual(first);
    expect(b.scene.parts.map((x) => x.typeId)).toEqual(['zener', 'schottky', 'ldr', 'buzzer', 'sevenseg']);
  });
});

describe('Seven-segment example', () => {
  const example = EXAMPLES.find((e) => e.name === 'Seven-segment')!;

  it('validates (save / load) and lights a, b, c (a 7) when the three switches are closed', () => {
    expect(example).toBeDefined();
    const p = new Project();
    p.scene.insert(example.state);
    const copy = new Project();
    copy.load(readProject(stringifyProject(p.serialize())));
    expect(copy.serialize()).toEqual(p.serialize());
    const sim = new Simulation(p.scene);
    sim.update();
    expect(sim.result?.converged).toBe(true);
    const seg = p.scene.parts.find((x) => x.typeId === 'sevenseg')!;
    const lit = () => sevensegReadout(sim.partResult(seg.id)!)[0];
    expect(lit()).toBe('Lit: none');
    for (const sw of p.scene.parts.filter((x) => x.typeId === 'switch')) clickPart(sw);
    sim.update();
    expect(sim.result?.converged).toBe(true);
    expect(lit()).toBe('Lit: a b c');
    const r = sim.partResult(seg.id)!;
    for (const s of ['a', 'b', 'c']) {
      expect(r.pins[s]).toBeGreaterThan(0.019);
      expect(r.pins[s]).toBeLessThan(0.023);
    }
    expect(seg.state?.burned).toBeUndefined();
    expect(partWarning(getPart('sevenseg')!, r, seg.state ?? {})).toBeNull();
  });
});
