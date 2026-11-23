import { describe, expect, it } from 'vitest';
import { ADAPTIVE_DEFAULTS, AdaptiveStepper, type AdaptiveOptions } from './adaptive';
import { solveStep } from './index';
import type { ComponentModel, SimInput, Terminal, TransientState } from './index';

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

const empty: TransientState = { time: 0, stored: {} };

/** A stepper that counts its solves and records each dt. */
function counting(): { stepper: typeof solveStep; dts: number[] } {
  const dts: number[] = [];
  return { dts, stepper: (input, state, dt, options) => (dts.push(dt), solveStep(input, state, dt, options)) };
}

function engine(input: SimInput, options: Partial<AdaptiveOptions> = {}, guess = 1e-6): { e: AdaptiveStepper; dts: number[] } {
  const { stepper, dts } = counting();
  const e = new AdaptiveStepper(stepper, { ...ADAPTIVE_DEFAULTS, ...options }, empty, guess);
  e.setInput('a', input, 0);
  return { e, dts };
}

/** Samples a stored quantity at `times` (each reached with a step allowed to run ahead, then interpolated). */
function sample(e: AdaptiveStepper, times: number[], read: (s: TransientState) => number): number[] {
  return times.map((t) => {
    e.advance(t, { overshoot: true, budget: 1e6 });
    return read(e.stateAt(t));
  });
}

const grid = (until: number, n: number): number[] => Array.from({ length: n }, (_, k) => ((k + 1) * until) / n);

// Battery 5 V -> R -> C, RC = 1 ms.
const V = 5;
const rc = (ohms: number, farads: number): SimInput =>
  circuit(
    [{ kind: 'battery', volts: V, rInternal: 0 }, { kind: 'resistor', ohms }, { kind: 'capacitor', farads }, { kind: 'ground' }],
    [['1.pos', '2.a'], ['2.b', '3.a'], ['3.b', '1.neg'], ['1.neg', '4.gnd']],
  );

