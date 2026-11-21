// Idle skipping with the built-in Blink hex (no toolchain needed): the
// recordings with skipping must equal a full run in every observable detail,
// and the slice contract of run() stays as without skipping.
// Compiled Arduino sketches: idleskip.tools.test.ts.
import { describe, expect, it } from 'vitest';
import { parseIntelHex } from '../hex';
import { BLINK_HEX } from '../programs/blink';
import { expectSame, pinEvents, record, serialText } from './idleskip.testkit';
import { UNO_CLOCK_HZ, UnoEmulator } from './uno';

const blink = parseIntelHex(BLINK_HEX, 32 * 1024).bytes;

describe('idle skipping (built-in Blink)', () => {
  it("'spin' records exactly what a full run records over 5 s, skipping most cycles", () => {
    const full = record(blink, 'off', 5);
    const spin = record(blink, 'spin', 5);
    expectSame(spin, full);
    expect(full.skippedCycles).toBe(0);
    expect(spin.skippedCycles / spin.cycles).toBeGreaterThan(0.9);
    expect(serialText(full)).toContain('LED on');
    expect(pinEvents(full).length).toBeGreaterThan(5);
  }, 30_000); // the full 5 s run takes a few seconds; under the whole suite running in parallel the default 5 s limit flaked

  it("'sleep' skips nothing in a program without SLEEP and changes nothing", () => {
    const full = record(blink, 'off', 1);
    const sleep = record(blink, 'sleep', 1);
    expectSame(sleep, full);
    expect(sleep.skippedCycles).toBe(0);
  });

  it('keeps the slice contract: odd slice sizes end at the same instruction, overshoot under 5 cycles and carried', () => {
    const sizes = [1, 7, 777, 16_000, 50_000, 3, 123_457, 160_000];
    const slice = (i: number): number => sizes[i % sizes.length];
    const full = record(blink, 'off', 3, [], slice);
    const spin = record(blink, 'spin', 3, [], slice);
    expectSame(spin, full);
    let target = 0;
    spin.slices.forEach((s, i) => {
      target += slice(i);
      expect(s.end).toBeGreaterThanOrEqual(target);
      expect(s.end - target).toBeLessThan(5);
    });
    expect(spin.skippedCycles).toBeGreaterThan(0);
  });

  it('can be switched between modes while running, with the same outputs', () => {
    const full = record(blink, 'off', 2);
    const uno = new UnoEmulator(blink);
    const slices = [];
    for (let i = 0; uno.cycles < 2 * UNO_CLOCK_HZ; i++) {
      if (i % 300 === 0) uno.setIdleSkip(['spin', 'off', 'sleep'][(i / 300) % 3] as 'spin' | 'off' | 'sleep');
      slices.push(uno.run(UNO_CLOCK_HZ / 1000));
    }
    expect(slices).toEqual(full.slices);
    expect(uno.idleSkipStats.skippedCycles).toBeGreaterThan(0);
  });
});
