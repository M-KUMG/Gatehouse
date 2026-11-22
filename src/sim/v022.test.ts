// Version 0.2.2 fixes and parts: a lone LED bulb, the relay's inductive kick, the capacitor ratings, the bridge rectifier.

import { describe, expect, it } from 'vitest';
import { burnReason, getPart, partWarning } from '../parts';
import { initialState, solveStep } from './index';
import type { ComponentModel, PartResult, SimInput, Terminal } from './index';
import { relayModel } from './relay';

const t = (s: string): Terminal => {
  const [p, n] = s.split('.');
  return { part: Number(p), pin: n };
};
const circuit = (models: ComponentModel[], wires: [string, string][]): SimInput => ({
  components: models.map((model, i) => ({ id: i + 1, model })), links: wires.map(([a, b]) => [t(a), t(b)]),
});

describe('lone LED bulb', () => {
  it('settles with nothing connected', () => {
    const input = circuit([{ kind: 'ledbulb', volts: 230, watts: 9 }], []);
    let st = initialState(input);
    for (let k = 0; k < 5; k++) {
      const out = solveStep(input, st, 1e-3);
      expect(out.result.converged).toBe(true);
      st = out.state;
    }
  });
});

describe('relay coil behind a switch', () => {
  it('is not burned by its own kick when the switch opens, however small the step', () => {
    const relay = getPart('relay')!;
    for (const dt of [1e-3, 1e-5, 1e-7]) {
      const wired = (closed: boolean): SimInput => circuit(
        [{ kind: 'supply', volts: 5, limit: 1 }, { kind: 'switch', closed }, relayModel(5)],
        [['1.pos', '2.a'], ['2.b', '3.coil1'], ['3.coil2', '1.neg']],
      );
      let st = initialState(wired(true));
      for (let k = 0; k < 40; k++) st = solveStep(wired(true), st, 1e-3).state;
      for (let k = 0; k < 20; k++) {
        const out = solveStep(wired(false), st, dt);
        st = out.state;
        const r = out.result.parts[3];
        expect(burnReason(relay, r, { value: 5 })).toBeNull();
        expect(partWarning(relay, r, { value: 5 })).toBeNull();
      }
    }
  });

  it('still burns on a lasting overvoltage', () => {
    const relay = getPart('relay')!;
    const input = circuit([{ kind: 'supply', volts: 12, limit: 5 }, relayModel(5)], [['1.pos', '2.coil1'], ['2.coil2', '1.neg']]);
    let st = initialState(input);
    let last = solveStep(input, st, 1e-3);
    for (let k = 0; k < 40; k++) {
      st = last.state;
      last = solveStep(input, st, 1e-3);
    }
    expect(burnReason(relay, last.result.parts[2], { value: 5 })).toMatch(/coil overvoltage/);
  });
});

// ---- Bridge rectifier and changeover switch ------------------------------------------------------------------------

import { bridgeModelOf } from '../acparts';
import type { SimResult } from './index';

function run(input: SimInput, dt: number, seconds: number): SimResult[] {
  let state = initialState(input);
  const out: SimResult[] = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const o = solveStep(input, state, dt);
    out.push(o.result);
    state = o.state;
  }
  return out;
}

const bridgeCircuit = (vrms: number, load: number, bridge: ComponentModel = { kind: 'bridge', volts: 400, amps: 2 }, extra: ComponentModel[] = []): SimInput => circuit(
  [{ kind: 'acsource', vrms, freq: 50, limit: 20 }, bridge, { kind: 'resistor', ohms: load }, ...extra],
  [['1.pos', '2.ac1'], ['1.neg', '2.ac2'], ['2.pos', '3.a'], ['2.neg', '3.b']],
);

