import { describe, expect, it } from 'vitest';
import { RED_LED, initialState, linkCurrents, solveCircuit, solveStep } from './index';
import type { ComponentModel, SimInput, SimResult, StepOptions, Terminal, TransientState } from './index';

function circuit(models: ComponentModel[], wires: [string, string][]): SimInput {
  const terminal = (s: string): Terminal => {
    const [part, pin] = s.split('.');
    return { part: Number(part), pin };
  };
  return {
    components: models.map((model, i) => ({ id: i + 1, model })),
    links: wires.map(([a, b]) => [terminal(a), terminal(b)]),
  };
}

const battery = (volts: number, rInternal = 0): ComponentModel => ({ kind: 'battery', volts, rInternal });
const resistor = (ohms: number): ComponentModel => ({ kind: 'resistor', ohms });
const toggle = (closed: boolean): ComponentModel => ({ kind: 'switch', closed });
const cap = (farads: number, esr?: number): ComponentModel => ({ kind: 'capacitor', farads, esr });
const ground: ComponentModel = { kind: 'ground' };

/** Runs `steps` steps of `dt`; `inputAt(k)` is the circuit during step k. Returns every result and the last state. */
function run(
  inputAt: (k: number) => SimInput, state: TransientState, dt: number, steps: number, options?: StepOptions,
): { results: SimResult[]; state: TransientState } {
  const results: SimResult[] = [];
  for (let k = 0; k < steps; k++) {
    const out = solveStep(inputAt(k), state, dt, options);
    results.push(out.result);
    state = out.state;
  }
  return { results, state };
}

// Battery 5 V -> 1 kOhm -> 1 uF -> back to the battery: RC = 1 ms.
const V = 5;
const R = 1000;
const C = 1e-6;
const RC = R * C;
const rc = (volts = V): SimInput =>
  circuit([battery(volts), resistor(R), cap(C), ground], [['1.pos', '2.a'], ['2.b', '3.a'], ['3.b', '1.neg'], ['1.neg', '4.gnd']]);

describe('capacitor in the DC solve', () => {
  it('is open: no current, charged to the full supply', () => {
    const r = solveCircuit(rc());
    expect(r.converged).toBe(true);
    expect(r.parts[3].current).toBe(0);
    expect(r.parts[3].voltage).toBeCloseTo(V, 6);
    expect(r.parts[2].current).toBeCloseTo(0, 9);
  });

  it('initialState gives the DC charge, or empty on request', () => {
    expect(initialState(rc()).stored[3].volts).toBeCloseTo(V, 6);
    expect(initialState(rc(), { charged: false })).toEqual({ time: 0, stored: {} });
    expect(initialState({ ...rc(), time: 2 }).time).toBe(2);
  });
});

describe('RC charge and discharge', () => {
  const charge = (t: number): number => V * (1 - Math.exp(-t / RC));

  it.each([
    ['euler', RC / 50, 0.01],
    ['euler', RC / 10, 0.05],
    ['trapezoidal', RC / 10, 0.005],
  ] as const)('charges as V(1 - exp(-t/RC)) with %s, dt = %s', (method, dt, tol) => {
    const steps = Math.round((3 * RC) / dt);
    let start = initialState(rc(), { charged: false });
    // Trapezoidal needs consistent currents after an abrupt change: one tiny Euler step gives them.
    if (method === 'trapezoidal') start = { ...solveStep(rc(), start, 1e-9).state, time: 0 };
    const { results, state } = run(() => rc(), start, dt, steps, { method });
    for (const r of results) {
      expect(r.converged).toBe(true);
      const t = r.time;
      if (t < 0.5 * RC) continue;
      const v = r.parts[3].voltage;
      expect(Math.abs(v - charge(t)) / charge(t)).toBeLessThan(tol);
      // The resistor carries the capacitor current.
      expect(r.parts[2].current).toBeCloseTo(r.parts[3].current, 9);
    }
    expect(state.time).toBeCloseTo(3 * RC, 12);
    expect(results[0].parts[3].current).toBeGreaterThan(0.004); // close to V/R at the start
  });

  it('discharges through a resistor once the supply is switched away', () => {
    // Battery -> switch -> cap.a; cap.b to ground; resistor across the cap.
    const net = (closed: boolean): SimInput =>
      circuit(
        [battery(V), toggle(closed), cap(C), resistor(R), ground],
        [['1.pos', '2.a'], ['2.b', '3.a'], ['3.b', '1.neg'], ['3.a', '4.a'], ['4.b', '3.b'], ['1.neg', '5.gnd']],
      );
    const start = initialState(net(true));
    const v0 = start.stored[3].volts;
    expect(v0).toBeCloseTo(V, 3);
    const dt = RC / 100;
    const { results } = run(() => net(false), start, dt, 300);
    for (const r of results) {
      const expected = v0 * Math.exp(-r.time / RC);
      expect(Math.abs(r.parts[3].voltage - expected)).toBeLessThan(0.01 * v0);
      expect(r.parts[3].current).toBeLessThan(0); // flows out of a
    }
  });
});

