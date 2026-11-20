// The sample recorder behind the Scope window (logic analyzer now, scope
// traces later). DOM-free and deterministic.
//
// What it records: for every ARMED channel (a board part id + one of its io
// pin ids) the level the program gives the pin, as an edge list. It is fed by
// the mixed-signal bridge (MixedSignal.observer) with each running board's
// SliceResult, so edges are cycle-exact (a UART frame on d1 shows every bit at
// its CPU cycle), never the 1 ms solved voltages and never the wall clock.
// Only running boards execute slices, so a channel records only while its
// board runs. Arming is the opt-in: a board without armed channels costs one
// map lookup per slice; nothing is copied for unobserved pins. The recorder
// only reads what the bridge passes; it never changes a slice, an emulator or
// a result, so recording cannot change the simulation.
//
// Time: each edge is stored as the board's CPU cycle count since reset (an
// integer, exact in a float64 up to 2^53 cycles, ~17 years at 16 MHz) and the
// channel keeps the board's clockHz; seconds = cycle / clockHz is computed
// when drawn. Storing cycles keeps the stamp exact (no accumulated rounding
// from summing 1 ms slices) and is the board's own timeline: the same
// "simulated time since the program started" its controls show. Boards that
// are started together (global Start, Reset) share it; a board started later
// counts from its own start (several wired boards come with step 9).
//
// Levels (from the drive codes in board.ts):
//   H -> HIGH, L -> LOW, Z -> HI_Z (input, nothing driven by the chip: drawn
//   as a mid line), P -> PULL_UP (input with the internal pull-up: a weak
//   high; drawn like high but dimmer, and read as 1 by the decoders).
// What the circuit does to an input pin (a button pulling it low) is not in
// the drive codes; analog channels (later) will record solved volts.
//
// Clearing: a channel's data is dropped when its board gets a new emulator
// (Reset, a fresh Run after Stop, a new build, a project load) and when the
// board is removed; channels stay armed. Storage is bounded per channel
// (`capacity` edges): when full the oldest edges are dropped and counted
// (`dropped`), so the window can say the trace was truncated.
//
// Analog later: a channel is `kind: 'digital'` today; an analog channel will
// be another kind with its own ring of (cycle, float64 volts) samples fed
// from the transient steps, sharing the keys, arming, clearing and time base.

import type { BoardEmulator, DriveCode, IoPinDef, SliceResult } from '../mcu/board';
import type { SliceObserver } from '../mcu/mixedsignal';

export const LOW = 0;
export const HIGH = 1;
export const HI_Z = 2;
export const PULL_UP = 3;
export type Level = typeof LOW | typeof HIGH | typeof HI_Z | typeof PULL_UP;

/** Default edges kept per channel. */
export const DEFAULT_CAPACITY = 1_000_000;
/** First allocation of a channel's ring (it doubles up to the capacity, so idle channels stay small). */
const INITIAL_SLOTS = 1024;

/** The level a drive code stands for. */
export function levelOf(code: string): Level {
  switch (code as DriveCode) {
    case 'H':
      return HIGH;
    case 'L':
      return LOW;
    case 'P':
      return PULL_UP;
    default:
      return HI_Z;
  }
}

/** Reads as logic 1 for a decoder: everything but LOW (an undriven line idles high, like a UART line with pull-ups). */
export function isHigh(level: Level): boolean {
  return level !== LOW;
}

/** Stable id of a channel: board part id and pin id. */
export function channelKey(board: number, pin: string): string {
  return `${board}:${pin}`;
}

/** A recorded digital channel, read-only for the window and the decoders. */
export interface DigitalTrace {
  readonly kind: 'digital';
  readonly board: number;
  readonly pin: string;
  /** Clock of the board that recorded it (cycles per second); 0 before the first slice. */
  readonly clockHz: number;
  /** Edges kept. Index 0 is the level when recording started (or the oldest kept change). */
  readonly length: number;
  /** CPU cycle of edge i (since the board's reset). */
  cycle(i: number): number;
  /** Seconds of edge i. */
  time(i: number): number;
  level(i: number): Level;
  /** Index of the last edge at or before `seconds`, -1 when none. */
  indexAt(seconds: number): number;
  /** Seconds up to which the trace is known (end of the last recorded slice). */
  readonly end: number;
  /** Seconds of the oldest kept edge (0 when empty). */
  readonly start: number;
  /** Edges dropped because the channel was full. */
  readonly dropped: number;
  /** Bumped whenever the data is cleared (consumers drop what they derived). */
  readonly generation: number;
  /** Bumped by every change (new edges, a new end, a clear). */
  readonly revision: number;
}

