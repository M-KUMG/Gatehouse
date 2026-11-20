// The DC motor (sim/motor.ts, part 'motor'): spin-up with the mechanical time
// constant, back-EMF, stall and no-load currents, reversal, results under the
// motor's own pins, determinism, the part.

import { describe, expect, it } from 'vitest';
import { getPart } from './parts';
import { initialState, solveCircuit, solveStep, type SimInput, type TransientState } from './sim';
import { inspect } from './sim/inspect';
import { MOTOR_DEFAULT, decideMotor, motorMaxStep } from './sim/motor';

const MOTOR = 2;
const m = MOTOR_DEFAULT;

/** A supply of `volts` across the motor. */
function circuit(volts: number): SimInput {
  const t = (part: number, pin: string) => ({ part, pin });
  return {
    components: [
      { id: 1, model: { kind: 'battery', volts, rInternal: 0.05 } },
      { id: MOTOR, model: MOTOR_DEFAULT },
      { id: 3, model: { kind: 'ground' } },
    ],
    links: [[t(1, 'pos'), t(MOTOR, 'pos')], [t(1, 'neg'), t(MOTOR, 'neg')], [t(1, 'neg'), t(3, 'gnd')]],
  };
}

function run(input: SimInput, state: TransientState, seconds: number, dt = 1e-3): { state: TransientState; omega: number; amps: number; rpm: number } {
  let s = state;
  let last = solveStep(input, s, dt);
  for (let t = 0; t < seconds; t += dt) {
    last = solveStep(input, s, dt);
    s = last.state;
  }
  const volts = last.result.parts[MOTOR].volts!;
  return { state: s, omega: volts['mech.omega'], amps: last.result.parts[MOTOR].current, rpm: volts['mech.rpm'] };
}

describe('motor model', () => {
  it('has toy-motor constants: 3 ohm, 8000 rpm at 6 V, about 65 ms mechanical time constant', () => {
    const noLoad = (6 - 0.1 * m.ohms) / m.ke; // rad/s at 0.1 A
    expect((noLoad * 60) / (2 * Math.PI)).toBeGreaterThan(7000);
    expect((noLoad * 60) / (2 * Math.PI)).toBeLessThan(9000);
    const tau = (m.inertia * m.ohms) / (m.ke * m.ke);
    expect(tau).toBeGreaterThan(0.04);
    expect(tau).toBeLessThan(0.09);
    expect(motorMaxStep(circuit(6))).toBeCloseTo(tau / 20, 9);
  });
  it('speeds up from torque, slows from friction, and stays put without a step', () => {
    expect(decideMotor({ omega: 0 }, 1, 0, m).omega).toBe(0);
    expect(decideMotor({ omega: 0 }, 1, 1e-3, m).omega).toBeGreaterThan(0);
    expect(decideMotor({ omega: 500 }, 0, 1e-2, m).omega).toBeLessThan(500);
    expect(decideMotor({ omega: 0 }, -1, 1e-3, m).omega).toBeLessThan(0);
  });
});

describe('motor in a circuit', () => {
  it('draws the stall current V / R in DC (the rotor stands still)', () => {
    const r = solveCircuit(circuit(6));
    expect(r.converged).toBe(true);
    expect(r.parts[MOTOR].current).toBeCloseTo(6 / (3 + 0.05), 1);
    expect(r.parts[MOTOR].volts?.['mech.omega']).toBe(0);
  });
  it('spins up to about 8000 rpm with 0.1 A and no load, in about 3 time constants', () => {
    const input = circuit(6);
    const start = initialState(input, { charged: false });
    const early = run(input, start, 0.02);
    expect(early.rpm).toBeGreaterThan(500);
    expect(early.rpm).toBeLessThan(6000);
    expect(early.amps).toBeGreaterThan(0.5); // still near stall
    const done = run(input, start, 0.6);
    expect(done.rpm).toBeGreaterThan(7000);
    expect(done.rpm).toBeLessThan(9000);
    expect(done.amps).toBeGreaterThan(0.05);
    expect(done.amps).toBeLessThan(0.25);
  });
  it('turns the other way round with reversed voltage and generates when driven by its own speed', () => {
    const fwd = run(circuit(6), initialState(circuit(6), { charged: false }), 0.4);
    const rev = run(circuit(-6), initialState(circuit(-6), { charged: false }), 0.4);
    expect(rev.rpm).toBeCloseTo(-fwd.rpm, -1);
    // Switch the supply off: the shaft coasts down while the back-EMF pushes current back (negative current).
    const coast = solveStep(circuit(0), fwd.state, 1e-3).result.parts[MOTOR];
    expect(coast.current).toBeLessThan(0);
    expect(coast.volts?.['mech.omega']).toBeLessThan(fwd.omega);
  });
  it('reports under its own pin names and leaves no helper parts', () => {
    const input = circuit(6);
    const out = run(input, initialState(input, { charged: false }), 0.1);
    const r = solveStep(input, out.state, 1e-3).result;
    const p = r.parts[MOTOR];
    expect(Object.keys(p.pins).sort()).toEqual(['neg', 'pos']);
    expect(p.pins.pos + p.pins.neg).toBeCloseTo(0, 9);
    expect(p.voltage).toBeCloseTo(6, 1);
    expect(Object.keys(r.parts).every((id) => Number(id) >= 0)).toBe(true);
    expect(r.nets[`${MOTOR}:pos`]).toBeDefined();
    expect(r.nets[`${MOTOR}:neg`]).toBeDefined();
  });
  it('is repeatable', () => {
    const go = (): number[] => {
      const input = circuit(6);
      let s = initialState(input, { charged: false });
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        const step = solveStep(input, s, 1e-3);
        s = step.state;
        out.push(step.result.parts[MOTOR].current);
      }
      return out;
    };
    expect(go()).toEqual(go());
  });
});

describe('motor part', () => {
  const type = getPart('motor')!;
  it('has + and - pins on the grid, burns above 10 A and shows speed in the inspector', () => {
    expect(type.pins.map((p) => p.id)).toEqual(['pos', 'neg']);
    for (const p of type.pins) expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
    expect(type.sim!({}).kind).toBe('motor');
    expect(type.sim!({ burned: true })).toEqual({ kind: 'open' });
    expect(type.warnAbove).toBe(1.5);
    expect(type.burnAbove).toBe(10);
    const input = circuit(6);
    const state = run(input, initialState(input, { charged: false }), 0.5).state;
    const res = solveStep(input, state, 1e-3).result;
    const q = new Map(inspect(MOTOR_DEFAULT, res, { id: MOTOR, type: 'motor' }).map((x) => [x.id, x]));
    expect(q.get('rpm')?.value).toBeGreaterThan(7000);
    expect(q.get('state')?.text).toBe('turning forward');
  });
});