describe('bridge rectifier', () => {
  it('turns both halves of the sine the same way up, less two diode drops', () => {
    const rs = run(bridgeCircuit(12, 100), 2e-4, 0.1);
    const tail = rs.slice(-100);
    const v = tail.map((r) => r.parts[3].voltage);
    expect(Math.min(...v)).toBeGreaterThan(-0.05);
    expect(Math.max(...v)).toBeGreaterThan(12 * Math.SQRT2 - 2.4);
    expect(Math.max(...v)).toBeLessThan(12 * Math.SQRT2 - 1.2);
    expect(tail[0].converged).toBe(true);
    const part = tail[50].parts[2];
    expect(part.voltage).toBeCloseTo(tail[50].parts[3].voltage, 3);
    expect(part.current).toBeCloseTo(tail[50].parts[3].current, 3);
  });

  it('is warned past its average current rating and burns far past it', () => {
    const bridge = getPart('bridge')!;
    const model = (amps: number): ComponentModel => ({ kind: 'bridge', volts: 400, amps });
    const last = (amps: number, load: number): SimResult => run(bridgeCircuit(24, load, model(amps)), 5e-4, 0.5).pop()!;
    // 24 V RMS into 10 ohm: about 2 A average.
    const light = last(10, 10).parts[2];
    expect(partWarning(bridge, light, { value: 10 })).toBeNull();
    const heavy = last(1.5, 10).parts[2];
    expect(partWarning(bridge, heavy, { value: 1.5 })).toMatch(/average|Surge/);
    const wrecked = last(0.5, 10).parts[2];
    expect(burnReason(bridge, wrecked, { value: 0.5 })).toMatch(/overheated|surge/);
  });

  it('burns when the reverse voltage passes its rating', () => {
    const bridge = getPart('bridge')!;
    // The tallest reverse voltage of the last cycle (the last step alone may sit at a zero crossing).
    const worst = (volts: number): PartResult => run(bridgeCircuit(230, 1000, { kind: 'bridge', volts, amps: 2 }), 2e-4, 0.1).slice(-100)
      .map((r) => r.parts[2]).reduce((a, b) => ((b.volts?.vr ?? 0) > (a.volts?.vr ?? 0) ? b : a));
    expect(burnReason(bridge, worst(100), { volts: 100 })).toMatch(/reverse breakdown/);
    expect(burnReason(bridge, worst(1000), { volts: 1000 })).toBeNull();
  });

  it('smooths into a capacitor without a false overload warning', () => {
    const cap: ComponentModel = { kind: 'capacitor', farads: 470e-6, esr: 0.05 };
    const input = circuit(
      [{ kind: 'acsource', vrms: 12, freq: 50, limit: 20 }, { kind: 'bridge', volts: 400, amps: 2 }, { kind: 'resistor', ohms: 33 }, cap],
      [['1.pos', '2.ac1'], ['1.neg', '2.ac2'], ['2.pos', '3.a'], ['2.neg', '3.b'], ['2.pos', '4.a'], ['2.neg', '4.b']],
    );
    const r = run(input, 2e-4, 0.6).pop()!.parts[2];
    expect(partWarning(getPart('bridge')!, r, {})).toBeNull();
    expect(bridgeModelOf({}).amps).toBe(2);
  });
});

describe('changeover switch', () => {
  const wired = (no: boolean): SimInput => circuit(
    [{ kind: 'supply', volts: 5, limit: 1 }, { kind: 'changeover', no }, { kind: 'resistor', ohms: 100 }, { kind: 'resistor', ohms: 50 }],
    [['1.pos', '2.com'], ['2.no', '3.a'], ['2.nc', '4.a'], ['3.b', '1.neg'], ['4.b', '1.neg']],
  );
  it('joins the common pin to one throw at a time', () => {
    const rest = solveStep(wired(false), initialState(wired(false)), 1e-3).result;
    expect(rest.parts[4].current).toBeGreaterThan(0.09);
    expect(Math.abs(rest.parts[3].current)).toBeLessThan(1e-6);
    expect(rest.parts[2].volts?.pos).toBe(0);
    const on = solveStep(wired(true), initialState(wired(true)), 1e-3).result;
    expect(on.parts[3].current).toBeGreaterThan(0.045);
    expect(Math.abs(on.parts[4].current)).toBeLessThan(1e-6);
    expect(on.parts[2].volts?.pos).toBe(1);
    expect(on.parts[2].current).toBeCloseTo(on.parts[3].current, 4);
  });
  it('is warned and burned by the mains switch rating', () => {
    const sw = getPart('changeover')!;
    const r = (amps: number): PartResult => ({ voltage: 0, current: amps, power: 0, pins: {} });
    expect(partWarning(sw, r(5), {})).toBeNull();
    expect(partWarning(sw, r(12), {})).toMatch(/exceeds/);
    expect(burnReason(sw, r(20), {})).toMatch(/too much current/);
  });
});

