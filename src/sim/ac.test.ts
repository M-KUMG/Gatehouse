// The AC and mains parts: the AC source, the incandescent and LED bulbs and the transformer (acsource.ts, bulb.ts,
// transformer.ts), run through the real transient solver.

import { describe, expect, it } from 'vitest';
import { initialState, solveStep } from './index';
import type { ComponentModel, SimInput, SimResult, Terminal } from './index';
import { OUTLET } from './acsource';
import { transformerParams } from './transformer';

function circuit(models: ComponentModel[], wires: [string, string][]): SimInput {
  const terminal = (s: string): Terminal => {
    const [part, pin] = s.split('.');
    return { part: Number(part), pin };
  };
  return { components: models.map((model, i) => ({ id: i + 1, model })), links: wires.map(([a, b]) => [terminal(a), terminal(b)]) };
}

const outlet: ComponentModel = { kind: 'acsource', vrms: OUTLET.vrms, freq: OUTLET.freq, limit: OUTLET.limit };

/** Steps `seconds` at `dt`; returns every result. */
function run(input: SimInput, dt: number, seconds: number): SimResult[] {
  let state = initialState(input);
  const results: SimResult[] = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const out = solveStep(input, state, dt);
    results.push(out.result);
    state = out.state;
  }
  return results;
}

const rms = (xs: number[]): number => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length);
const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
const lastCycles = (rs: SimResult[], cycles: number, dt: number, hz = 50): SimResult[] => rs.slice(-Math.round(cycles / hz / dt));

describe('AC source', () => {
  it('delivers a sine of the set RMS voltage and frequency into a resistor', () => {
    const rs = run(circuit([{ kind: 'acsource', vrms: 12, freq: 50, limit: 5 }, { kind: 'resistor', ohms: 6 }], [['1.pos', '2.a'], ['1.neg', '2.b']]), 1e-4, 0.1);
    const tail = lastCycles(rs, 2, 1e-4);
    expect(rms(tail.map((r) => r.parts[2].voltage))).toBeCloseTo(12, 0);
    expect(Math.max(...tail.map((r) => r.parts[2].voltage))).toBeCloseTo(12 * Math.SQRT2, 0);
    expect(rms(tail.map((r) => r.parts[2].current))).toBeCloseTo(2, 1);
    expect(rs[0].parts[1].volts?.['ac.freq']).toBe(50);
  });

  it('floats: no ground part is needed', () => {
    const rs = run(circuit([outlet, { kind: 'resistor', ohms: 1000 }], [['1.pos', '2.a'], ['1.neg', '2.b']]), 2e-4, 0.04);
    expect(rs.every((r) => r.converged)).toBe(true);
  });

  it('limits its current (the limit is RMS, the peak is sqrt 2 times that)', () => {
    const rs = run(circuit([{ kind: 'acsource', vrms: 230, freq: 50, limit: 1 }, { kind: 'resistor', ohms: 1 }], [['1.pos', '2.a'], ['1.neg', '2.b']]), 1e-4, 0.06);
    const peak = Math.max(...rs.map((r) => Math.abs(r.parts[2].current)));
    expect(peak).toBeLessThan(Math.SQRT2 * 1.02);
    expect(peak).toBeGreaterThan(Math.SQRT2 * 0.9);
  });
});

describe('incandescent bulb', () => {
  const bulb = (watts = 60): ComponentModel => ({ kind: 'bulb', volts: 230, watts });
  const wired = (watts?: number): SimInput => circuit([outlet, bulb(watts)], [['1.pos', '2.a'], ['1.neg', '2.b']]);

  it('settles at its rated power and temperature, with a switch-on surge several times its running current', () => {
    const dt = 2e-4;
    const rs = run(wired(), dt, 0.6);
    const cycles = lastCycles(rs, 3, dt);
    expect(mean(cycles.map((r) => r.parts[2].power))).toBeGreaterThan(57);
    expect(mean(cycles.map((r) => r.parts[2].power))).toBeLessThan(63);
    const temp = cycles[0].parts[2].volts?.['filament.temp'] ?? 0;
    expect(temp).toBeGreaterThan(2600);
    expect(temp).toBeLessThan(2800);
    expect(cycles[0].parts[2].volts?.light).toBeGreaterThan(0.9);
    const peakNow = Math.max(...cycles.map((r) => Math.abs(r.parts[2].current)));
    const peakFirst = Math.max(...rs.slice(0, 100).map((r) => Math.abs(r.parts[2].current)));
    expect(peakFirst).toBeGreaterThan(4 * peakNow); // switched on at a zero crossing: less than the textbook 10-15 x at the peak
  });

  it('is dim and orange on a low voltage', () => {
    const rs = run(circuit([{ kind: 'acsource', vrms: 60, freq: 50, limit: 5 }, bulb()], [['1.pos', '2.a'], ['1.neg', '2.b']]), 2e-4, 0.8);
    const light = rs[rs.length - 1].parts[2].volts?.light ?? 1;
    expect(light).toBeLessThan(0.15);
  });

  it('burns on a gross over-voltage', () => {
    const rs = run(circuit([{ kind: 'acsource', vrms: 500, freq: 50, limit: 10 }, bulb()], [['1.pos', '2.a'], ['1.neg', '2.b']]), 2e-4, 0.8);
    expect(rs[rs.length - 1].parts[2].volts?.['filament.temp']).toBeGreaterThan(3300);
  });
});

