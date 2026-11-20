import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UNO_IO } from '../mcu/avr/uno';
import { withDrives } from '../mcu/mixedsignal';
import { decodeGth } from '../project/gth';
import { Project } from '../project/project';
import { fromFileMap } from '../project/storage';
import { Simulation, boardParts, buildNetlist } from '../simulation';
import { BC547, D1N4148, LOGIC_NMOS, initialState, solveCircuit, solveStep } from './index';
import type { ComponentModel, SimInput, SimResult, Terminal } from './index';

/** Plain Newton + gmin stepping + source stepping budgets (solve.ts). */
const WORST_CASE_ITERATIONS = 700;

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

/** The BC557 model before step 7c: plain Ebers-Moll, no series resistances, Early effect or leakage. */
const IDEAL_PNP: ComponentModel = { kind: 'pnp', is: 6e-14, bf: 250, br: 5 };

/** Converged with finite node voltages within [-1, 10] V and a finite battery current. */
function expectSane(r: SimResult): void {
  expect(r.converged).toBe(true);
  expect(r.iterations).toBeLessThanOrEqual(WORST_CASE_ITERATIONS);
  for (const v of r.voltages) {
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(-1);
    expect(v).toBeLessThanOrEqual(10);
  }
  const battery = Object.values(r.parts).find((p) => p.pins.pos !== undefined);
  expect(battery).toBeDefined();
  expect(Number.isFinite(battery!.current)).toBe(true);
}

/**
 * Two stacked PNPs with floating bases (the upper one's base on an off
 * MOSFET's drain) across a 9 V battery, plus a 100 uF capacitor hanging
 * off the + rail (open in DC, but its 10 mOhm ESR puts 100 S into the
 * matrix). The bases are held by ~1e-12 S only; their voltages jitter by
 * ~1e-5 V from rounding, so plain Newton never settles. The PNPs are the
 * ideal pre-7c BC557 (no collector-base leakage: the real part's 20 GOhm
 * holds the bases well enough for plain Newton, see IDEAL_PNP).
 */
function floatingBases(): SimInput {
  return circuit(
    [LOGIC_NMOS, { kind: 'capacitor', farads: 100e-6, esr: 0.01 }, IDEAL_PNP, IDEAL_PNP, battery(9, 1.5), { kind: 'ground' }],
    [
      ['5.neg', '6.gnd'], ['5.neg', '1.g'], ['1.d', '4.b'], ['1.s', '4.e'], ['4.c', '5.pos'],
      ['3.e', '6.gnd'], ['3.c', '4.e'], ['2.a', '5.pos'],
    ],
  );
}

describe('convergence aids', () => {
  it('solve a floating-base chain that plain Newton cannot settle', () => {
    const r = solveCircuit(floatingBases());
    expect(r.method).toBe('gmin'); // plain Newton failed first
    expectSane(r);
    // Everything is off: only leakage flows, the upper base sits near the + rail.
    expect(Math.abs(r.parts[5].current)).toBeLessThan(1e-6);
    expect(r.voltages[r.nets['4:b']]).toBeGreaterThan(8);
    expect(r.voltages[r.nets['4:b']]).toBeLessThan(9.01);
    expect(Math.abs(r.parts[1].current)).toBeLessThan(1e-6);
  });

  it('carry the transient through the same circuit step after step', () => {
    const input = floatingBases();
    let state = initialState(input, { charged: false });
    for (let i = 0; i < 20; i++) {
      const { result, state: next } = solveStep(input, state, 10e-6);
      expectSane(result);
      expect(next.time).toBeCloseTo((i + 1) * 10e-6, 12);
      state = next;
    }
    // The capacitor charges through nothing but leakage: it stays (almost) empty.
    expect(Math.abs(state.stored[2].volts)).toBeLessThan(1e-3);
  });

  it('leave circuits plain Newton solves alone', () => {
    const r = solveCircuit(circuit(
      [battery(9), { kind: 'resistor', ohms: 10_000 }, { kind: 'resistor', ohms: 470 }, BC547, D1N4148, { kind: 'ground' }],
      [['1.pos', '2.a'], ['2.b', '4.b'], ['1.pos', '3.a'], ['3.b', '5.anode'], ['5.cathode', '4.c'], ['4.e', '1.neg'], ['1.neg', '6.gnd']],
    ));
    expect(r).toMatchObject({ converged: true, method: 'newton' });
    expect(r.iterations).toBeLessThan(50);
  });

  it('still report failure (zeros) for an impossible nonlinear circuit, within the budget', () => {
    const r = solveCircuit(circuit(
      [battery(1.5, 0), D1N4148, battery(5, 1)],
      [['1.pos', '1.neg'], ['3.pos', '2.anode'], ['2.cathode', '3.neg']],
    ));
    expect(r.converged).toBe(false);
    expect(r.method).toBe('source');
    expect(r.iterations).toBeLessThanOrEqual(WORST_CASE_ITERATIONS);
    for (const v of r.voltages) expect(v).toBe(0);
    expect(r.parts[2].current).toBe(0);
  });
});

/** The owner's half-bridge project with the Uno's d13 / d12 driven as given (every other pin an input). */
function inverter(d13: string, d12: string): SimInput {
  const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/inverter.gth', import.meta.url))));
  const project = new Project();
  project.load(fromFileMap(decodeGth(bytes).fileMap));
  const sim = new Simulation(project.scene);
  sim.update();
  const slots = sim.boards.sync(boardParts(project.scene));
  const { input } = buildNetlist(project.scene);
  const drive = UNO_IO.map((p) => (p.id === 'd13' ? d13 : p.id === 'd12' ? d12 : 'Z')).join('');
  return withDrives(input, slots, slots.map(() => drive), 0);
}

describe('inverter fixture (half-bridge of MOSFET + PNP pairs, Uno, 9 V battery)', () => {
  for (const [d13, d12] of [['H', 'L'], ['L', 'H'], ['L', 'L'], ['Z', 'Z']]) {
    it(`converges with d13=${d13}, d12=${d12} in DC and for 200 steps of 10 us`, () => {
      const input = inverter(d13, d12);
      expectSane(solveCircuit(input));
      let state = initialState(input, { charged: false });
      for (let i = 0; i < 200; i++) {
        const { result, state: next } = solveStep(input, state, 10e-6);
        expectSane(result);
        state = next;
      }
    });
  }
});
