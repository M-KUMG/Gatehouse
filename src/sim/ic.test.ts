// The 555 timer (model 'timer555', timer555.ts) and the dual op-amp (model
// 'opamp', opamp.ts) in the solver: hand-computed DC points, thresholds and
// latch rules, an astable's period and a monostable's pulse against the
// textbook formulas, op-amp gain, saturation and the comparator, supply
// lockout, results and ratings.

import { describe, expect, it } from 'vitest';
import {
  initialState, solveCircuit, solveStep, type ComponentModel, type SimInput, type SimResult, type Terminal, type TransientState,
} from './index';
import { opampQuantities, timerQuantities } from './icinspect';
import { OPAMP_GAIN, OPAMP_HIGH_DROP_VOLTS, OPAMP_LOW_VOLTS, opampStress } from './opamp';
import { TIMER_MIN_SUPPLY, timerStress } from './timer555';

const t = (part: number, pin: string): Terminal => ({ part, pin });
const bat = (volts: number): ComponentModel => ({ kind: 'battery', volts, rInternal: 0.01 });
const res = (ohms: number): ComponentModel => ({ kind: 'resistor', ohms });
const cap = (farads: number): ComponentModel => ({ kind: 'capacitor', farads });

/** Component ids used below. */
const SUPPLY = 1;
const GND = 2;
const CHIP = 3;

interface Net {
  components: { id: number; model: ComponentModel }[];
  links: [Terminal, Terminal][];
}

function circuit(net: Net): SimInput {
  return { components: net.components, links: net.links };
}

/** Steps `input` every `dt` seconds for `seconds`; calls `each` after every step. */
function run(input: SimInput, dt: number, seconds: number, each: (time: number, r: SimResult) => void): void {
  let state: TransientState = initialState(input);
  for (let time = dt; time <= seconds + 1e-12; time += dt) {
    const out = solveStep(input, state, dt);
    state = out.state;
    each(time, out.result);
  }
}

/** The times (s) at which `read` crosses `level` upwards and downwards. */
function edges(input: SimInput, dt: number, seconds: number, read: (r: SimResult) => number, level: number) {
  const up: number[] = [];
  const down: number[] = [];
  let prev: number | null = null;
  run(input, dt, seconds, (time, r) => {
    const v = read(r);
    if (prev !== null && prev < level && v >= level) up.push(time);
    if (prev !== null && prev >= level && v < level) down.push(time);
    prev = v;
  });
  return { up, down };
}

