// Solver benchmark: Newton iterations and wall time of a few transient runs.
// Skipped in the normal `npm test`; run it with
//   GATEHOUSE_BENCH=1 npx vitest run src/sim/solver.bench.test.ts
// It prints one line per case (best of BENCH_REPEATS runs; iterations are
// deterministic, so they are the same every run).
// The second part runs the mixed-signal bridge (error-controlled steps) and
// prints solves per simulated second and wall time for one run.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UNO_ELECTRICAL, UNO_IO } from '../mcu/avr/uno';
import type { BoardEmulator, SliceResult } from '../mcu/board';
import { MixedSignal, withDrives, type BoardSlot } from '../mcu/mixedsignal';
import { decodeGth } from '../project/gth';
import { Project } from '../project/project';
import { fromFileMap } from '../project/storage';
import { Simulation, boardParts, buildNetlist } from '../simulation';
import { BC547, D1N4148, RED_LED, initialState, solveCircuit, solveStep } from './index';
import type { ComponentModel, SimInput, Terminal } from './index';

const BENCH_REPEATS = 3;

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

/** Runs `steps` transient steps from empty; returns total Newton iterations and steps. */
function transient(input: SimInput, dt: number, steps: number): { iterations: number; steps: number } {
  let state = initialState(input, { charged: false });
  let iterations = 0;
  for (let i = 0; i < steps; i++) {
    const { result, state: next } = solveStep(input, state, dt);
    expect(result.converged).toBe(true);
    iterations += result.iterations;
    state = next;
  }
  return { iterations, steps };
}

function measure(name: string, body: () => { iterations: number; steps: number }): void {
  let best = Infinity;
  let out = { iterations: 0, steps: 0 };
  for (let k = 0; k < BENCH_REPEATS; k++) {
    const t0 = performance.now();
    out = body();
    best = Math.min(best, performance.now() - t0);
  }
  console.log(
    `${name.padEnd(34)} steps ${String(out.steps).padStart(5)}  iterations ${String(out.iterations).padStart(7)}` +
    `  (${(out.iterations / out.steps).toFixed(2)}/step)  ${best.toFixed(1)} ms`,
  );
}

describe.skipIf(!process.env.GATEHOUSE_BENCH)('solver benchmark', () => {
  it('prints iterations and ms', () => {
    const states = [['H', 'L'], ['L', 'H'], ['L', 'L'], ['Z', 'Z']] as const;
    const inputs = states.map(([a, b]) => inverter(a, b));
    for (let s = 0; s < states.length; s++) {
      measure(`inverter d13=${states[s][0]} d12=${states[s][1]}`, () => transient(inputs[s], 10e-6, 200));
    }
    measure('inverter all four states', () => {
      let iterations = 0;
      for (const input of inputs) iterations += transient(input, 10e-6, 200).iterations;
      return { iterations, steps: 800 };
    });
    const rc = circuit(
      [{ kind: 'battery', volts: 5, rInternal: 0 }, { kind: 'resistor', ohms: 1000 }, { kind: 'capacitor', farads: 1e-6 }, { kind: 'ground' }],
      [['1.pos', '2.a'], ['2.b', '3.a'], ['3.b', '1.neg'], ['1.neg', '4.gnd']],
    );
    measure('RC 1k/1uF, 1000 x 20 us', () => transient(rc, 20e-6, 1000));
    const led = circuit(
      [{ kind: 'battery', volts: 9, rInternal: 1.5 }, { kind: 'resistor', ohms: 330 }, RED_LED, { kind: 'capacitor', farads: 100e-6 }, { kind: 'ground' }],
      [['1.pos', '2.a'], ['2.b', '3.anode'], ['3.cathode', '1.neg'], ['2.b', '4.a'], ['4.b', '1.neg'], ['1.neg', '5.gnd']],
    );
    measure('LED + 100uF, 1000 x 100 us', () => transient(led, 100e-6, 1000));
    // Non-reactive: the DC solve only.
    const bjt = circuit(
      [{ kind: 'battery', volts: 9, rInternal: 0 }, { kind: 'resistor', ohms: 10_000 }, { kind: 'resistor', ohms: 470 }, BC547, D1N4148, { kind: 'ground' }],
      [['1.pos', '2.a'], ['2.b', '4.b'], ['1.pos', '3.a'], ['3.b', '5.anode'], ['5.cathode', '4.c'], ['4.e', '1.neg'], ['1.neg', '6.gnd']],
    );
    measure('DC BJT + LED x 1000', () => {
      let iterations = 0;
      for (let i = 0; i < 1000; i++) iterations += solveCircuit(bjt).iterations;
      return { iterations, steps: 1000 };
    });
    measure('DC inverter (4 states) x 50', () => {
      let iterations = 0;
      for (let i = 0; i < 50; i++) for (const input of inputs) iterations += solveCircuit(input).iterations;
      return { iterations, steps: 200 };
    });
  }, 600_000);

  // The mixed-signal bridge's time stepping (src/mcu/mixedsignal.ts): time
  // steps (solves) per simulated second and wall time, for circuits that used
  // to hit the step floor or the per-slice cap.
  it('prints bridge steps per simulated second', () => {
    // Battery 5 V -> 10 mH -> 220 ohm -> red LED -> gnd, 100 kohm from the inductor's end to gnd.
    const rl = circuit(
      [{ kind: 'battery', volts: 5, rInternal: 0 }, { kind: 'inductor', henries: 10e-3 }, { kind: 'resistor', ohms: 220 }, RED_LED,
        { kind: 'resistor', ohms: 100_000 }, { kind: 'ground' }],
      [['1.pos', '2.a'], ['2.b', '3.a'], ['3.b', '4.anode'], ['4.cathode', '1.neg'], ['2.b', '5.a'], ['5.b', '1.neg'], ['1.neg', '6.gnd']],
    );
    bridge('L 10 mH + 220 R + LED + 100k, 0.2 s', 0.2, (ms) => ms.setCircuit(rl, []));
    const slowRc = circuit(
      [{ kind: 'battery', volts: 5, rInternal: 0 }, { kind: 'resistor', ohms: 1e6 }, { kind: 'capacitor', farads: 1e-6 }, { kind: 'ground' }],
      [['1.pos', '2.a'], ['2.b', '3.a'], ['3.b', '1.neg'], ['1.neg', '4.gnd']],
    );
    bridge('RC tau 1 s, 10 s', 10, (ms) => ms.setCircuit(slowRc, []));
    // The inverter fixture with d13/d12 swapping every 0.5 s.
    const fixture = inverterCircuit();
    const on = pins({ d13: 'H', d12: 'L' });
    const off = pins({ d13: 'L', d12: 'H' });
    const blink = (c: number): string => (Math.floor(c / 500_000) % 2 === 0 ? on : off);
    bridge('inverter fixture, 0.5 s blink, 2 s', 2, (ms) => ms.setCircuit(fixture.input, [stubSlot(fixture.partId, blink)]));
    // A stub board's d9 at 490 Hz, 50 %, into 1 kohm + 10 uF (tau ~10 ms).
    const lowPass = circuit(
      [{ kind: 'board', rails: { ...UNO_ELECTRICAL.rails }, io: {} }, { kind: 'resistor', ohms: 1000 }, { kind: 'capacitor', farads: 10e-6 }],
      [['1.d9', '2.a'], ['2.b', '3.a'], ['3.b', '1.gnd']],
    );
    const period = Math.round(1e6 / 490);
    const high = pins({ d9: 'H' });
    const low = pins({ d9: 'L' });
    const pwm = (c: number): string => (c % period < period / 2 ? high : low);
    bridge('PWM 490 Hz into RC 10 ms, 1 s', 1, (ms) => ms.setCircuit(lowPass, [stubSlot(1, pwm)]));
  }, 600_000);
});