/** A growing, then bounded ring of (cycle, level) edges. */
class DigitalChannel implements DigitalTrace {
  readonly kind = 'digital';
  clockHz = 0;
  private cycles = new Float64Array(0);
  private levels = new Uint8Array(0);
  /** Index of the oldest edge in the arrays, and the number kept. */
  private head = 0;
  private count = 0;
  endCycle = 0;
  dropped = 0;
  generation = 0;
  revision = 0;

  constructor(
    readonly board: number,
    readonly pin: string,
    private readonly capacity: number,
  ) {}

  get length(): number {
    return this.count;
  }

  get end(): number {
    return this.clockHz > 0 ? this.endCycle / this.clockHz : 0;
  }

  get start(): number {
    return this.count > 0 ? this.time(0) : 0;
  }

  private slot(i: number): number {
    const at = this.head + i;
    return at >= this.cycles.length ? at - this.cycles.length : at;
  }

  cycle(i: number): number {
    return this.cycles[this.slot(i)];
  }

  time(i: number): number {
    return this.cycles[this.slot(i)] / this.clockHz;
  }

  level(i: number): Level {
    return this.levels[this.slot(i)] as Level;
  }

  get lastLevel(): Level | null {
    return this.count > 0 ? this.level(this.count - 1) : null;
  }

  indexAt(seconds: number): number {
    if (this.count === 0 || this.clockHz <= 0) return -1;
    // Cycles are integers: the small tolerance makes time(i) -> indexAt round-trip despite float rounding.
    const c = seconds * this.clockHz * (1 + 1e-12) + 1e-9;
    let lo = 0;
    let hi = this.count - 1;
    if (this.cycle(0) > c) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cycle(mid) <= c) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  push(cycle: number, level: Level): void {
    if (this.count === this.cycles.length) {
      if (this.cycles.length < this.capacity) this.grow();
      else {
        // Full: drop the oldest.
        this.head = this.slot(1);
        this.count--;
        this.dropped++;
      }
    }
    const at = this.slot(this.count);
    this.cycles[at] = cycle;
    this.levels[at] = level;
    this.count++;
  }

  private grow(): void {
    const size = Math.min(this.capacity, Math.max(INITIAL_SLOTS, this.cycles.length * 2));
    const cycles = new Float64Array(size);
    const levels = new Uint8Array(size);
    for (let i = 0; i < this.count; i++) {
      cycles[i] = this.cycle(i);
      levels[i] = this.level(i);
    }
    this.cycles = cycles;
    this.levels = levels;
    this.head = 0;
  }

  clear(): void {
    this.cycles = new Float64Array(0);
    this.levels = new Uint8Array(0);
    this.head = 0;
    this.count = 0;
    this.endCycle = 0;
    this.dropped = 0;
    this.generation++;
    this.revision++;
  }
}

/** A board as the recorder sees it (the bridge's BoardSlot fits). */
export interface RecordedBoard {
  partId: number;
  io: readonly IoPinDef[];
  emulator: BoardEmulator | null;
}

interface BoardChannels {
  emulator: BoardEmulator | null;
  /** Armed channels of this board by pin id. */
  pins: Map<string, DigitalChannel>;
}

export class SignalRecorder implements SliceObserver {
  /** Bumped by every change of any channel (redraw when it moved). */
  version = 0;
  /**
   * Told when the set of armed channels changed (the Simulation forwards it
   * to the simulation Worker, which then sends the slices of those boards).
   */
  onArm: (() => void) | null = null;
  private readonly byBoard = new Map<number, BoardChannels>();

  constructor(readonly capacity: number = DEFAULT_CAPACITY) {}

