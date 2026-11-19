import { describe, expect, it } from 'vitest';
import { GENERIC_IGBT, GENERIC_PIGBT, RED_LED, initialState, solveCircuit, solveStep } from './index';
import type { ComponentModel, SimInput, SimResult, Terminal } from './index';
import { solveWith } from './solve';

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
const ground: ComponentModel = { kind: 'ground' };

function solved(input: SimInput): SimResult {
  const r = solveCircuit(input);
  expect(r.converged).toBe(true);
  for (const v of r.voltages) expect(Number.isFinite(v)).toBe(true);
  return r;
}

/** Ideal sources: Vge on the gate, Vce on the collector, emitter grounded. Returns the IGBT (part 3) result. */
function curve(model: ComponentModel, vge: number, vce: number) {
  return solved(circuit(
    [battery(vge), battery(vce), model, ground],
    [['1.neg', '4.gnd'], ['2.neg', '4.gnd'], ['1.pos', '3.g'], ['2.pos', '3.c'], ['3.e', '4.gnd']],
  )).parts[3];
}

/** Vce at which the collector current reaches `amps` (bisection on the curve). */
function vceAt(model: ComponentModel, vge: number, amps: number): number {
  let lo = 0;
  let hi = 20;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (curve(model, vge, mid).current > amps) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

describe('IGBT model (MOSFET + PNP equivalent, generic 600 V / 20 A TO-247)', () => {
  // The calibration, documented in devices.ts (GENERIC_IGBT).
  it('Vge 5 V conducts only weakly; 10 V and 15 V saturate with a 1.5..2.3 V drop at 20 A', () => {
    const at2V = (vge: number) => curve(GENERIC_IGBT, vge, 2).current;
    expect(curve(GENERIC_IGBT, 4.4, 10).current).toBeLessThan(1e-3); // below Vge(th)
    expect(at2V(5)).toBeGreaterThan(0.3);
    expect(at2V(5)).toBeLessThan(0.8);
    expect(curve(GENERIC_IGBT, 5, 10).current).toBeLessThan(0.8); // saturates: no switch for real loads
    expect(at2V(10)).toBeGreaterThan(14);
    expect(at2V(10)).toBeLessThan(20);
    expect(at2V(15)).toBeGreaterThan(22);
    expect(at2V(15)).toBeLessThan(30);
    const vsat15 = vceAt(GENERIC_IGBT, 15, 20);
    expect(vsat15).toBeGreaterThan(1.6);
    expect(vsat15).toBeLessThan(1.8);
    const vsat10 = vceAt(GENERIC_IGBT, 10, 20);
    expect(vsat10).toBeGreaterThan(2.0);
    expect(vsat10).toBeLessThan(2.4);
    expect(vsat10).toBeGreaterThan(vsat15);
  });

  it('keeps Kirchhoff: collector + gate current leaves at the emitter; the gate draws ~nothing', () => {
    const r = curve(GENERIC_IGBT, 15, 2);
    expect(r.pins.c + r.pins.g + r.pins.e).toBeCloseTo(0, 12);
    expect(Math.abs(r.pins.g)).toBeLessThan(1e-7);
    expect(r.voltage).toBeCloseTo(2, 9);
    expect(r.volts?.g).toBeCloseTo(15, 9);
    expect(r.power).toBeCloseTo(2 * r.current, 6);
  });

  it('leaks only a little when off (about 0.12 mA at 600 V)', () => {
    const r = curve(GENERIC_IGBT, 0, 600);
    expect(r.current).toBeGreaterThan(0);
    expect(r.current).toBeLessThan(2e-4);
  });

  it('the P-channel part is the exact complement (every sign reversed)', () => {
    for (const [vge, vce] of [[5, 2], [10, 2], [15, 1.5], [0, 9]]) {
      const n = curve(GENERIC_IGBT, vge, vce);
      const p = curve(GENERIC_PIGBT, -vge, -vce);
      expect(p.current).toBeCloseTo(-n.current, 6);
    }
  });

  /** 9 V (1.5 ohm) -> 220 ohm -> LED -> collector; gate on `gate` volts; emitter to ground. */
  const lowSide = (gate: number): SimInput => circuit(
    [battery(9, 1.5), { kind: 'resistor', ohms: 220 }, RED_LED, GENERIC_IGBT, battery(gate), ground, { kind: 'resistor', ohms: 10_000 }],
    [
      ['1.neg', '6.gnd'], ['1.pos', '2.a'], ['2.b', '3.anode'], ['3.cathode', '4.c'], ['4.e', '6.gnd'],
      ['5.neg', '6.gnd'], ['5.pos', '4.g'], ['4.g', '7.a'], ['7.b', '6.gnd'],
    ],
  );

  it('switches a low-side LED load: on with 9 V on the gate, off with 0 V', () => {
    const on = solved(lowSide(9));
    expect(on.parts[3].current).toBeGreaterThan(0.025);
    expect(on.parts[4].voltage).toBeLessThan(1); // saturated
    const off = solved(lowSide(0));
    expect(Math.abs(off.parts[3].current)).toBeLessThan(1e-5);
    expect(off.parts[4].voltage).toBeGreaterThan(5);
  });

  it('converges through on/off transient steps with warm starts, and through the convergence aids', () => {
    // Switch the gate every 5 steps; the netlist keeps its shape, so every step is warm-started.
    let state = initialState(lowSide(0), { charged: false });
    for (let i = 0; i < 40; i++) {
      const input = lowSide(Math.floor(i / 5) % 2 === 0 ? 9 : 0);
      const { result, state: next } = solveStep(input, state, 1e-5);
      expect(result.converged).toBe(true);
      expect(next.warm).toBeDefined();
      const led = result.parts[3].current;
      if (Math.floor(i / 5) % 2 === 0) expect(led).toBeGreaterThan(0.025);
      else expect(Math.abs(led)).toBeLessThan(1e-5);
      state = next;
    }
    // A warm start from the other switch state converges as well.
    const fromOn = solveWith(lowSide(9), undefined, 0).warm!;
    const off = solveWith(lowSide(0), undefined, 0, fromOn);
    expect(off.result.converged).toBe(true);
    expect(Math.abs(off.result.parts[3].current)).toBeLessThan(1e-5);
  });

  it('a hard case (gate straight on a stiff 15 V, collector on 600 V through 30 ohm) still converges', () => {
    const r = solved(circuit(
      [battery(600, 0), { kind: 'resistor', ohms: 30 }, GENERIC_IGBT, battery(15), ground],
      [['1.neg', '5.gnd'], ['1.pos', '2.a'], ['2.b', '3.c'], ['3.e', '5.gnd'], ['4.neg', '5.gnd'], ['4.pos', '3.g']],
    ));
    expect(r.parts[3].current).toBeGreaterThan(19);
    expect(r.parts[3].current).toBeLessThan(20);
  });
});