describe('555 timer: DC', () => {
  /** The chip on a supply with every input at the given volts (undefined = left open), 10 k load on OUT. */
  function dc(vcc: number, inputs: Partial<Record<'trig' | 'thr' | 'reset' | 'ctrl', number | undefined>>, q?: boolean): SimResult {
    const components: Net['components'] = [
      { id: SUPPLY, model: bat(vcc) },
      { id: GND, model: { kind: 'ground' } },
      { id: CHIP, model: { kind: 'timer555' } },
      { id: 4, model: res(10_000) },
    ];
    const links: Net['links'] = [
      [t(SUPPLY, 'neg'), t(GND, 'gnd')], [t(SUPPLY, 'pos'), t(CHIP, 'vcc')], [t(CHIP, 'gnd'), t(GND, 'gnd')],
      [t(CHIP, 'out'), t(4, 'a')], [t(4, 'b'), t(GND, 'gnd')],
    ];
    let id = 10;
    for (const [pin, v] of Object.entries(inputs)) {
      if (v === undefined) continue;
      components.push({ id, model: bat(v) });
      links.push([t(id, 'pos'), t(CHIP, pin)], [t(id, 'neg'), t(GND, 'gnd')]);
      id++;
    }
    const input = circuit({ components, links });
    // A DC solve starts cleared; a state is reached with a transient step from the stored latch.
    if (q === undefined) return solveCircuit(input);
    const state: TransientState = { ...initialState(input), logic: { [CHIP]: { q } } };
    return solveStep(input, state, 1e-6).result;
  }

  it('divides the supply for the thresholds: ctrl at 2/3 of 9 V', () => {
    const r = dc(9, { reset: 9, trig: 9, thr: 0 });
    expect(r.converged).toBe(true);
    // 5 k over 10 k: 6 V, loaded only by the quiescent resistors in parallel with the whole divider (not the tap).
    expect(r.parts[CHIP].volts!.ctrl).toBeCloseTo(6, 1);
  });

  it('a low trigger sets the output (high, a little below vcc under load), a high threshold clears it', () => {
    const set = dc(9, { reset: 9, trig: 0, thr: 0 });
    expect(set.parts[CHIP].volts!['logic.q']).toBe(1);
    // 12 ohm in series with the 10 k load.
    expect(set.parts[CHIP].volts!.out).toBeCloseTo(9 * 10_000 / 10_012, 1);
    const clear = dc(9, { reset: 9, trig: 9, thr: 9 });
    expect(clear.parts[CHIP].volts!['logic.q']).toBe(0);
    expect(clear.parts[CHIP].volts!.out).toBeLessThan(0.01);
  });

  it('holds its state between the thresholds, in both states', () => {
    // trig and thr at 4.5 V: between 3 V (1/3) and 6 V (2/3).
    expect(dc(9, { reset: 9, trig: 4.5, thr: 4.5 }, true).parts[CHIP].volts!['logic.q']).toBe(1);
    expect(dc(9, { reset: 9, trig: 4.5, thr: 4.5 }, false).parts[CHIP].volts!['logic.q']).toBe(0);
  });

  it('the trigger overrides the threshold; reset overrides everything', () => {
    expect(dc(9, { reset: 9, trig: 0, thr: 9 }).parts[CHIP].volts!['logic.q']).toBe(1);
    expect(dc(9, { reset: 0, trig: 0, thr: 0 }).parts[CHIP].volts!['logic.q']).toBe(0);
    expect(dc(9, { reset: 0.5, trig: 0, thr: 0 }, true).parts[CHIP].volts!['logic.q']).toBe(0);
  });

  it('an open reset pin holds the chip in reset (the real pin sinks current), which the inspector says', () => {
    const r = dc(9, { trig: 0, thr: 0 });
    expect(r.parts[CHIP].volts!['logic.q']).toBe(0);
    const q = new Map(timerQuantities(r.parts[CHIP]).map((x) => [x.id, x]));
    expect(q.get('reset')?.text).toBe('low (held in reset)');
  });

  it('a voltage on ctrl moves both thresholds (upper = ctrl, lower = ctrl / 2)', () => {
    // ctrl at 3 V: the upper threshold is 3 V, the lower 1.5 V. thr at 3.5 clears, trig at 1.2 sets.
    expect(dc(9, { reset: 9, ctrl: 3, thr: 3.5, trig: 9 }, true).parts[CHIP].volts!['logic.q']).toBe(0);
    expect(dc(9, { reset: 9, ctrl: 3, thr: 0, trig: 1.2 }, false).parts[CHIP].volts!['logic.q']).toBe(1);
    expect(dc(9, { reset: 9, ctrl: 3, thr: 0, trig: 2 }, false).parts[CHIP].volts!['logic.q']).toBe(0);
  });

  it('does nothing under 3 V of supply: the latch is cleared', () => {
    expect(TIMER_MIN_SUPPLY).toBe(3);
    expect(dc(2.5, { reset: 2.5, trig: 0, thr: 0 }).parts[CHIP].volts!['logic.q']).toBe(0);
    expect(dc(3.5, { reset: 3.5, trig: 0, thr: 0 }).parts[CHIP].volts!['logic.q']).toBe(1);
  });

  it('the discharge pin pulls to ground while the output is low and is open while it is high', () => {
    const lowOut = dc(9, { reset: 9, trig: 9, thr: 9 });
    expect(lowOut.parts[CHIP].pins.disch).toBe(0); // nothing connected
    // Through 1 k from vcc: 9 V / (1 k + 15 ohm) while discharging.
    const components: Net['components'] = [
      { id: SUPPLY, model: bat(9) }, { id: GND, model: { kind: 'ground' } }, { id: CHIP, model: { kind: 'timer555' } }, { id: 4, model: res(1000) },
    ];
    const links: Net['links'] = [
      [t(SUPPLY, 'neg'), t(GND, 'gnd')], [t(SUPPLY, 'pos'), t(CHIP, 'vcc')], [t(CHIP, 'gnd'), t(GND, 'gnd')],
      [t(SUPPLY, 'pos'), t(4, 'a')], [t(4, 'b'), t(CHIP, 'disch')], [t(SUPPLY, 'pos'), t(CHIP, 'reset')],
    ];
    const r = solveCircuit(circuit({ components, links })); // trig and thr open: pulled low, trig sets it -> disch off
    expect(r.parts[CHIP].volts!['logic.q']).toBe(1);
    expect(r.parts[CHIP].pins.disch).toBeCloseTo(0, 6);
    const held = solveCircuit(circuit({ components, links: links.filter((l) => l[1].pin !== 'reset') })); // reset open: cleared
    expect(held.parts[CHIP].pins.disch).toBeCloseTo(9 / 1015, 5);
  });
});