/** Drive codes with the named Uno pins set, the rest inputs. */
function pins(set: Record<string, string>): string {
  return UNO_IO.map((p) => set[p.id] ?? 'Z').join('');
}

/** A board whose pins follow `pattern(cycle)` at 1 MHz (no program). */
class StubBoard implements BoardEmulator {
  readonly clockHz = 1_000_000;
  readonly io = UNO_IO;
  readonly electrical = UNO_ELECTRICAL;
  cycles = 0;
  constructor(private readonly pattern: (cycle: number) => string) {}
  drives(): string {
    return this.pattern(this.cycles);
  }
  run(cycles: number): SliceResult {
    const start = this.cycles;
    const result: SliceResult = { start, end: start + cycles, drives: this.drives(), events: [], serial: {} };
    let last = result.drives;
    for (let c = start + 1; c <= start + cycles; c++) {
      this.cycles = c;
      const now = this.drives();
      if (now !== last) result.events.push({ cycle: c, drives: (last = now) });
    }
    return result;
  }
  setInputs(): void {}
  serialBaud(): number | null {
    return null;
  }
  sendSerial(): void {}
}

function stubSlot(partId: number, pattern: (cycle: number) => string): BoardSlot {
  return { partId, io: UNO_IO, electrical: UNO_ELECTRICAL, emulator: new StubBoard(pattern), running: true };
}

/** The inverter fixture's netlist (pins left to the bridge) and its board's part id. */
function inverterCircuit(): { input: SimInput; partId: number } {
  const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/inverter.gth', import.meta.url))));
  const project = new Project();
  project.load(fromFileMap(decodeGth(bytes).fileMap));
  const sim = new Simulation(project.scene);
  sim.update();
  const slots = sim.boards.sync(boardParts(project.scene));
  return { input: buildNetlist(project.scene).input, partId: slots[0].partId };
}

/** Runs a fresh bridge for `seconds` of simulated time; prints solves per simulated second and wall ms. */
function bridge(name: string, seconds: number, setup: (ms: MixedSignal) => void): void {
  let solves = 0;
  const ms = new MixedSignal(undefined, (input, state, dt, options) => {
    solves++;
    return solveStep(input, state, dt, options);
  });
  setup(ms);
  const t0 = performance.now();
  ms.advance(seconds);
  const wall = performance.now() - t0;
  expect(ms.result?.converged).toBe(true);
  const capped = (ms as unknown as { capped?: number }).capped;
  console.log(
    `${name.padEnd(40)} solves ${String(solves).padStart(7)}  per sim s ${String(Math.round(solves / seconds)).padStart(7)}` +
    `  ${wall.toFixed(0).padStart(6)} ms  (${(wall / seconds).toFixed(1)} ms per sim s)${capped !== undefined ? `  capped slices ${capped}` : ''}`,
  );
}