describe('error-controlled time steps', () => {
  it('RC charging stays within 1% of V (1 - e^(-t/RC)) in few steps', () => {
    const tau = 1e-3;
    const { e, dts } = engine(rc(1000, 1e-6));
    const times = grid(8 * tau, 160);
    const v = sample(e, times, (s) => s.stored[3].volts);
    times.forEach((t, k) => expect(Math.abs(v[k] - V * (1 - Math.exp(-t / tau)))).toBeLessThan(0.01 * V));
    // About a hundred solves for eight time constants (a fixed tau/50 step needs 400).
    expect(dts.length).toBeLessThan(150);
    // The steps grow as the curve flattens.
    expect(Math.max(...dts)).toBeGreaterThan(20 * Math.min(...dts.filter((d) => d > 1e-8)));
  });

  it('RL: the current rises as V/R (1 - e^(-tR/L)) within 1%', () => {
    const R = 100;
    const L = 10e-3;
    const tau = L / R;
    const input = circuit(
      [{ kind: 'battery', volts: V, rInternal: 0 }, { kind: 'resistor', ohms: R }, { kind: 'inductor', henries: L }, { kind: 'ground' }],
      [['1.pos', '2.a'], ['2.b', '3.a'], ['3.b', '1.neg'], ['1.neg', '4.gnd']],
    );
    const { e, dts } = engine(input);
    const times = grid(8 * tau, 160);
    const i = sample(e, times, (s) => s.stored[3].amps);
    const final = V / R;
    times.forEach((t, k) => expect(Math.abs(i[k] - final * (1 - Math.exp(-t / tau)))).toBeLessThan(0.01 * final));
    expect(dts.length).toBeLessThan(200);
  });

  // 5 V -> 20 ohm -> 10 mH -> 10 uF: w0 = 3162 rad/s, alpha = R/2L = 1000 /s, Q ~ 1.6.
  // Backward Euler damps ringing numerically (the decay rate gains about
  // wd^2 h / 2, the frequency loses about alpha h), so ringing needs a tighter
  // tolerance than the default to be right within a few %; with the default
  // (rtol 1e-3) it is about 3.5 % slow and decays about 11 % too fast.
  const rlc = (rtol: number): { halfPeriod: number; decay: number; wd: number; alpha: number } => {
    const R = 20;
    const L = 10e-3;
    const C = 10e-6;
    const input = circuit(
      [{ kind: 'battery', volts: V, rInternal: 0 }, { kind: 'resistor', ohms: R }, { kind: 'inductor', henries: L },
        { kind: 'capacitor', farads: C }, { kind: 'ground' }],
      [['1.pos', '2.a'], ['2.b', '3.a'], ['3.b', '4.a'], ['4.b', '1.neg'], ['1.neg', '5.gnd']],
    );
    const alpha = R / (2 * L);
    const wd = Math.sqrt(1 / (L * C) - alpha * alpha);
    const { e } = engine(input, { rtol });
    const times = grid(4e-3, 4000);
    const v = sample(e, times, (s) => s.stored[4].volts - V);
    // Zero crossings of v - V (interpolated): half periods of the ringing.
    const crossings: number[] = [];
    for (let k = 1; k < v.length; k++) {
      if (v[k - 1] === 0 || Math.sign(v[k - 1]) !== Math.sign(v[k])) {
        crossings.push(times[k - 1] + ((times[k] - times[k - 1]) * v[k - 1]) / (v[k - 1] - v[k]));
      }
    }
    expect(crossings.length).toBeGreaterThanOrEqual(3);
    const halfPeriod = (crossings[2] - crossings[0]) / 2;
    // Extremes between crossings: |peak| falls by e^(-alpha * half period) each half period.
    const peak = (a: number, b: number): number => Math.max(...v.filter((_, k) => times[k] > a && times[k] < b).map(Math.abs));
    const decay = Math.log(peak(crossings[0], crossings[1]) / peak(crossings[1], crossings[2])) / halfPeriod;
    return { halfPeriod, decay, wd, alpha };
  };

  it('RLC rings at the damped frequency and decays at R/2L within a few % (rtol 1e-4)', () => {
    const { halfPeriod, decay, wd, alpha } = rlc(1e-4);
    expect(Math.abs(halfPeriod * wd - Math.PI) / Math.PI).toBeLessThan(0.02);
    expect(Math.abs(decay - alpha) / alpha).toBeLessThan(0.05);
  });

  it('RLC with the default tolerance: frequency within 5 %, decay within 15 % (backward Euler damping)', () => {
    const { halfPeriod, decay, wd, alpha } = rlc(ADAPTIVE_DEFAULTS.rtol);
    expect(Math.abs(halfPeriod * wd - Math.PI) / Math.PI).toBeLessThan(0.05);
    expect(Math.abs(decay - alpha) / alpha).toBeLessThan(0.15);
  });

  it('a circuit that has settled takes steps up to the longest allowed', () => {
    const { e, dts } = engine(rc(1000, 1e-6));
    e.advance(1, { overshoot: false, budget: 1e6 });
    expect(dts.length).toBeLessThan(150);
    expect(e.h).toBe(ADAPTIVE_DEFAULTS.maxStep);
  });

  it('is deterministic: the same calls give the same step sequence and numbers', () => {
    const a = engine(rc(1000, 1e-6));
    const b = engine(rc(1000, 1e-6));
    const times = grid(5e-3, 37);
    const va = sample(a.e, times, (s) => s.stored[3].volts);
    const vb = sample(b.e, times, (s) => s.stored[3].volts);
    expect(vb).toEqual(va);
    expect(b.dts).toEqual(a.dts);
  });

  it('a new input is a discontinuity: steps end at it, the probe restarts the control with a short step', () => {
    const { e, dts } = engine(rc(1000, 1e-6));
    const t = 0.0123;
    e.advance(t, { overshoot: true, budget: 1e6 }); // settled at 5 V, a long step ahead
    expect(e.ahead).not.toBeNull();
    expect(e.ahead!.state.time).toBeGreaterThan(t);
    const n = dts.length;
    const discharge = rc(1000, 1e-6);
    discharge.components[0] = { id: 1, model: { kind: 'battery', volts: 0, rInternal: 0 } };
    e.setInput('b', discharge, t);
    expect(e.time).toBeCloseTo(t, 12); // the state was taken at the change
    expect(e.ahead).toBeNull();
    const times = grid(5e-3, 50).map((x) => t + x);
    const v = sample(e, times, (s) => s.stored[3].volts);
    times.forEach((x, k) => expect(Math.abs(v[k] - V * Math.exp(-(x - t) / 1e-3))).toBeLessThan(0.01 * V));
    // A probe, then a first step of at most about RC / 50.
    expect(dts[n]).toBeLessThan(1e-8);
    expect(dts[n + 1]).toBeLessThanOrEqual(1e-3 / 25);
  });

  it('the budget caps the solves and is reported', () => {
    const { e, dts } = engine(rc(1, 1e-9), {}, 1e-7); // RC = 1 ns: wants the floor for a while
    const run = e.advance(1e-3, { overshoot: false, budget: 5 });
    expect(run.capped).toBe(true);
    expect(run.solves).toBe(6); // 5, then one step to the end
    expect(dts.length).toBe(6);
    expect(e.time).toBeCloseTo(1e-3, 12);
  });

  it('retries an unconverged step from the same time with a shorter interval', () => {
    const input: SimInput = { components: [], links: [] };
    const until = 1e-3;
    const stepper: typeof solveStep = (circuit, state, dt) => {
      const out = solveStep(circuit, state, dt);
      out.result.converged = dt <= until / 2;
      return out;
    };
    const e = new AdaptiveStepper(stepper, ADAPTIVE_DEFAULTS, empty, until);
    e.setInput('a', input, 0);

    expect(e.advance(until, { overshoot: false, budget: 20 }).capped).toBe(false);
    const pieces = e.takePieces();
    expect(e.stats.rejected).toBeGreaterThan(0);
    expect(pieces[0].from).toBe(0);
    expect(pieces.every((piece) => piece.result.converged)).toBe(true);
    expect(e.time).toBeCloseTo(until, 12);
  });
});