describe('555 timer: astable and monostable', () => {
  /** The textbook astable: R1 vcc-disch, R2 disch-thr, C thr-gnd, trig tied to thr, reset to vcc; 10 k load on OUT. */
  function astable(vcc: number, r1: number, r2: number, farads: number): SimInput {
    return circuit({
      components: [
        { id: SUPPLY, model: bat(vcc) }, { id: GND, model: { kind: 'ground' } }, { id: CHIP, model: { kind: 'timer555' } },
        { id: 4, model: res(r1) }, { id: 5, model: res(r2) }, { id: 6, model: cap(farads) }, { id: 7, model: res(10_000) },
      ],
      links: [
        [t(SUPPLY, 'neg'), t(GND, 'gnd')], [t(SUPPLY, 'pos'), t(CHIP, 'vcc')], [t(CHIP, 'gnd'), t(GND, 'gnd')],
        [t(CHIP, 'reset'), t(SUPPLY, 'pos')],
        [t(SUPPLY, 'pos'), t(4, 'a')], [t(4, 'b'), t(CHIP, 'disch')], [t(CHIP, 'disch'), t(5, 'a')],
        [t(5, 'b'), t(CHIP, 'thr')], [t(CHIP, 'thr'), t(CHIP, 'trig')], [t(CHIP, 'thr'), t(6, 'a')], [t(6, 'b'), t(GND, 'gnd')],
        [t(CHIP, 'out'), t(7, 'a')], [t(7, 'b'), t(GND, 'gnd')],
      ],
    });
  }

  it('oscillates at the textbook frequency: high 0.693 (R1 + R2) C, low 0.693 R2 C (within 3 %)', () => {
    const input = astable(9, 1000, 47_000, 10e-6);
    const e = edges(input, 1e-3, 6, (r) => r.parts[CHIP].volts!.out, 4.5);
    expect(e.up.length).toBeGreaterThanOrEqual(4);
    const high = 0.693 * 48_000 * 10e-6; // 0.3326 s
    const low = 0.693 * 47_000 * 10e-6; // 0.3257 s
    // From a rising edge to the next falling edge, and falling to rising.
    const highs = e.up.slice(1).map((u) => e.down.find((d) => d > u)! - u);
    const lows = e.down.slice(0, -1).map((d) => e.up.find((u) => u > d)! - d).filter((x) => Number.isFinite(x));
    for (const h of highs.slice(0, 3)) expect(h / high).toBeGreaterThan(0.97), expect(h / high).toBeLessThan(1.03);
    for (const l of lows.slice(1, 4)) expect(l / low).toBeGreaterThan(0.97), expect(l / low).toBeLessThan(1.03);
  });

  it('the capacitor swings between 1/3 and 2/3 of the supply', () => {
    let lo = Infinity;
    let hi = -Infinity;
    run(astable(9, 1000, 47_000, 10e-6), 1e-3, 5, (time, r) => {
      if (time < 1.5) return; // after the first charge from empty
      const v = r.parts[CHIP].volts!.thr;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    });
    expect(lo).toBeGreaterThan(2.9);
    expect(lo).toBeLessThan(3.1);
    expect(hi).toBeGreaterThan(5.9);
    expect(hi).toBeLessThan(6.1);
  });

  it('keeps its period when the supply changes (the thresholds scale with it)', () => {
    const period = (vcc: number): number => {
      const e = edges(astable(vcc, 1000, 47_000, 10e-6), 1e-3, 5, (r) => r.parts[CHIP].volts!.out, vcc / 2);
      return e.up[3] - e.up[2];
    };
    expect(period(5) / period(12)).toBeGreaterThan(0.97);
    expect(period(5) / period(12)).toBeLessThan(1.03);
  });

  it('a monostable gives a pulse of 1.1 R C after a low trigger', () => {
    // R from vcc to thr/disch, C to ground, trig pulled high by 10 k and pulled low by a switch-like source.
    const make = (trigVolts: number): SimInput => circuit({
      components: [
        { id: SUPPLY, model: bat(9) }, { id: GND, model: { kind: 'ground' } }, { id: CHIP, model: { kind: 'timer555' } },
        { id: 4, model: res(100_000) }, { id: 5, model: cap(10e-6) }, { id: 6, model: bat(trigVolts) }, { id: 7, model: res(10_000) },
      ],
      links: [
        [t(SUPPLY, 'neg'), t(GND, 'gnd')], [t(SUPPLY, 'pos'), t(CHIP, 'vcc')], [t(CHIP, 'gnd'), t(GND, 'gnd')],
        [t(CHIP, 'reset'), t(SUPPLY, 'pos')],
        [t(SUPPLY, 'pos'), t(4, 'a')], [t(4, 'b'), t(CHIP, 'thr')], [t(CHIP, 'thr'), t(CHIP, 'disch')], [t(CHIP, 'thr'), t(5, 'a')],
        [t(5, 'b'), t(GND, 'gnd')],
        [t(6, 'pos'), t(CHIP, 'trig')], [t(6, 'neg'), t(GND, 'gnd')],
        [t(CHIP, 'out'), t(7, 'a')], [t(7, 'b'), t(GND, 'gnd')],
      ],
    });
    // Rest (trig high), then a trigger pulse of 20 ms, then high again. The source changes between runs of one stepper.
    let state: TransientState = initialState(make(9));
    const out: { time: number; v: number }[] = [];
    const dt = 1e-3;
    for (let time = dt; time < 3; time += dt) {
      const input = make(time > 0.1 && time <= 0.12 ? 0 : 9);
      const step = solveStep(input, state, dt);
      state = step.state;
      out.push({ time, v: step.result.parts[CHIP].volts!.out });
    }
    expect(out.find((p) => p.time < 0.09)!.v).toBeLessThan(0.1); // idle: low
    const rise = out.find((p) => p.v > 4.5)!;
    expect(rise.time).toBeGreaterThan(0.1);
    const fall = out.find((p) => p.time > rise.time && p.v < 4.5)!;
    const width = fall.time - rise.time;
    expect(width / (1.1 * 100_000 * 10e-6)).toBeGreaterThan(0.95); // 1.1 s
    expect(width / (1.1 * 100_000 * 10e-6)).toBeLessThan(1.05);
  });
});

