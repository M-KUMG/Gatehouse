// SPI decoding of recorded lines, like a logic analyzer does it: MOSI and MISO
// are read on the clock edge of the chosen mode, eight bits to a word, MSB or
// LSB first. A chip select line is optional; with one, a word only counts
// while it is asserted and an unfinished word is dropped when it changes.
// Without one, an unfinished word is dropped when the clock pauses for longer
// than a few bit times.
//
//   mode 0: clock idles low,  data read on the rising edge
//   mode 1: clock idles low,  data read on the falling edge
//   mode 2: clock idles high, data read on the falling edge
//   mode 3: clock idles high, data read on the rising edge
//
// DOM-free, deterministic (times are simulated seconds from the recorder).

import { highAt, type Annotation, type LogicSignal, type ProtocolDecoder } from './decoders';

export type SpiMode = 0 | 1 | 2 | 3;

export interface SpiSettings {
  mode: SpiMode;
  lsbFirst: boolean;
  /** The chip select is asserted when low (the usual), else when high. */
  csActiveLow: boolean;
}

export const DEFAULT_SPI: SpiSettings = { mode: 0, lsbFirst: false, csActiveLow: true };

/** One decoded word: what MOSI and MISO carried (null for a line that is not connected). */
export interface SpiWord extends Annotation {
  mosi: number | null;
  miso: number | null;
  /** The label for the box: "0x9F", or "0x9F · 0xFF" with both lines. */
  text: string;
}

/** The lines of a decode, by role. */
export interface SpiLines {
  mosi: LogicSignal | null;
  miso: LogicSignal | null;
  sck: LogicSignal;
  cs: LogicSignal | null;
}

const EPS = 1e-12;
const BITS = 8;
/** An unfinished word is dropped when the clock pauses for this many bit times (no chip select). */
const GAP_BITS = 4;
const hex2 = (n: number): string => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

/** Level of `signal` just before `seconds` (high when it has nothing recorded). */
function levelBefore(signal: LogicSignal, seconds: number): boolean {
  if (signal.length === 0) return true;
  return highAt(signal, seconds - EPS);
}

/** Index of the first edge (not the initial level) at or after `seconds`. */
function firstEdgeFrom(signal: LogicSignal, seconds: number): number {
  if (!(seconds > -Infinity)) return 1;
  const k = signal.indexAt(seconds);
  return Math.max(1, k >= 0 && signal.time(k) >= seconds ? k : k + 1);
}

/** Clock level on which data is read for a mode. */
export function sampleRising(mode: SpiMode): boolean {
  return mode === 0 || mode === 3;
}

/**
 * The complete words that start at or after `from` and end by `to`, and where to continue.
 * A word's box runs from half a bit before its first sample to half a bit after its last.
 */
export function decodeSpi(lines: SpiLines, settings: SpiSettings, from = -Infinity, to = lines.sck.end): { items: SpiWord[]; next: number } {
  const items: SpiWord[] = [];
  const { mosi, miso, sck, cs } = lines;
  const rising = sampleRising(settings.mode);
  const asserted = !settings.csActiveLow;
  let count = 0;
  let a = 0; // MOSI bits so far
  let b = 0; // MISO bits so far
  let first = NaN; // time of the first sample of the word
  let last = NaN;
  let gap = NaN; // time between the last two samples of this word
  let csIndex = cs ? cs.indexAt(from === -Infinity ? -Infinity : from - EPS) : 0;

  const reset = (): void => {
    count = 0;
    a = 0;
    b = 0;
    first = last = gap = NaN;
  };

  for (let i = firstEdgeFrom(sck, from); i < sck.length && sck.time(i) <= to; i++) {
    if (sck.high(i) === sck.high(i - 1) || sck.high(i) !== rising) continue; // not a sampling edge
    const t = sck.time(i);
    if (cs) {
      const index = cs.indexAt(t);
      if (index !== csIndex) {
        csIndex = index;
        reset(); // the chip select changed since the last sample: a new transfer
      }
      if (levelBefore(cs, t) !== asserted) {
        reset();
        continue;
      }
    } else if (count > 0 && Number.isFinite(gap) && t - last > GAP_BITS * gap) {
      reset(); // the clock paused: whatever was shifted so far is not a word
    }
    if (count > 0) gap = t - last;
    const bitA = mosi && levelBefore(mosi, t) ? 1 : 0;
    const bitB = miso && levelBefore(miso, t) ? 1 : 0;
    if (count === 0) first = t;
    if (settings.lsbFirst) {
      a |= bitA << count;
      b |= bitB << count;
    } else {
      a = (a << 1) | bitA;
      b = (b << 1) | bitB;
    }
    last = t;
    count++;
    if (count === BITS) {
      const bit = (last - first) / (BITS - 1);
      const both = mosi && miso;
      items.push({
        start: first - bit / 2, end: last + bit / 2, value: mosi ? a : b, error: null,
        mosi: mosi ? a : null, miso: miso ? b : null,
        text: both ? `${hex2(a)} · ${hex2(b)}` : hex2(mosi ? a : b),
      });
      reset();
    }
  }
  return { items, next: count > 0 ? first : to };
}

export const SPI_DECODER: ProtocolDecoder<SpiSettings, SpiWord> = {
  id: 'spi',
  name: 'SPI',
  lines: ['MOSI', 'MISO', 'SCK', 'CS'],
  optional: [0, 1, 3],
  decode: (signals, settings, from, to) =>
    decodeSpi({ mosi: signals[0] ?? null, miso: signals[1] ?? null, sck: signals[2]!, cs: signals[3] ?? null }, settings, from, to),
};
