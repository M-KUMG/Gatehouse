// Shared by the idle-skip tests: run a program with one idle-skip mode and
// record everything observable (every slice's pin events and serial bytes,
// the final data space, PC, cycle count and timer state), so two modes can
// be compared exactly.
import { expect } from 'vitest';
import type { BoardInputs, IdleSkipMode, SliceResult } from '../board';
import { UNO_CLOCK_HZ, UNO_IO, UnoEmulator } from './uno';

/** Something done to the board before slice `at` runs. */
export interface Step {
  at: number;
  /** Pin levels by id (unlisted pins read low). */
  inputs?: Record<string, boolean>;
  /** Bytes sent to the serial port. */
  serial?: string;
}

export interface Recording {
  slices: SliceResult[];
  data: number[];
  pc: number;
  cycles: number;
  timers: number[][];
  resets: number;
  skippedCycles: number;
  hostMs: number;
}

export function pinInputs(levels: Record<string, boolean>): BoardInputs {
  return { digital: UNO_IO.map((p) => levels[p.id] ?? false), analog: UNO_IO.map(() => 0) };
}

interface ChipInternals {
  cpu: { data: Uint8Array; pc: number };
  parts: { timers: { tcnt: number; lastCycle: number; countingUp: boolean; ocrA: number; ocrB: number }[] };
}

/** Run `seconds` of simulated time in slices of `slice(i)` cycles (default 1 ms). */
export function record(
  flash: Uint8Array,
  mode: IdleSkipMode,
  seconds: number,
  steps: readonly Step[] = [],
  slice: (i: number) => number = () => UNO_CLOCK_HZ / 1000,
): Recording {
  const uno = new UnoEmulator(flash, { idleSkip: mode });
  const slices: SliceResult[] = [];
  const end = seconds * UNO_CLOCK_HZ;
  const t0 = performance.now();
  for (let i = 0; uno.cycles < end; i++) {
    for (const s of steps) {
      if (s.at !== i) continue;
      if (s.inputs) uno.setInputs(pinInputs(s.inputs));
      if (s.serial) uno.sendSerial('usart0', [...s.serial].map((c) => c.charCodeAt(0)));
    }
    slices.push(uno.run(slice(i)));
  }
  const hostMs = performance.now() - t0;
  const chip = (uno as unknown as { chip: ChipInternals }).chip;
  return {
    slices,
    data: Array.from(chip.cpu.data),
    pc: chip.cpu.pc,
    cycles: uno.cycles,
    timers: chip.parts.timers.map((t) => [t.tcnt, t.lastCycle, t.countingUp ? 1 : 0, t.ocrA, t.ocrB]),
    resets: uno.watchdogResets,
    skippedCycles: uno.idleSkipStats.skippedCycles,
    hostMs,
  };
}

/** Serial bytes of a recording as text. */
export function serialText(r: Recording): string {
  return r.slices.map((s) => String.fromCharCode(...(s.serial.usart0 ?? []))).join('');
}

/** Pin events of a recording (cycle and drive codes), all slices. */
export function pinEvents(r: Recording): string[] {
  return r.slices.flatMap((s) => s.events.map((e) => `${e.cycle} ${e.drives}`));
}

/** Everything observable must match: each slice, the final data space, PC, cycles and timers. */
export function expectSame(skip: Recording, full: Recording): void {
  expect(skip.slices.length).toBe(full.slices.length);
  for (let i = 0; i < full.slices.length; i++) {
    if (JSON.stringify(skip.slices[i]) !== JSON.stringify(full.slices[i])) {
      expect(skip.slices[i], `slice ${i}`).toEqual(full.slices[i]);
    }
  }
  expect(skip.cycles).toBe(full.cycles);
  expect(skip.pc).toBe(full.pc);
  expect(skip.timers).toEqual(full.timers);
  expect(skip.resets).toBe(full.resets);
  const differ = skip.data.flatMap((v, i) => (v === full.data[i] ? [] : [`0x${i.toString(16)}: ${v} vs ${full.data[i]}`]));
  expect(differ, 'data bytes that differ (skip vs full)').toEqual([]);
}