describe('op-amp', () => {
  /** The chip (vcc, gnd rails) with the given extra components and links; amplifier 1's pins are o1, n1, p1. */
  function amp(vcc: number, extra: Net['components'], more: Net['links'], vee = 0): SimInput {
    const components: Net['components'] = [
      { id: SUPPLY, model: bat(vcc) }, { id: GND, model: { kind: 'ground' } }, { id: CHIP, model: { kind: 'opamp' } }, ...extra,
    ];
    const links: Net['links'] = [[t(SUPPLY, 'pos'), t(CHIP, 'vcc')], ...more];
    if (vee === 0) links.push([t(SUPPLY, 'neg'), t(GND, 'gnd')], [t(CHIP, 'gnd'), t(GND, 'gnd')]);
    else {
      // Split supply: a second battery below ground.
      components.push({ id: 90, model: bat(vee) });
      links.push([t(SUPPLY, 'neg'), t(GND, 'gnd')], [t(90, 'pos'), t(GND, 'gnd')], [t(90, 'neg'), t(CHIP, 'gnd')]);
    }
    return circuit({ components, links });
  }

  /** Voltage follower from `vin` (a battery on in+, out tied to in-). */
  const follower = (vcc: number, vin: number, load = 10_000): SimInput => amp(
    vcc,
    [{ id: 10, model: bat(vin) }, { id: 11, model: res(load) }],
    [
      [t(10, 'pos'), t(CHIP, 'p1')], [t(10, 'neg'), t(GND, 'gnd')],
      [t(CHIP, 'o1'), t(CHIP, 'n1')], [t(CHIP, 'o1'), t(11, 'a')], [t(11, 'b'), t(GND, 'gnd')],
    ],
  );

  it('a voltage follower copies its input within the finite gain', () => {
    const r = solveCircuit(follower(9, 3));
    expect(r.converged).toBe(true);
    // Gain 1e5 behind 50 ohm into 10 k: the error is about vin / gain.
    expect(r.parts[CHIP].volts!.o1).toBeCloseTo(3, 3);
    expect(r.parts[CHIP].volts!.o1).toBeLessThan(3);
    expect(r.parts[CHIP].volts!['logic.hi1']).toBe(0);
    expect(r.parts[CHIP].volts!['logic.lo1']).toBe(0);
  });

  it('non-inverting amplifier: gain 1 + Rf / Rg = 5 (4.7 k over 1.2 k is 4.917)', () => {
    const r = solveCircuit(amp(
      12,
      [{ id: 10, model: bat(1) }, { id: 11, model: res(4700) }, { id: 12, model: res(1200) }],
      [
        [t(10, 'pos'), t(CHIP, 'p1')], [t(10, 'neg'), t(GND, 'gnd')],
        [t(CHIP, 'o1'), t(11, 'a')], [t(11, 'b'), t(CHIP, 'n1')], [t(CHIP, 'n1'), t(12, 'a')], [t(12, 'b'), t(GND, 'gnd')],
      ],
    ));
    expect(r.parts[CHIP].volts!.o1).toBeCloseTo(1 * (1 + 4700 / 1200), 2);
  });

  it('inverting amplifier on a split supply: gain -Rf / Rin = -10', () => {
    const r = solveCircuit(amp(
      9,
      [{ id: 10, model: bat(0.5) }, { id: 11, model: res(1000) }, { id: 12, model: res(10_000) }],
      [
        [t(CHIP, 'p1'), t(GND, 'gnd')],
        [t(10, 'pos'), t(11, 'a')], [t(10, 'neg'), t(GND, 'gnd')], [t(11, 'b'), t(CHIP, 'n1')],
        [t(CHIP, 'n1'), t(12, 'a')], [t(12, 'b'), t(CHIP, 'o1')],
      ],
      9,
    ));
    // Absolute output voltage (the pin volts are against the -9 V rail): 0.5 V in, gain -10 -> -5 V.
    expect(r.voltages[r.nets[`${CHIP}:o1`]]).toBeCloseTo(-5, 2);
  });

  it('saturates at the rails: high at vcc - 1.5 V, low at 20 mV above gnd', () => {
    const high = solveCircuit(follower(9, 8.5)); // wants 8.5 V, but 9 - 1.5 = 7.5 V is the most it gives
    expect(high.parts[CHIP].volts!.o1).toBeCloseTo(9 - OPAMP_HIGH_DROP_VOLTS, 1);
    expect(high.parts[CHIP].volts!['logic.hi1']).toBe(1);
    const lowIn = solveCircuit(follower(9, 0));
    expect(lowIn.parts[CHIP].volts!.o1).toBeLessThan(0.05);
    // A negative input with a single supply: the output stays at the bottom rail.
    const neg = solveCircuit(follower(9, -1));
    expect(neg.parts[CHIP].volts!['logic.lo1']).toBe(1);
    expect(neg.parts[CHIP].volts!.o1).toBeCloseTo(OPAMP_LOW_VOLTS, 1);
  });

  /** A comparator: in+ = `plus`, in- = `minus` (batteries), output through 1 k to ground. */
  const comparator = (vcc: number, plus: number, minus: number): SimInput => amp(
    vcc,
    [{ id: 10, model: bat(plus) }, { id: 13, model: bat(minus) }, { id: 11, model: res(1000) }],
    [
      [t(10, 'pos'), t(CHIP, 'p1')], [t(10, 'neg'), t(GND, 'gnd')], [t(13, 'pos'), t(CHIP, 'n1')], [t(13, 'neg'), t(GND, 'gnd')],
      [t(CHIP, 'o1'), t(11, 'a')], [t(11, 'b'), t(GND, 'gnd')],
    ],
  );

  it('a comparator swings to the high rail when in+ is above in-, to the low rail when below', () => {
    const above = solveCircuit(comparator(9, 2.001, 2));
    expect(above.converged).toBe(true);
    expect(above.parts[CHIP].volts!['logic.hi1']).toBe(1);
    // 7.5 V into a 1 k load behind 50 ohm.
    expect(above.parts[CHIP].volts!.o1).toBeCloseTo(7.5 * 1000 / 1050, 1);
    const below = solveCircuit(comparator(9, 1.999, 2));
    expect(below.parts[CHIP].volts!['logic.lo1']).toBe(1);
    expect(below.parts[CHIP].volts!.o1).toBeLessThan(0.05);
    // The linear window is 1 mV / 1e5 wide... 5e-5 V of difference is already enough to saturate 7.5 V.
    expect(OPAMP_GAIN * 1e-4).toBeGreaterThan(7.5);
    expect(solveCircuit(comparator(9, 2.0001, 2)).parts[CHIP].volts!['logic.hi1']).toBe(1);
  });

  it('the two amplifiers are independent', () => {
    const input = amp(
      9,
      [{ id: 10, model: bat(3) }, { id: 13, model: bat(1) }, { id: 11, model: res(10_000) }, { id: 12, model: res(10_000) }],
      [
        [t(10, 'pos'), t(CHIP, 'p1')], [t(10, 'neg'), t(GND, 'gnd')], [t(CHIP, 'o1'), t(CHIP, 'n1')], [t(CHIP, 'o1'), t(11, 'a')], [t(11, 'b'), t(GND, 'gnd')],
        [t(13, 'pos'), t(CHIP, 'p2')], [t(13, 'neg'), t(GND, 'gnd')], [t(CHIP, 'n2'), t(GND, 'gnd')], [t(CHIP, 'o2'), t(12, 'a')], [t(12, 'b'), t(GND, 'gnd')],
      ],
    );
    const r = solveCircuit(input);
    expect(r.parts[CHIP].volts!.o1).toBeCloseTo(3, 2); // follower
    expect(r.parts[CHIP].volts!['logic.hi2']).toBe(1); // comparator: 1 V above 0 V
  });

  it('is off under 3 V of supply: the outputs do not drive', () => {
    const r = solveCircuit(follower(2.5, 1));
    expect(r.parts[CHIP].volts!['logic.off']).toBe(1);
    expect(Math.abs(r.parts[CHIP].volts!.o1)).toBeLessThan(0.05);
  });

  it('draws its quiescent current from the supply (10 k across the rails)', () => {
    const r = solveCircuit(comparator(9, 1, 2)); // output low: sinks nothing
    expect(r.parts[CHIP].pins.vcc).toBeCloseTo(9 / 10_000, 4);
    expect(r.parts[CHIP].power).toBeGreaterThan(0);
  });

  it('the inspector names the mode and the rating state', () => {
    const q = new Map(opampQuantities(solveCircuit(comparator(9, 3, 2)).parts[CHIP]).map((x) => [x.id, x]));
    expect(q.get('mode1')?.text).toBe('saturated high');
    expect(q.get('mode2')?.text).toBe('saturated low'); // the unused amplifier: both inputs at 0 V, output at the bottom rail
    expect(q.get('state')?.text).toBe('ok');
    const lin = new Map(opampQuantities(solveCircuit(follower(9, 3)).parts[CHIP]).map((x) => [x.id, x]));
    expect(lin.get('mode1')?.text).toBe('linear');
    expect(lin.get('vo1')?.value).toBeCloseTo(3, 2);
  });
});

describe('ratings', () => {
  it('555: warns above 16 V and 200 mA, burns above 18 V and 400 mA', () => {
    expect(timerStress(15, 0.1).level).toBe('ok');
    expect(timerStress(17, 0.1).level).toBe('warn');
    expect(timerStress(19, 0.1).level).toBe('burn');
    expect(timerStress(9, 0.25).level).toBe('warn');
    expect(timerStress(9, -0.25).level).toBe('warn'); // sourcing counts too
    expect(timerStress(9, 0.5).level).toBe('burn');
  });

  it('op-amp: warns above 32 V and 30 mA, burns above 40 V, 100 mA or a reversed supply', () => {
    expect(opampStress(9, [0.01, 0]).level).toBe('ok');
    expect(opampStress(35, [0, 0]).level).toBe('warn');
    expect(opampStress(9, [0, 0.05]).level).toBe('warn');
    expect(opampStress(45, [0, 0]).level).toBe('burn');
    expect(opampStress(9, [0.2, 0]).level).toBe('burn');
    expect(opampStress(-9, [0, 0]).level).toBe('burn');
  });
});
