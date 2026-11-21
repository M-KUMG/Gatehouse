// Protocol decoders for the Logic analyzer window: the common interface they
// plug into. DOM-free. UART is in uart.ts, I2C in i2c.ts, SPI in spi.ts.

import { LOW, isHigh, type DigitalTrace, type Level } from './recorder';

/** A digital line as decoders read it: edges in time order, logic 1 / 0. */
export interface LogicSignal {
  /** Edges kept; index 0 is the level when recording started (not a transition). */
  readonly length: number;
  /** Seconds of edge i. */
  time(i: number): number;
  /** Logic level from edge i on. */
  high(i: number): boolean;
  /** Index of the last edge at or before `seconds`, -1 when none. */
  indexAt(seconds: number): number;
  /** Seconds of the oldest kept edge. */
  readonly start: number;
  /** Seconds up to which the line is known. */
  readonly end: number;
}

/** A recorded channel as a logic signal (HIGH, pull-up and high impedance read as 1, see recorder.ts). */
export function logicOf(trace: DigitalTrace): LogicSignal {
  return {
    get length() {
      return trace.length;
    },
    time: (i) => trace.time(i),
    high: (i) => isHigh(trace.level(i)),
    indexAt: (t) => trace.indexAt(t),
    get start() {
      return trace.start;
    },
    get end() {
      return trace.end;
    },
  };
}

/** A logic signal from plain arrays (tests, synthetic lines). */
export function signalOf(times: readonly number[], levels: readonly (boolean | Level)[], end: number): LogicSignal {
  const high = levels.map((l) => (typeof l === 'boolean' ? l : l !== LOW));
  return {
    length: times.length,
    time: (i) => times[i],
    high: (i) => high[i],
    indexAt: (t) => {
      let lo = 0;
      let hi = times.length - 1;
      if (times.length === 0 || times[0] > t) return -1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (times[mid] <= t) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
    start: times[0] ?? 0,
    end,
  };
}

/** Logic level at `seconds` (an unknown time before the first edge reads as idle high). */
export function highAt(signal: LogicSignal, seconds: number): boolean {
  const i = signal.indexAt(seconds);
  return i < 0 ? true : signal.high(i);
}

/** One decoded item (a UART byte, an I2C address or data byte, an SPI word). */
export interface Annotation {
  /** Seconds where it starts and ends on the line. */
  start: number;
  end: number;
  value: number;
  /** What went wrong, or null. */
  error: string | null;
}

/** What every decoder offers. */
export interface ProtocolDecoder<Settings, Item extends Annotation = Annotation> {
  readonly id: string;
  readonly name: string;
  /** Roles of the lines it reads, in order (one channel each), e.g. ['RX/TX'] or ['SDA', 'SCL']. */
  readonly lines: readonly string[];
  /** Lines (by index in `lines`) the decoder works without, like SPI's MISO or chip select. */
  readonly optional?: readonly number[];
  /**
   * The complete items that START at or after `from` and end by `to`, in
   * order, and the time to continue from next time (so a running trace is
   * decoded piece by piece: the start of an unfinished item, or `to`). A
   * decoder may also return the items of a transaction that is still going
   * on; those start at or after `next` and are returned again, completed,
   * by the next call from `next` (BusStream replaces them).
   * `signals` follows `lines`; a line left out is null.
   */
  decode(signals: readonly (LogicSignal | null)[], settings: Settings, from: number, to: number): { items: Item[]; next: number };
}