describe('capacitor with a switch', () => {
  // Battery -> switch -> resistor -> cap -> battery.
  const net = (closed: boolean): SimInput =>
    circuit(
      [battery(V), toggle(closed), resistor(R), cap(C)],
      [['1.pos', '2.a'], ['2.b', '3.a'], ['3.b', '4.a'], ['4.b', '1.neg']],
    );

  it('stays empty while open and charges once closed, wires carry its current', () => {
    let state = initialState(net(false), { charged: false });
    const dt = RC / 50;
    const open = run(() => net(false), state, dt, 50);
    for (const r of open.results) expect(Math.abs(r.parts[4].voltage)).toBeLessThan(1e-3);
    state = open.state;
    const closed = run(() => net(true), state, dt, 50);
    const last = closed.results[49];
    expect(Math.abs(last.parts[4].voltage - V * (1 - Math.exp(-1))) / V).toBeLessThan(0.01);
    const input = net(true);
    const flows = linkCurrents(input, last);
    for (const f of flows) expect(f).toBeCloseTo(last.parts[4].current, 9);
    expect(last.parts[4].pins.a).toBeCloseTo(last.parts[4].current, 12);
  });
});

describe('RC low-pass with a square wave', () => {
  it('settles to the known periodic swing', () => {
    // The battery toggles between 5 V and 0 V every RC (changed between steps).
    const dt = RC / 200;
    const half = 200;
    const { results } = run((k) => rc(Math.floor(k / half) % 2 === 0 ? V : 0), initialState(rc(0)), dt, half * 20);
    const e = Math.exp(-1);
    const top = V / (1 + e);
    const bottom = (V * e) / (1 + e);
    const lastHigh = results[half * 19 - 1].parts[3].voltage; // end of the 10th high half
    const lastLow = results[half * 20 - 1].parts[3].voltage;
    expect(Math.abs(lastHigh - top) / top).toBeLessThan(0.02);
    expect(Math.abs(lastLow - bottom) / bottom).toBeLessThan(0.02);
  });
});

describe('steady state and stability', () => {
  it('ends where the DC solve is (divider with an ESR capacitor)', () => {
    const input = circuit(
      [battery(9), resistor(1000), resistor(2000), cap(10e-6, 10), ground],
      [['1.pos', '2.a'], ['2.b', '3.a'], ['3.b', '1.neg'], ['2.b', '4.a'], ['4.b', '1.neg'], ['1.neg', '5.gnd']],
    );
    const dc = solveCircuit(input);
    const { results, state } = run(() => input, initialState(input, { charged: false }), 1e-3, 500);
    const last = results[499];
    const node = (r: SimResult): number => r.voltages[r.nets['2:b']];
    expect(node(last)).toBeCloseTo(node(dc), 6);
    expect(node(dc)).toBeCloseTo(6, 6);
    expect(last.parts[4].current).toBeCloseTo(0, 9);
    expect(state.stored[4].volts).toBeCloseTo(dc.parts[4].voltage, 6);
    // Starting from the DC point nothing moves.
    const still = solveStep(input, initialState(input), 1e-4).result;
    expect(node(still)).toBeCloseTo(node(dc), 9);
  });

  it('does not blow up for dt much larger than RC (backward Euler)', () => {
    const { results } = run(() => rc(), initialState(rc(), { charged: false }), 1000 * RC, 5);
    for (const r of results) {
      expect(r.converged).toBe(true);
      expect(r.parts[3].voltage).toBeGreaterThan(0);
      expect(r.parts[3].voltage).toBeLessThanOrEqual(V + 1e-9);
    }
    expect(results[0].parts[3].voltage).toBeCloseTo(V * (1000 / 1001), 6);
    expect(results[4].parts[3].voltage).toBeCloseTo(V, 6);
  });

  it('rejects a non-positive dt', () => {
    expect(() => solveStep(rc(), initialState(rc()), 0)).toThrow(RangeError);
  });
});