describe('LED bulb', () => {
  it('dissipates its rated power on the rated mains, and the light follows the average', () => {
    const dt = 2e-4;
    const rs = run(circuit([outlet, { kind: 'ledbulb', volts: 230, watts: 9 }], [['1.pos', '2.a'], ['1.neg', '2.b']]), dt, 0.3);
    const cycles = lastCycles(rs, 3, dt);
    expect(mean(cycles.map((r) => r.parts[2].power))).toBeGreaterThan(8.4);
    expect(mean(cycles.map((r) => r.parts[2].power))).toBeLessThan(9.6);
    expect(cycles[0].parts[2].volts?.light).toBeGreaterThan(0.9);
    expect(cycles[0].parts[2].volts?.light).toBeLessThan(1.1);
  });

  it('draws current only near the mains peaks and nothing below its threshold', () => {
    const rs = run(circuit([outlet, { kind: 'ledbulb', volts: 230, watts: 9 }], [['1.pos', '2.a'], ['1.neg', '2.b']]), 2e-4, 0.1);
    const tail = rs.slice(-100);
    const near0 = tail.filter((r) => Math.abs(r.parts[2].voltage) < 20);
    expect(near0.length).toBeGreaterThan(0);
    expect(Math.max(...near0.map((r) => Math.abs(r.parts[2].current)))).toBeLessThan(1e-3);
  });

  it('is dimmer on a lower voltage', () => {
    const rs = run(circuit([{ kind: 'acsource', vrms: 150, freq: 50, limit: 5 }, { kind: 'ledbulb', volts: 230, watts: 9 }], [['1.pos', '2.a'], ['1.neg', '2.b']]), 2e-4, 0.3);
    expect(rs[rs.length - 1].parts[2].volts?.light).toBeLessThan(0.6);
  });
});

describe('transformer', () => {
  const xfmr: ComponentModel = { kind: 'transformer', primaryVolts: 230, secondaryVolts: 12, va: 50 };
  const wired = (load: number | null): SimInput => circuit(
    [outlet, xfmr, ...(load === null ? [] : [{ kind: 'resistor', ohms: load } as ComponentModel])],
    [['1.pos', '2.p1'], ['1.neg', '2.p2'], ...(load === null ? [] : [['2.s1', '3.a'], ['2.s2', '3.b']] as [string, string][])],
  );

  it('steps 230 V down to about 12 V with nothing connected, drawing only a small magnetizing current', () => {
    const dt = 2e-4;
    const rs = run(wired(null), dt, 0.2);
    const tail = lastCycles(rs, 3, dt);
    const secondary = rms(tail.map((r) => r.parts[2].volts?.sec ?? 0));
    expect(secondary).toBeGreaterThan(11.8);
    expect(secondary).toBeLessThan(12.8);
    const ip = rms(tail.map((r) => r.parts[2].pins.p1 ?? 0));
    expect(ip).toBeGreaterThan(0.005);
    expect(ip).toBeLessThan(0.05);
  });

  it('delivers its power into a load with a few percent of voltage drop, and the currents follow the turns ratio', () => {
    const dt = 2e-4;
    const rs = run(wired(3), dt, 0.3);
    const tail = lastCycles(rs, 3, dt);
    const vs = rms(tail.map((r) => r.parts[3].voltage));
    const is = rms(tail.map((r) => r.parts[3].current));
    expect(vs).toBeGreaterThan(10.8);
    expect(vs).toBeLessThan(12.1);
    expect(is).toBeCloseTo(vs / 3, 1);
    const n = transformerParams(xfmr as Extract<ComponentModel, { kind: 'transformer' }>).n;
    const ip = rms(tail.map((r) => r.parts[2].pins.p1 ?? 0));
    expect(ip * n).toBeGreaterThan(is * 0.9);
    expect(ip * n).toBeLessThan(is * 1.15);
  });

  it('galvanically separates: the secondary floats from the primary', () => {
    const rs = run(wired(10), 2e-4, 0.05);
    expect(rs.every((r) => r.converged)).toBe(true);
  });

  it('draws a huge current on DC (only its copper resistance limits it)', () => {
    const input = circuit([{ kind: 'battery', volts: 12, rInternal: 0.01 }, xfmr], [['1.pos', '2.p1'], ['1.neg', '2.p2']]);
    const rs = run(input, 1e-3, 0.05);
    const last = rs[rs.length - 1];
    expect(Math.abs(last.parts[2].pins.p1 ?? 0)).toBeGreaterThan(0.15);
  });
});
