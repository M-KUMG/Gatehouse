// The function generator ('siggen', model 'signal') and the programmable
// power supply ('psu'): waveforms, the source inside the solver (DC at a
// given time, time steps), the step limit, the part and its saved settings.

import { describe, expect, it } from 'vitest';
import { freqLabel, siggenSvg } from './art/siggen';
import { isReactive, stepSeconds } from './mcu/timestep';
import { DEFAULT_SIGGEN, getPart, siggenSettings } from './parts';
import { stringifyProject } from './project/format';
import { Project } from './project/project';
import { readProject } from './project/read';
import { initialState, solveCircuit, solveStep, type SimInput } from './sim';
import { inspect } from './sim/inspect';
import { signalMaxStep, signalVolts, type SignalModel } from './sim/signal';

const model = (over: Partial<SignalModel> = {}): SignalModel => ({
  kind: 'signal', wave: 'sine', freq: 10, amp: 5, offset: 0, duty: 0.5, rOut: 50, ...over,
});

/** generator -> R -> C -> back, the capacitor voltage is the output. */
function lowPass(m: SignalModel, ohms = 1000, farads = 1e-6): SimInput {
  return {
    components: [
      { id: 1, model: m },
      { id: 2, model: { kind: 'resistor', ohms } },
      { id: 3, model: { kind: 'capacitor', farads } },
      { id: 4, model: { kind: 'ground' } },
    ],
    links: [
      [{ part: 1, pin: 'pos' }, { part: 2, pin: 'a' }],
      [{ part: 2, pin: 'b' }, { part: 3, pin: 'a' }],
      [{ part: 3, pin: 'b' }, { part: 1, pin: 'neg' }],
      [{ part: 1, pin: 'neg' }, { part: 4, pin: 'gnd' }],
    ],
  };
}

describe('waveforms', () => {
  it('sine: offset + amp sin(2 pi f t)', () => {
    const m = model({ wave: 'sine', freq: 10, amp: 3, offset: 1 });
    expect(signalVolts(m, 0)).toBeCloseTo(1, 12);
    expect(signalVolts(m, 0.025)).toBeCloseTo(4, 12);
    expect(signalVolts(m, 0.075)).toBeCloseTo(-2, 12);
  });
  it('square: high for the duty part of the period, low after', () => {
    const m = model({ wave: 'square', freq: 1, amp: 2.5, offset: 2.5, duty: 0.25 });
    expect(signalVolts(m, 0.1)).toBeCloseTo(5, 12);
    expect(signalVolts(m, 0.3)).toBeCloseTo(0, 12);
    expect(signalVolts(m, 1.1)).toBeCloseTo(5, 12);
  });
  it('triangle and sawtooth span -amp..+amp', () => {
    const tri = model({ wave: 'triangle', freq: 1, amp: 2, offset: 0 });
    expect(signalVolts(tri, 0)).toBeCloseTo(-2, 12);
    expect(signalVolts(tri, 0.25)).toBeCloseTo(0, 12);
    expect(signalVolts(tri, 0.5)).toBeCloseTo(2, 12);
    expect(signalVolts(tri, 0.75)).toBeCloseTo(0, 12);
    const saw = model({ wave: 'sawtooth', freq: 1, amp: 2, offset: 0 });
    expect(signalVolts(saw, 0)).toBeCloseTo(-2, 12);
    expect(signalVolts(saw, 0.5)).toBeCloseTo(0, 12);
    expect(signalVolts(saw, 0.999)).toBeCloseTo(1.996, 3);
  });
  it('is deterministic and negative times keep working', () => {
    const m = model({ wave: 'sine' });
    expect(signalVolts(m, 0.0123)).toBe(signalVolts(m, 0.0123));
    expect(Number.isFinite(signalVolts(m, -0.01))).toBe(true);
  });
});