  /** Start recording a pin (from its board's next slice). Arming twice keeps the data. */
  arm(board: number, pin: string): DigitalTrace {
    let b = this.byBoard.get(board);
    if (!b) this.byBoard.set(board, (b = { emulator: null, pins: new Map() }));
    let ch = b.pins.get(pin);
    if (!ch) {
      b.pins.set(pin, (ch = new DigitalChannel(board, pin, this.capacity)));
      this.version++;
      this.onArm?.();
    }
    return ch;
  }

  /** Stop recording a pin and forget its data. */
  disarm(board: number, pin: string): void {
    const b = this.byBoard.get(board);
    if (!b?.pins.delete(pin)) return;
    if (b.pins.size === 0 && b.emulator === null) this.byBoard.delete(board);
    this.version++;
    this.onArm?.();
  }

  /** The armed channels as (board, pin) pairs. */
  armedChannels(): [number, string][] {
    const out: [number, string][] = [];
    for (const [board, b] of this.byBoard) for (const pin of b.pins.keys()) out.push([board, pin]);
    return out;
  }

  isArmed(board: number, pin: string): boolean {
    return this.byBoard.get(board)?.pins.has(pin) ?? false;
  }

  trace(board: number, pin: string): DigitalTrace | undefined {
    return this.byBoard.get(board)?.pins.get(pin);
  }

  /** Drop the data of every channel of a board (they stay armed). */
  clearBoard(board: number): void {
    const b = this.byBoard.get(board);
    if (!b) return;
    for (const ch of b.pins.values()) ch.clear();
    this.version++;
  }

  /** Drop every channel's data. */
  clearAll(): void {
    for (const id of this.byBoard.keys()) this.clearBoard(id);
  }

  /** Latest recorded time over all channels (seconds), 0 without data. */
  get latest(): number {
    let t = 0;
    for (const b of this.byBoard.values()) for (const ch of b.pins.values()) t = Math.max(t, ch.end);
    return t;
  }

  boards(boards: readonly RecordedBoard[]): void {
    const present = new Set<number>();
    for (const slot of boards) {
      present.add(slot.partId);
      const b = this.byBoard.get(slot.partId);
      if (!b) continue;
      if (b.emulator !== slot.emulator) {
        // Reset, a fresh start, a new build or a reloaded project: a new timeline.
        // (Seeing the first emulator of a board is not a change: a pin armed meanwhile keeps its data.)
        const had = b.emulator !== null;
        b.emulator = slot.emulator;
        if (had) this.clearBoard(slot.partId);
      }
    }
    for (const [id, b] of this.byBoard) {
      if (present.has(id)) continue;
      // The board is gone: its data goes; the arming stays (undo may bring the board back).
      b.emulator = null;
      if (b.pins.size === 0) this.byBoard.delete(id);
      else if ([...b.pins.values()].some((ch) => ch.length > 0 || ch.endCycle > 0)) this.clearBoard(id);
    }
  }

  slice(board: RecordedBoard, run: SliceResult): void {
    const b = this.byBoard.get(board.partId);
    if (!b || b.pins.size === 0 || !board.emulator) return;
    if (b.emulator !== board.emulator) {
      const had = b.emulator !== null;
      b.emulator = board.emulator;
      if (had) this.clearBoard(board.partId);
    }
    const clockHz = board.emulator.clockHz;
    for (const [pin, ch] of b.pins) {
      const j = board.io.findIndex((p) => p.id === pin);
      if (j < 0) continue;
      if (ch.clockHz !== clockHz || run.start < ch.endCycle) {
        // Another clock or time went back (a watchdog keeps the emulator, so check the cycles too): start over.
        if (ch.length > 0) ch.clear();
        ch.clockHz = clockHz;
      }
      let last = ch.lastLevel;
      const first = levelOf(run.drives[j] ?? 'Z');
      if (last !== first) ch.push(run.start, (last = first));
      for (const e of run.events) {
        const l = levelOf(e.drives[j] ?? 'Z');
        if (l !== last) ch.push(e.cycle, (last = l));
      }
      ch.endCycle = run.end;
      ch.revision++;
    }
    this.version++;
  }
}