describe('capacitor voltage rating', () => {
  const stress = (volts: number): PartResult => ({ voltage: volts, current: 0, power: 0, pins: {} });
  it('takes the rating from the part setting for both kinds, and prints it', () => {
    expect(getPart('capacitor')!.sim!({ value: 1e-6, volts: 100 })).toMatchObject({ kind: 'capacitor', ratedVolts: 100 });
    expect(getPart('capacitor')!.sim!({ value: 1e-6 })).toMatchObject({ ratedVolts: 50 });
    expect(getPart('ecap')!.sim!({ value: 1e-4, volts: 63 })).toMatchObject({ polarized: true, ratedVolts: 63 });
    expect(getPart('ecap')!.sim!({ value: 1e-4 })).toMatchObject({ ratedVolts: 16 });
    expect(getPart('ecap')!.variant!({})).toBeNull();
    expect(getPart('ecap')!.variant!({ volts: 63 })!.svg).toContain('63V');
    expect(getPart('capacitor')!.variant!({})).toBeNull();
    expect(getPart('capacitor')!.variant!({ volts: 100 })!.svg).toContain('100V');
  });
  it('warns near the rating and burns above it, whatever the polarity of a plain capacitor', () => {
    const cap = getPart('capacitor')!;
    const ecap = getPart('ecap')!;
    expect(partWarning(cap, stress(20), {})).toBeNull();
    expect(partWarning(cap, stress(-47), {})).toMatch(/rating/);
    expect(burnReason(cap, stress(-60), {})).toMatch(/over-voltage/);
    expect(burnReason(cap, stress(60), { volts: 100 })).toBeNull();
    expect(burnReason(ecap, stress(20), {})).toMatch(/over-voltage/);
    expect(burnReason(ecap, stress(20), { volts: 63 })).toBeNull();
    expect(cap.sim!({ burned: true })).toEqual({ kind: 'open' });
  });
});

// ---- The example, with the real scene and simulation ---------------------------------------------------------------

import { EXAMPLES } from '../examples';
import { Project } from '../project/project';
import { Simulation } from '../simulation';

describe('Bridge rectifier example', () => {
  it('runs: the smoothing capacitor charges to about 15 V and nothing warns or burns', () => {
    const example = EXAMPLES.find((e) => e.name === 'Bridge rectifier')!;
    expect(example).toBeDefined();
    const p = new Project();
    p.scene.insert(example.state);
    const sim = new Simulation(p.scene);
    sim.update();
    expect(sim.result?.converged).toBe(true);
    sim.start();
    for (let k = 0; k < 20; k++) sim.runTo(0.05 * (k + 1));
    expect(sim.result?.converged).toBe(true);
    const cap = p.scene.parts.find((x) => x.typeId === 'ecap')!;
    const bridge = p.scene.parts.find((x) => x.typeId === 'bridge')!;
    const v = sim.partResult(cap.id)!.voltage;
    expect(v).toBeGreaterThan(13);
    expect(v).toBeLessThan(16.5);
    const r = sim.partResult(bridge.id)!;
    expect(partWarning(getPart('bridge')!, r, bridge.state ?? {})).toBeNull();
    expect(partWarning(getPart('ecap')!, sim.partResult(cap.id)!, cap.state ?? {})).toBeNull();
    expect(bridge.state?.burned).toBeUndefined();
  });
});
