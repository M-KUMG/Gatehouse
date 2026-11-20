import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UNO_IO } from '../mcu/avr/uno';
import { withDrives } from '../mcu/mixedsignal';
import { decodeGth } from '../project/gth';
import { Project } from '../project/project';
import { fromFileMap } from '../project/storage';
import { Simulation, boardParts, buildNetlist } from '../simulation';
import { LOGIC_NMOS, RED_LED, initialState, solveStep } from './index';
import type { ComponentModel, SimInput, SimResult, Terminal, TransientState } from './index';

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

const rc = (): SimInput =>
  circuit(
    [battery(5), { kind: 'resistor', ohms: 1000 }, { kind: 'capacitor', farads: 1e-6 }, { kind: 'ground' }],
    [['1.pos', '2.a'], ['2.b', '3.a'], ['3.b', '1.neg'], ['1.neg', '4.gnd']],
  );

/** 9 V -> 330 ohm -> LED to ground, 100 uF across the LED (`extra`: a 10 k load across it too). */
const ledCap = (extra = false): SimInput =>
  circuit(
    [battery(9, 1.5), { kind: 'resistor', ohms: 330 }, RED_LED, { kind: 'capacitor', farads: 100e-6 }, { kind: 'ground' },
      ...(extra ? [{ kind: 'resistor', ohms: 10_000 } as ComponentModel] : [])],
    [['1.pos', '2.a'], ['2.b', '3.anode'], ['3.cathode', '1.neg'], ['2.b', '4.a'], ['4.b', '1.neg'], ['1.neg', '5.gnd'],
      ...(extra ? [['2.b', '6.a'], ['6.b', '1.neg']] as [string, string][] : [])],
  );

/** The BC557 model before step 7c (no leakage), as in convergence.test.ts. */
const IDEAL_PNP: ComponentModel = { kind: 'pnp', is: 6e-14, bf: 250, br: 5 };

/** The floating-base chain of convergence.test.ts: plain Newton never settles it. */
const floatingBases = (): SimInput =>
  circuit(
    [LOGIC_NMOS, { kind: 'capacitor', farads: 100e-6, esr: 0.01 }, IDEAL_PNP, IDEAL_PNP, battery(9, 1.5), { kind: 'ground' }],
    [
      ['5.neg', '6.gnd'], ['5.neg', '1.g'], ['1.d', '4.b'], ['1.s', '4.e'], ['4.c', '5.pos'],
      ['3.e', '6.gnd'], ['3.c', '4.e'], ['2.a', '5.pos'],
    ],
  );

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

const cold = (state: TransientState): TransientState => ({ time: state.time, stored: state.stored });

/** `steps` steps of `dt` from empty; `warm: false` drops the warm start before every step. */
function trajectory(input: SimInput, dt: number, steps: number, warm: boolean): { results: SimResult[]; states: TransientState[] } {
  let state = initialState(input, { charged: false });
  const results: SimResult[] = [];
  const states: TransientState[] = [];
  for (let k = 0; k < steps; k++) {
    const out = solveStep(input, warm ? state : cold(state), dt);
    results.push(out.result);
    states.push(out.state);
    state = out.state;
  }
  return { results, states };
}

/**
 * Same node voltages within `volts` and part currents within `amps`.
 * Where the convergence aids' relaxed test accepts the answer, a node held
 * only by GMIN and reverse-biased junctions (a floating base) is pinned by
 * currents of ~1e-12 A (CURRENT_TOL), so its voltage depends on the starting
 * point by up to a few mV while every current agrees to ~1e-12 A.
 */
function expectSameTrajectory(a: SimResult[], b: SimResult[], volts: number, amps: number): void {
  expect(a.length).toBe(b.length);
  a.forEach((r, k) => {
    expect(r.converged).toBe(true);
    expect(b[k].converged).toBe(true);
    r.voltages.forEach((v, n) => expect(Math.abs(v - b[k].voltages[n])).toBeLessThan(volts));
    for (const id in r.parts) expect(Math.abs(r.parts[id].current - b[k].parts[id].current)).toBeLessThan(amps);
  });
}

