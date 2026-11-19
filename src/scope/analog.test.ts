import { describe, expect, it } from 'vitest';
import { MixedSignal } from '../mcu/mixedsignal';
import type { SimInput, SimResult } from '../sim';
import { inspect, quantityValues } from '../sim/inspect';
import { AnalogRecorder, autoRange, columns, valueAt, type AnalogTrace } from './analog';

const PART = 3;

/** A result in which part PART has `value` as its voltage. */
function result(value: number, converged = true): SimResult {
  return {
    time: 0, converged, iterations: 1, reference: 'ground', connectedNets: 0, nets: {}, voltages: [0],
    parts: { [PART]: { voltage: value, current: value / 10, power: 0, pins: {} } },
  };
}

const read = (r: SimResult): Map<string, number> => new Map([['v', r.parts[PART].voltage], ['i', r.parts[PART].current]]);

function samples(trace: AnalogTrace | undefined): [number, number][] {
  if (!trace) return [];
  return Array.from({ length: trace.length }, (_, i) => [trace.time(i), trace.value(i)]);
}

describe('AnalogRecorder', () => {
  it('records only armed parts and quantities; nothing armed is inactive and cheap', () => {
    const rec = new AnalogRecorder(100, 0);
    expect(rec.active).toBe(false);
    let reads = 0;
    rec.sample(0, result(1));
    expect(rec.trace(PART, 'v')).toBeUndefined();
    rec.arm(PART, ['v'], (r) => {
      reads++;
      return read(r);
    });
    expect(rec.active).toBe(true);
    rec.sample(0.001, result(2));
    rec.sample(0.002, result(3));
    expect(samples(rec.trace(PART, 'v'))).toEqual([[0.001, 2], [0.002, 3]]);
    expect(rec.trace(PART, 'i')).toBeUndefined(); // not armed
    expect(reads).toBe(2); // one read per sample for the part
    rec.disarm(PART);
    expect(rec.active).toBe(false);
    rec.sample(0.003, result(4));
    expect(rec.trace(PART, 'v')!.length).toBe(2); // kept, not growing
    expect(rec.latest).toBe(0.002);
  });

  it('skips parts missing from the result and failed solves', () => {
    const rec = new AnalogRecorder(100, 0);
    rec.arm(99, ['v'], read);
    rec.sample(0, result(1));
    expect(rec.trace(99, 'v')!.length).toBe(0);
    rec.arm(PART, ['v'], read);
    rec.sample(0, result(1, false));
    expect(rec.trace(PART, 'v')!.length).toBe(0);
  });

  it('is bounded: the oldest samples are dropped and counted', () => {
    const rec = new AnalogRecorder(1000, 0);
    rec.arm(PART, ['v'], read);
    for (let k = 0; k < 2500; k++) rec.sample(k * 1e-3, result(k));
    const t = rec.trace(PART, 'v')!;
    expect(t.length).toBe(1000);
    expect(t.dropped).toBe(1500);
    expect(t.value(0)).toBe(1500);
    expect(t.value(999)).toBe(2499);
    expect(t.indexAt(1.7)).toBe(200);
  });

  it('decimates by the minimum interval, always keeping the newest value', () => {
    const rec = new AnalogRecorder(100, 1e-3);
    rec.arm(PART, ['v'], read);
    // 0.1 ms apart: only about every 1 ms is kept, the last one replaced.
    for (let k = 0; k <= 30; k++) rec.sample(k * 1e-4, result(k));
    const s = samples(rec.trace(PART, 'v'));
    for (let i = 2; i < s.length; i++) expect(s[i][0] - s[i - 2][0]).toBeGreaterThanOrEqual(1e-3 - 1e-12);
    expect(s.length).toBeLessThan(10);
    expect(s[s.length - 1]).toEqual([30 * 1e-4, 30]);
  });

  it('static time: the same value is not repeated, a change at the same time is an edge', () => {
    const rec = new AnalogRecorder(100, 0);
    rec.arm(PART, ['v'], read);
    const v0 = rec.version;
    for (let k = 0; k < 10; k++) rec.sample(0, result(5));
    expect(samples(rec.trace(PART, 'v'))).toEqual([[0, 5]]);
    expect(rec.version).toBe(v0 + 1);
    rec.sample(0, result(7)); // a switch flipped while paused
    expect(samples(rec.trace(PART, 'v'))).toEqual([[0, 5], [0, 7]]);
  });

  it('clear drops everything but keeps the arming; time going back restarts a series', () => {
    const rec = new AnalogRecorder(100, 0);
    rec.arm(PART, ['v', 'i'], read);
    rec.sample(1, result(1));
    rec.clear();
    expect(rec.trace(PART, 'v')).toBeUndefined();
    expect(rec.latest).toBe(0);
    expect(rec.isArmed(PART, 'i')).toBe(true);
    rec.sample(2, result(2));
    rec.sample(0.5, result(3));
    expect(samples(rec.trace(PART, 'i'))).toEqual([[0.5, 0.3]]);
  });

  it('bounds the number of series (least recently armed go first)', () => {
    const rec = new AnalogRecorder(10, 0, 4);
    for (let p = 1; p <= 3; p++) rec.arm(p, ['v', 'i'], read);
    expect(rec.trace(1, 'v')).toBeUndefined();
    expect(rec.trace(3, 'v')).toBeDefined();
  });
});