describe('in the solver', () => {
  it('DC solve uses input.time (the value of the wave then, behind rOut)', () => {
    const input = { ...lowPass(model({ wave: 'square', freq: 1, amp: 2.5, offset: 2.5, duty: 0.5 })), time: 0.25 };
    const r = solveCircuit(input);
    expect(r.converged).toBe(true);
    // Capacitor open in DC: the whole 5 V is across it (no current).
    expect(r.parts[3].voltage).toBeCloseTo(5, 3);
    const low = solveCircuit({ ...input, time: 0.75 });
    expect(low.parts[3].voltage).toBeCloseTo(0, 3);
  });
  it('a sine into an RC low-pass passes almost unchanged far below the corner (time steps)', () => {
    const input = lowPass(model({ wave: 'sine', freq: 10, amp: 5, offset: 0 }));
    let state = initialState(input);
    let peak = 0;
    for (let i = 0; i < 20_000; i++) {
      const s = solveStep(input, state, 1e-5); // 0.2 s = 2 periods
      state = s.state;
      if (s.result.time > 0.1) peak = Math.max(peak, Math.abs(s.result.parts[3].voltage));
    }
    // |H| = 1 / sqrt(1 + (2 pi f R C)^2) = 0.998 at 10 Hz, 1 kohm, 1 uF; 50 ohm of rOut adds about 5 %.
    expect(peak).toBeGreaterThan(4.7);
    expect(peak).toBeLessThan(5.01);
  });
  it('is repeatable: the same steps give identical numbers', () => {
    const run = (): number[] => {
      const input = lowPass(model({ wave: 'triangle', freq: 50 }));
      let state = initialState(input, { charged: false });
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        const s = solveStep(input, state, 1e-4);
        state = s.state;
        out.push(s.result.parts[3].voltage);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe('time stepping limits', () => {
  it('a generator makes the circuit time-stepped even without capacitors', () => {
    expect(isReactive({ components: [{ id: 1, model: model() }], links: [] })).toBe(true);
  });
  it('steps stay a hundredth of the period for edges and a fiftieth for smooth waves', () => {
    const sq = { components: [{ id: 1, model: model({ wave: 'square', freq: 100 }) }], links: [] };
    expect(signalMaxStep(sq)).toBeCloseTo(1 / (100 * 100), 12);
    const sine = { components: [{ id: 1, model: model({ wave: 'sine', freq: 100 }) }], links: [] };
    expect(signalMaxStep(sine)).toBeCloseTo(1 / (100 * 50), 12);
    expect(signalMaxStep({ components: [], links: [] })).toBe(Infinity);
    expect(stepSeconds(sq, [], 1e-3)).toBeCloseTo(1e-4, 12);
  });
});

describe('function generator part', () => {
  const type = getPart('siggen')!;
  it('has + and - pins on the grid and defaults to a 1 Hz square wave between 0 and 5 V', () => {
    expect(type.pins.map((p) => p.id)).toEqual(['pos', 'neg']);
    for (const p of type.pins) expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
    expect(DEFAULT_SIGGEN).toMatchObject({ freq: 1, wave: 'square', amp: 2.5, offset: 2.5, duty: 0.5 });
    expect(type.sim!({})).toMatchObject({ kind: 'signal', wave: 'square', freq: 1, amp: 2.5, offset: 2.5, rOut: 50 });
  });
  it('reads its settings from the state, with defaults for anything wrong', () => {
    expect(siggenSettings({ value: 440, wave: 'sine', amp: 1, offset: 0, duty: 0.5 })).toEqual({ freq: 440, wave: 'sine', amp: 1, offset: 0, duty: 0.5 });
    expect(siggenSettings({ wave: 'nope' as never }).wave).toBe('square');
    expect(siggenSettings({ value: NaN }).freq).toBe(1);
  });
  it('shows the waveform and frequency on its display', () => {
    expect(freqLabel(1)).toBe('1 Hz');
    expect(freqLabel(2500)).toBe('2.5 kHz');
    expect(siggenSvg('sine', 440)).toContain('440 Hz');
    expect(type.variant?.({ value: 440, wave: 'sine' })?.svg).toContain('440 Hz');
    expect(type.variant?.({})).toBeNull();
  });
  it('shows frequency, amplitude and offset in the inspector', () => {
    const input: SimInput = { ...lowPass(model({ wave: 'square', freq: 1, amp: 2.5, offset: 2.5 })), time: 0.25 };
    const res = solveCircuit(input);
    const q = new Map(inspect(model({ wave: 'square', freq: 1, amp: 2.5, offset: 2.5 }), res, { id: 1, type: 'siggen' }).map((x) => [x.id, x]));
    expect(q.get('f')?.value).toBe(1);
    expect(q.get('amp')?.value).toBe(2.5);
    expect(q.get('off')?.value).toBe(2.5);
  });
  it('saves and loads its settings; bad settings are refused', () => {
    const p = new Project();
    p.scene.add({ typeId: 'siggen', col: 0, row: 0, rotation: 0, state: { value: 440, wave: 'triangle', amp: 3, offset: -1, duty: 0.3 } });
    const first = p.serialize();
    const b = new Project();
    b.load(readProject(stringifyProject(first)));
    expect(b.serialize()).toEqual(first);
    expect(b.scene.parts[0].state).toEqual({ value: 440, wave: 'triangle', amp: 3, offset: -1, duty: 0.3 });
    const bad = (state: object, typeId = 'siggen') => {
      const doc = JSON.parse(stringifyProject(first));
      doc.parts[0].state = state;
      doc.parts[0].typeId = typeId;
      return () => readProject(JSON.stringify(doc));
    };
    expect(bad({ wave: 'noise' })).toThrow(/wave/);
    expect(bad({ amp: 500 })).toThrow(/amp/);
    expect(bad({ duty: 1.5 })).toThrow(/duty/);
    expect(bad({ value: 0 })).toThrow(/value/);
    expect(bad({ amp: 1 }, 'resistor')).toThrow(/amp/);
    expect(bad({ wave: 'sine', value: 1000 })).not.toThrow();
  });
});