describe('nonlinear parts in a transient', () => {
  it('converges with an LED, a resistor and a capacitor and settles at the DC point', () => {
    // 9 V -> 330 ohm -> LED to ground, 100 uF across the LED.
    const input = circuit(
      [battery(9, 1.5), resistor(330), RED_LED, cap(100e-6), ground],
      [['1.pos', '2.a'], ['2.b', '3.anode'], ['3.cathode', '1.neg'], ['2.b', '4.a'], ['4.b', '1.neg'], ['1.neg', '5.gnd']],
    );
    const { results } = run(() => input, initialState(input, { charged: false }), 1e-3, 300);
    for (const r of results) expect(r.converged).toBe(true);
    // Early on the capacitor takes the current and the LED is dark.
    expect(results[0].parts[3].current).toBeLessThan(1e-4);
    expect(results[0].parts[4].current).toBeGreaterThan(0.02);
    const dc = solveCircuit(input);
    expect(results[299].parts[3].current).toBeCloseTo(dc.parts[3].current, 6);
  });

  it('reports non-convergence and holds the charge', () => {
    const input = circuit([battery(1.5, 0), cap(C)], [['1.pos', '1.neg'], ['1.pos', '2.a'], ['2.b', '1.neg']]);
    const state: TransientState = { time: 0, stored: { 2: { volts: 1, amps: 0 } } };
    const out = solveStep(input, state, 1e-3);
    expect(out.result.converged).toBe(false);
    expect(out.result.parts[2].current).toBe(0);
    expect(out.state).toEqual({ time: 1e-3, stored: { 2: { volts: 1, amps: 0 } } });
  });
});

describe('determinism', () => {
  it('gives identical output for the same steps', () => {
    const go = () => run((k) => rc(k % 7 < 3 ? V : 1), initialState(rc(), { charged: false }), RC / 13, 40);
    const a = go();
    const b = go();
    expect(a).toEqual(b);
  });

  it('does not mutate the state passed in', () => {
    const state = initialState(rc(), { charged: false });
    const copy = structuredClone(state);
    solveStep(rc(), state, RC / 10);
    expect(state).toEqual(copy);
  });
});

describe('capacitor ESR', () => {
  it('charges with tau = (R + ESR) C and shows the ESR drop at its pins', () => {
    const esr = 100;
    const input = circuit(
      [battery(V), resistor(R), cap(C, esr), ground],
      [['1.pos', '2.a'], ['2.b', '3.a'], ['3.b', '1.neg'], ['1.neg', '4.gnd']],
    );
    const tau = (R + esr) * C;
    const { results, state } = run(() => input, initialState(input, { charged: false }), tau / 100, 100);
    const vc = state.stored[3].volts;
    expect(Math.abs(vc - V * (1 - Math.exp(-1))) / V).toBeLessThan(0.01);
    const p = results[99].parts[3];
    expect(p.voltage).toBeCloseTo(vc + p.current * esr, 9);
    expect(results[0].parts[3].current).toBeLessThan(V / (R + esr) + 1e-9);
  });
});

describe('inductor', () => {
  const rl = (): SimInput =>
    circuit(
      [battery(V), resistor(10), { kind: 'inductor', henries: 10e-3 }, ground],
      [['1.pos', '2.a'], ['2.b', '3.a'], ['3.b', '1.neg'], ['1.neg', '4.gnd']],
    );

  it('is a near short in DC and starts at its DC current', () => {
    const dc = solveCircuit(rl());
    expect(dc.parts[3].current).toBeCloseTo(0.5, 4);
    expect(initialState(rl()).stored[3]).toEqual({ volts: 0, amps: dc.parts[3].current });
  });

  it('builds up current as V/R (1 - exp(-t R/L))', () => {
    const tau = 10e-3 / 10;
    const { results } = run(() => rl(), initialState(rl(), { charged: false }), tau / 100, 300);
    for (const r of results) {
      const expected = 0.5 * (1 - Math.exp(-r.time / tau));
      expect(Math.abs(r.parts[3].current - expected)).toBeLessThan(0.01 * 0.5);
    }
  });
});