describe('warm start', () => {
  it('gives the cold-start RC charging curve', () => {
    const warm = trajectory(rc(), 20e-6, 200, true);
    const coldRun = trajectory(rc(), 20e-6, 200, false);
    expectSameTrajectory(warm.results, coldRun.results, 1e-9, 1e-12);
    expect(warm.states[199].warm).toBeDefined();
  });

  it('gives the cold-start curve for an LED with a capacitor, in fewer iterations', () => {
    const warm = trajectory(ledCap(), 100e-6, 300, true);
    const coldRun = trajectory(ledCap(), 100e-6, 300, false);
    expectSameTrajectory(warm.results, coldRun.results, 1e-5, 1e-7);
    const total = (rs: SimResult[]): number => rs.reduce((n, r) => n + r.iterations, 0);
    expect(total(warm.results)).toBeLessThan(total(coldRun.results));
  });

  for (const [d13, d12] of [['H', 'L'], ['L', 'H'], ['L', 'L'], ['Z', 'Z']]) {
    it(`matches the cold-start trajectory of the inverter fixture with d13=${d13}, d12=${d12}`, () => {
      const input = inverter(d13, d12);
      const warm = trajectory(input, 10e-6, 200, true);
      const coldRun = trajectory(input, 10e-6, 200, false);
      // Floating nodes (see expectSameTrajectory): mV in volts, but the currents agree to 1e-10 A.
      // Since step 7c the BJTs' collector-base leakage (20 GOhm) lets the cold start settle the
      // floating LED cathode by the plain test while the hinted warm path keeps the relaxed one:
      // they differ by up to 5.3 mV there (was 2.5 mV), so 1e-2 V.
      expectSameTrajectory(warm.results, coldRun.results, 1e-2, 1e-10);
      warm.states.forEach((s, k) => {
        for (const id in s.stored) expect(Math.abs(s.stored[id].volts - coldRun.states[k].stored[id].volts)).toBeLessThan(1e-6);
      });
      const iterations = warm.results.slice(1).reduce((n, r) => n + r.iterations, 0) / (warm.results.length - 1);
      expect(iterations).toBeLessThan(10);
    });
  }

  it('is ignored when the netlist changed shape (the solve starts from zero)', () => {
    const before = solveStep(ledCap(), initialState(ledCap(), { charged: false }), 100e-6).state;
    expect(before.warm).toBeDefined();
    // A resistor more: another shape, so the same answer as without any warm start.
    const edited = ledCap(true);
    expect(solveStep(edited, before, 100e-6)).toEqual(solveStep(edited, cold(before), 100e-6));
    // A warm start of the wrong length is ignored as well.
    const broken: TransientState = { ...before, warm: { ...before.warm!, x: before.warm!.x.slice(1) } };
    expect(solveStep(ledCap(), broken, 100e-6)).toEqual(solveStep(ledCap(), cold(before), 100e-6));
    // Same shape: it is used (other device voltages to start from give another Newton run).
    const elsewhere: TransientState = { ...before, warm: { ...before.warm!, devices: before.warm!.devices.map(() => 1.5) } };
    expect(solveStep(ledCap(), elsewhere, 100e-6)).not.toEqual(solveStep(ledCap(), cold(before), 100e-6));
  });

  it('is deterministic: two runs give identical results and states', () => {
    const input = inverter('H', 'L');
    const a = trajectory(input, 10e-6, 100, true);
    const b = trajectory(input, 10e-6, 100, true);
    expect(a).toEqual(b);
  });

  it('does not mutate the state passed in', () => {
    const state = solveStep(ledCap(), initialState(ledCap(), { charged: false }), 100e-6).state;
    const copy = structuredClone(state);
    solveStep(ledCap(), state, 100e-6);
    expect(state).toEqual(copy);
  });
});

describe('convergence aid hint', () => {
  it('is set after an aid was needed, then skips the failing plain attempt', () => {
    const input = floatingBases();
    const first = solveStep(input, initialState(input, { charged: false }), 10e-6);
    expect(first.result.method).toBe('gmin');
    expect(first.result.iterations).toBeGreaterThan(200); // 200 plain + the aid
    expect(first.state.warm?.aid).toBe('gmin');
    const second = solveStep(input, first.state, 10e-6);
    expect(second.result).toMatchObject({ converged: true, method: 'gmin' });
    expect(second.result.iterations).toBeLessThan(10);
    expect(second.state.warm?.aid).toBe('gmin');
    // Same answer as the full cold path.
    const coldSecond = solveStep(input, cold(first.state), 10e-6).result;
    expectSameTrajectory([second.result], [coldSecond], 5e-3, 1e-10);
  });

  it('is cleared once a solve converges by the plain test', () => {
    const start = solveStep(ledCap(), initialState(ledCap(), { charged: false }), 100e-6).state;
    expect(start.warm?.aid).toBeUndefined();
    const hinted: TransientState = { ...start, warm: { ...start.warm!, aid: 'source' } };
    const out = solveStep(ledCap(), hinted, 100e-6);
    expect(out.result).toMatchObject({ converged: true, method: 'newton' });
    expect(out.state.warm).toBeDefined();
    expect(out.state.warm!.aid).toBeUndefined();
  });

  it('falls back to the aids when the warm-started plain attempt fails, and sets the hint', () => {
    const input = floatingBases();
    const first = solveStep(input, initialState(input, { charged: false }), 10e-6).state;
    // No hint: plain Newton from the warm start cannot settle the floating bases (strict test) within its budget.
    const unhinted: TransientState = { ...first, warm: { ...first.warm!, aid: undefined } };
    const out = solveStep(input, unhinted, 10e-6);
    expect(out.result).toMatchObject({ converged: true, method: 'gmin' });
    expect(out.result.iterations).toBeGreaterThan(50); // the reduced plain budget, then gmin stepping
    expect(out.result.iterations).toBeLessThan(250);
    expect(out.state.warm?.aid).toBe('gmin');
  });
});
