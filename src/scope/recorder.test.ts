import { describe, expect, it } from 'vitest';
import { RED_LED, type SimInput } from '../sim';
import { UNO_CLOCK_HZ, UNO_ELECTRICAL, UNO_IO, UnoEmulator } from '../mcu/avr/uno';
import type { BoardEmulator, SliceResult } from '../mcu/board';
import { parseIntelHex } from '../mcu/hex';
import { MixedSignal, type BoardSlot } from '../mcu/mixedsignal';
import { BLINK_HEX } from '../mcu/programs/blink';
import { HIGH, HI_Z, LOW, PULL_UP, SignalRecorder, levelOf } from './recorder';

const BOARD = 7;
const IO = [{ id: 'a', analog: false }, { id: 'b', analog: false }];

/** Just enough of an emulator to stand for one (identity and clock). */
function fakeEmulator(clockHz = 1000): BoardEmulator {
  return { clockHz } as BoardEmulator;
}

function slice(start: number, end: number, drives: string, events: [number, string][] = []): SliceResult {
  return { start, end, drives, events: events.map(([cycle, d]) => ({ cycle, drives: d })), serial: {} };
}

function edges(rec: SignalRecorder, pin: string): [number, number][] {
  const t = rec.trace(BOARD, pin)!;
  return Array.from({ length: t.length }, (_, i) => [t.cycle(i), t.level(i)]);
}