describe('analog drawing plan', () => {
  const trace = (points: [number, number][]): AnalogTrace => ({
    length: points.length,
    time: (i) => points[i][0],
    value: (i) => points[i][1],
    indexAt: (t) => points.filter(([pt]) => pt <= t).length - 1,
    dropped: 0,
  });

  it('summarises samples per pixel column with entry, exit, min and max', () => {
    const t = trace([[0, 9], [1, 1], [1.2, 5], [1.4, 3], [5, 4], [11, 0]]);
    const cols = columns(t, { start: 1, span: 9 }, 9);
    expect(cols).toEqual([
      { x: 0, first: 1, last: 3, min: 1, max: 5 },
      { x: 4, first: 4, last: 4, min: 4, max: 4 },
    ]);
    // The sample before the view enters from the left edge (column -1).
    const shifted = columns(t, { start: 2, span: 8 }, 8);
    expect(shifted[0]).toEqual({ x: -1, first: 3, last: 3, min: 3, max: 3 });
    expect(columns(t, { start: 0, span: 10 }, 10, 1.3).map((c) => c.x)).toEqual([0, 1]);
  });

  it('auto-scales to the columns in view and pads a flat line', () => {
    const r = autoRange([{ x: 0, first: 1, last: 3, min: 1, max: 5 }])!;
    expect(r.min).toBeLessThan(1);
    expect(r.max).toBeGreaterThan(5);
    const flat = autoRange([{ x: 2, first: 2, last: 2, min: 2, max: 2 }])!;
    expect(flat.min).toBeLessThan(2);
    expect(flat.max).toBeGreaterThan(2);
    expect(autoRange([])).toBeNull();
    expect(valueAt(trace([[1, 4], [2, 6]]), 1.5)).toBe(4);
    expect(valueAt(trace([[1, 4]]), 0.5)).toBeNaN();
  });
});

describe('feeding from the bridge', () => {
  // 5 V -> 1 k -> 1 uF -> ground: an RC charging curve with tau = 1 ms.
  const RC: SimInput = {
    components: [
      { id: 1, model: { kind: 'battery', volts: 5, rInternal: 0 } },
      { id: 2, model: { kind: 'resistor', ohms: 1000 } },
      { id: PART, model: { kind: 'capacitor', farads: 1e-6 } },
      { id: 4, model: { kind: 'ground' } },
    ],
    links: [
      [{ part: 1, pin: 'pos' }, { part: 2, pin: 'a' }],
      [{ part: 2, pin: 'b' }, { part: PART, pin: 'a' }],
      [{ part: PART, pin: 'b' }, { part: 1, pin: 'neg' }],
      [{ part: 1, pin: 'neg' }, { part: 4, pin: 'gnd' }],
    ],
  };
  const capRead = (r: SimResult) => quantityValues(inspect({ kind: 'capacitor', farads: 1e-6 }, r, { id: PART }));

  function run(armed: boolean): { rec: AnalogRecorder; bridge: MixedSignal } {
    const bridge = new MixedSignal();
    const rec = new AnalogRecorder();
    bridge.stepObserver = rec;
    if (armed) rec.arm(PART, ['v', 'q'], capRead);
    bridge.setCircuit(RC, []);
    bridge.advance(0.005);
    return { rec, bridge };
  }

  it('samples the accepted steps of a charging capacitor in simulated time', () => {
    const { rec, bridge } = run(true);
    const s = samples(rec.trace(PART, 'v'));
    expect(s.length).toBeGreaterThan(10);
    for (let i = 1; i < s.length; i++) expect(s[i][0]).toBeGreaterThanOrEqual(s[i - 1][0]);
    expect(s[s.length - 1][0]).toBeCloseTo(0.005, 9);
    // Backward Euler at the default tolerance: within a few percent of 5 (1 - e^-t/tau).
    const at1ms = valueAt(rec.trace(PART, 'v')!, 0.001);
    expect(at1ms).toBeGreaterThan(5 * (1 - Math.exp(-1)) * 0.93);
    expect(at1ms).toBeLessThan(5 * (1 - Math.exp(-1)) * 1.07);
    const q = rec.trace(PART, 'q')!;
    expect(q.value(q.length - 1)).toBeCloseTo(1e-6 * s[s.length - 1][1], 9);
    expect(bridge.time).toBeCloseTo(0.005, 12);
  });

  it('recording does not change the simulation, and is deterministic', () => {
    const a = run(true);
    const b = run(false);
    const c = run(true);
    expect(a.bridge.result).toEqual(b.bridge.result);
    expect(samples(a.rec.trace(PART, 'v'))).toEqual(samples(c.rec.trace(PART, 'v')));
    expect(b.rec.trace(PART, 'v')).toBeUndefined();
  });
});
