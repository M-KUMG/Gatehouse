// Protocol decoders for the Scope window: the common interface they plug
// into. DOM-free. UART is in uart.ts; I2C and SPI are stubs (TODO) that show
// up in the window as "coming later" until they are written.

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

/** One decoded item (a UART byte, later an I2C address or data byte, an SPI word). */
export interface Annotation {
  /** Seconds where it starts and ends on the line. */
  start: number;
  end: number;
  value: number;
  /** What went wrong, or null. */
  error: string | null;
}

/** What every decoder offers. */
export interface ProtocolDecoder<Settings> {
  readonly id: string;
  readonly name: string;
  /** Roles of the lines it reads, in order (one channel each), e.g. ['RX/TX'] or ['SDA', 'SCL']. */
  readonly lines: readonly string[];
  /** False for a stub that decodes nothing yet. */
  readonly implemented: boolean;
  /**
   * The complete items that START at or after `from` and end by `to`, in
   * order, and the time to continue from next time (so a running trace is
   * decoded piece by piece: the start of an unfinished item, or `to`).
   */
  decode(signals: readonly LogicSignal[], settings: Settings, from: number, to: number): { items: Annotation[]; next: number };
}

/** I2C: TODO, not decoded yet (start/stop conditions, address + R/W, data, ACK/NACK on SDA sampled at SCL rising edges). */
export const I2C_DECODER: ProtocolDecoder<Record<string, never>> = {
  id: 'i2c',
  name: 'I2C',
  lines: ['SDA', 'SCL'],
  implemented: false,
  decode: (_signals, _settings, _from, to) => ({ items: [], next: to }), // TODO
};

/** SPI: TODO, not decoded yet (MOSI/MISO sampled on the clock edge of the mode, optional chip select, bit order). */
export const SPI_DECODER: ProtocolDecoder<Record<string, never>> = {
  id: 'spi',
  name: 'SPI',
  lines: ['MOSI', 'MISO', 'SCK', 'CS'],
  implemented: false,
  decode: (_signals, _settings, _from, to) => ({ items: [], next: to }), // TODO
};