describe('SignalRecorder', () => {
  it('maps the drive codes to levels', () => {
    expect(['H', 'L', 'Z', 'P'].map(levelOf)).toEqual([HIGH, LOW, HI_Z, PULL_UP]);
  });

  it('records only armed channels, as cycle-exact edges with times from the board clock', () => {
    const rec = new SignalRecorder();
    const emu = fakeEmulator(1000);
    const board = { partId: BOARD, io: IO, emulator: emu };
    rec.slice(board, slice(0, 100, 'ZZ', [[10, 'HZ']]));
    expect(rec.trace(BOARD, 'a')).toBeUndefined();
    const before = rec.version;
    rec.arm(BOARD, 'a');
    rec.slice(board, slice(100, 200, 'HZ', [[120, 'LZ'], [130, 'LH'], [150, 'PL'], [160, 'PZ']]));
    rec.slice(board, slice(200, 300, 'PZ', [[250, 'ZZ']]));
    expect(rec.version).toBeGreaterThan(before);
    // First entry: the level when recording started; then changes of pin a only (b's changes and repeats are skipped).
    expect(edges(rec, 'a')).toEqual([[100, HIGH], [120, LOW], [150, PULL_UP], [250, HI_Z]]);
    const t = rec.trace(BOARD, 'a')!;
    expect(t.clockHz).toBe(1000);
    expect(t.time(1)).toBe(0.12);
    expect(t.end).toBe(0.3);
    expect(t.start).toBe(0.1);
    expect(t.indexAt(0.05)).toBe(-1);
    expect(t.indexAt(0.12)).toBe(1);
    expect(t.indexAt(0.149)).toBe(1);
    expect(t.indexAt(10)).toBe(3);
    expect(rec.isArmed(BOARD, 'b')).toBe(false);
    expect(rec.latest).toBe(0.3);
  });

  it('is bounded: drops the oldest edges and counts them', () => {
    const rec = new SignalRecorder(5);
    const board = { partId: BOARD, io: IO, emulator: fakeEmulator() };
    rec.arm(BOARD, 'a');
    const events: [number, string][] = Array.from({ length: 11 }, (_, i) => [i + 1, i % 2 === 0 ? 'HZ' : 'LZ']);
    rec.slice(board, slice(0, 20, 'LZ', events)); // 12 edges
    const t = rec.trace(BOARD, 'a')!;
    expect(t.length).toBe(5);
    expect(t.dropped).toBe(7);
    expect(edges(rec, 'a').map(([c]) => c)).toEqual([7, 8, 9, 10, 11]);
    expect(t.indexAt(0.0075)).toBe(0);
    // Still a ring: more edges keep the newest five in order.
    rec.slice(board, slice(20, 30, 'HZ', [[21, 'LZ'], [22, 'HZ']]));
    expect(edges(rec, 'a').map(([c]) => c)).toEqual([9, 10, 11, 21, 22]);
    expect(t.dropped).toBe(9);
  });

  it('grows its storage past the first allocation without losing order', () => {
    const rec = new SignalRecorder(5000);
    const board = { partId: BOARD, io: IO, emulator: fakeEmulator() };
    rec.arm(BOARD, 'a');
    const events: [number, string][] = Array.from({ length: 3000 }, (_, i) => [i + 1, i % 2 === 0 ? 'HZ' : 'LZ']);
    rec.slice(board, slice(0, 4000, 'LZ', events));
    const t = rec.trace(BOARD, 'a')!;
    expect(t.length).toBe(3001);
    expect(t.cycle(3000)).toBe(3000);
    expect(t.dropped).toBe(0);
  });

  it('clears on a new emulator (Reset, fresh start) and when the board is removed; arming survives', () => {
    const rec = new SignalRecorder();
    const first = fakeEmulator();
    rec.arm(BOARD, 'a');
    rec.boards([{ partId: BOARD, io: IO, emulator: null }]);
    // The first emulator a board gets is adopted without clearing (a pin armed before it keeps nothing to lose anyway).
    rec.slice({ partId: BOARD, io: IO, emulator: first }, slice(0, 100, 'HZ'));
    rec.arm(BOARD, 'b'); // arming another pin later keeps a's data
    rec.slice({ partId: BOARD, io: IO, emulator: first }, slice(100, 200, 'HL', [[150, 'LL']]));
    expect(edges(rec, 'a')).toEqual([[0, HIGH], [150, LOW]]);
    const generation = rec.trace(BOARD, 'a')!.generation;
    rec.boards([{ partId: BOARD, io: IO, emulator: first }]); // a circuit edit: same emulator, kept
    expect(rec.trace(BOARD, 'a')!.length).toBe(2);
    rec.boards([{ partId: BOARD, io: IO, emulator: fakeEmulator() }]); // reset
    expect(rec.trace(BOARD, 'a')!.length).toBe(0);
    expect(rec.trace(BOARD, 'a')!.end).toBe(0);
    expect(rec.trace(BOARD, 'a')!.generation).toBe(generation + 1);
    expect(rec.isArmed(BOARD, 'a')).toBe(true);
    const second = fakeEmulator();
    rec.slice({ partId: BOARD, io: IO, emulator: second }, slice(0, 50, 'LZ'));
    expect(rec.trace(BOARD, 'a')!.length).toBe(1);
    rec.boards([]); // removed
    expect(rec.trace(BOARD, 'a')!.length).toBe(0);
    expect(rec.isArmed(BOARD, 'a')).toBe(true);
    rec.disarm(BOARD, 'a');
    expect(rec.trace(BOARD, 'a')).toBeUndefined();
  });

  it('starts over when the cycles go back on the same emulator', () => {
    const rec = new SignalRecorder();
    const board = { partId: BOARD, io: IO, emulator: fakeEmulator() };
    rec.arm(BOARD, 'a');
    rec.slice(board, slice(0, 100, 'HZ'));
    rec.slice(board, slice(0, 100, 'LZ'));
    expect(edges(rec, 'a')).toEqual([[0, LOW]]);
  });

  it('records Blink on the real Uno through the mixed-signal bridge without changing its results', () => {
    const blink = parseIntelHex(BLINK_HEX, 32 * 1024).bytes;
    const circuit: SimInput = {
      components: [
        { id: 1, model: { kind: 'board', rails: { ...UNO_ELECTRICAL.rails }, io: {} } },
        { id: 2, model: { kind: 'resistor', ohms: 220 } },
        { id: 3, model: RED_LED },
      ],
      links: [
        [{ part: 1, pin: 'd13' }, { part: 2, pin: 'a' }],
        [{ part: 2, pin: 'b' }, { part: 3, pin: 'anode' }],
        [{ part: 3, pin: 'cathode' }, { part: 1, pin: 'gnd' }],
      ],
    };
    const run = (rec: SignalRecorder | null): MixedSignal => {
      const ms = new MixedSignal();
      ms.observer = rec;
      const slot: BoardSlot = { partId: 1, io: UNO_IO, electrical: UNO_ELECTRICAL, emulator: new UnoEmulator(blink), running: true };
      ms.setCircuit(circuit, [slot]);
      ms.advance(1.2);
      return ms;
    };
    const rec = new SignalRecorder();
    rec.arm(1, 'd13');
    rec.arm(1, 'd1');
    const watched = run(rec);
    const plain = run(null);
    expect(watched.result).toEqual(plain.result);
    expect(watched.instant).toEqual(plain.instant);

    const led = rec.trace(1, 'd13')!;
    expect(led.clockHz).toBe(UNO_CLOCK_HZ);
    expect(led.end).toBeCloseTo(1.2, 9);
    // Blink: low at start (input until pinMode), then on at ~0 s, off at ~1 s.
    const levels = Array.from({ length: led.length }, (_, i) => led.level(i));
    expect(levels).toEqual([HI_Z, LOW, HIGH, LOW]);
    expect(led.time(3)).toBeGreaterThan(1);
    expect(led.time(3)).toBeLessThan(1.05);
    expect(Number.isInteger(led.cycle(3))).toBe(true);
    // d1 carries the serial text: many edges, cycle-exact.
    expect(rec.trace(1, 'd1')!.length).toBeGreaterThan(50);
  });
});
