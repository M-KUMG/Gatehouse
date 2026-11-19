import { describe, expect, it } from 'vitest';
import { signalOf } from './decoders';
import { HIGH, HI_Z, LOW, type Level } from './recorder';
import {
  MAX_SPAN, MIN_SPAN, firstEndingAfter, fitAll, followLatest, formatFrequency, formatTime, panBy, planTrace, tickStep, ticks,
  timeToX, xToTime, zoomAt, type DrawableTrace,
} from './timeaxis';

function trace(times: number[], levels: Level[], end: number): DrawableTrace {
  const s = signalOf(times, levels, end);
  return { length: times.length, time: s.time, level: (i) => levels[i], indexAt: s.indexAt, end };
}

describe('time axis', () => {
  it('maps time to pixels and back', () => {
    const view = { start: 1, span: 2 };
    expect(timeToX(view, 200, 2)).toBe(100);
    expect(xToTime(view, 200, 50)).toBe(1.5);
  });

  it('zooms around the pointer, within the span limits, never before 0', () => {
    const view = { start: 1, span: 2 };
    const z = zoomAt(view, 200, 50, 2);
    expect(z.span).toBe(1);
    expect(xToTime(z, 200, 50)).toBeCloseTo(1.5, 12); // the time under the pointer stays
    expect(zoomAt(view, 200, 0, 1e12).span).toBe(MIN_SPAN);
    expect(zoomAt(view, 200, 0, 1e-12).span).toBe(MAX_SPAN);
    expect(zoomAt({ start: 0.1, span: 1 }, 100, 50, 0.1).start).toBe(0);
  });

  it('pans by pixels, follows the latest time and fits everything', () => {
    expect(panBy({ start: 1, span: 2 }, 200, 100)).toEqual({ start: 0, span: 2 });
    expect(panBy({ start: 1, span: 2 }, 200, -100)).toEqual({ start: 2, span: 2 });
    expect(panBy({ start: 1, span: 2 }, 200, 500).start).toBe(0);
    expect(followLatest({ start: 0, span: 0.01 }, 1)).toEqual({ start: 0.99, span: 0.01 });
    expect(followLatest({ start: 5, span: 0.01 }, 0.001).start).toBe(0);
    expect(fitAll(2.5)).toEqual({ start: 0, span: 2.5 });
    expect(fitAll(0).span).toBeGreaterThan(0);
  });

  it('picks 1-2-5 tick steps at least the minimum spacing apart', () => {
    expect(tickStep(1, 1000, 80)).toBe(0.1);
    expect(tickStep(1e-3, 800, 80)).toBeCloseTo(1e-4, 15);
    expect(tickStep(3e-6, 1000, 80)).toBeCloseTo(5e-7, 18);
    const t = ticks({ start: 0.05, span: 0.3 }, 0.1);
    expect(t.map((x) => Number(x.toFixed(9)))).toEqual([0.1, 0.2, 0.3]);
  });

  it('formats times and frequencies with fitting units', () => {
    expect(formatTime(0)).toBe('0');
    expect(formatTime(1.5)).toBe('1.5 s');
    expect(formatTime(0.0015)).toBe('1.5 ms');
    expect(formatTime(104.2e-6)).toBe('104.2 µs');
    expect(formatTime(62.5e-9)).toBe('62.5 ns');
    expect(formatTime(0.0002, 0.0001)).toBe('200 µs');
    expect(formatTime(0.25, 0.05)).toBe('250 ms');
    expect(formatTime(2, 0.5)).toBe('2 s');
    expect(formatFrequency(9600)).toBe('9.6 kHz');
    expect(formatFrequency(16e6)).toBe('16 MHz');
    expect(formatFrequency(50)).toBe('50 Hz');
    expect(formatFrequency(Infinity)).toBe('–');
  });
});

describe('planTrace', () => {
  it('draws sparse edges as levels and single transitions', () => {
    const t = trace([0, 0.25, 0.5], [LOW, HIGH, HI_Z], 1);
    const runs = planTrace(t, { start: 0, span: 1 }, 100);
    expect(runs).toEqual([
      { kind: 'level', x0: 0, x1: 25, level: LOW },
      { kind: 'edge', x: 25, from: LOW, to: HIGH },
      { kind: 'level', x0: 26, x1: 50, level: HIGH },
      { kind: 'edge', x: 50, from: HIGH, to: HI_Z },
      { kind: 'level', x0: 51, x1: 100, level: HI_Z },
    ]);
  });

  it('stops at the end of the data (or the held time) and leaves out time before the first edge', () => {
    const t = trace([0.2], [HIGH], 0.6);
    expect(planTrace(t, { start: 0, span: 1 }, 10)).toEqual([{ kind: 'level', x0: 2, x1: 6, level: HIGH }]);
    expect(planTrace(t, { start: 0, span: 1 }, 10, 0.4)).toEqual([{ kind: 'level', x0: 2, x1: 4, level: HIGH }]);
    expect(planTrace(trace([], [], 0), { start: 0, span: 1 }, 10)).toEqual([]);
  });

  it('merges columns with many edges into bands and stays bounded for a million edges', () => {
    const n = 1_000_000;
    const times = Array.from({ length: n }, (_, i) => i * 1e-6);
    const levels = times.map((_, i) => (i % 2 === 0 ? HIGH : LOW) as Level);
    const t = trace(times, levels, 1);
    let calls = 0;
    const counted: DrawableTrace = { ...t, length: t.length, end: t.end, indexAt: (s) => (calls++, t.indexAt(s)) };
    const runs = planTrace(counted, { start: 0, span: 1 }, 500);
    expect(runs).toEqual([{ kind: 'band', x0: 0, x1: 500 }]);
    expect(calls).toBeLessThanOrEqual(501);
    // Zoomed in far enough, the same trace is single edges again.
    const zoomed = planTrace(t, { start: 0.5, span: 10e-6 }, 100);
    expect(zoomed.some((r) => r.kind === 'band')).toBe(false);
    expect(zoomed.filter((r) => r.kind === 'edge')).toHaveLength(10);
  });

  it('finds the first item ending after a time', () => {
    const items = [{ end: 1 }, { end: 2 }, { end: 3 }];
    expect(firstEndingAfter(items, 0)).toBe(0);
    expect(firstEndingAfter(items, 2)).toBe(2);
    expect(firstEndingAfter(items, 5)).toBe(3);
  });
});
