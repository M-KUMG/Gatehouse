// UART decoding of a recorded digital line, like a logic analyzer does it:
// the line idles high; a falling edge starts a frame; each bit is sampled in
// its middle at the chosen baud (start bit, 5..9 data bits LSB first,
// optional parity, 1 / 1.5 / 2 stop bits). A stop bit read low is a framing
// error, a wrong parity bit a parity error; the byte is still reported.
// DOM-free, deterministic (times are simulated seconds from the recorder).
//
// Baud: a fixed rate, or 'auto': the shortest pulse between two logic
// transitions is one bit, and its rate is snapped to the nearest usual rate
// within 4 % (nominalBaud: an Arduino's 115200 really runs at 117647).
//
// UartStream decodes a growing trace piece by piece (only the new part is
// read each time), so a long run costs the same per frame as a short one.

import { STANDARD_BAUDS, nominalBaud } from '../mcu/serialstore';
import { highAt, type Annotation, type LogicSignal, type ProtocolDecoder } from './decoders';

export type Parity = 'none' | 'even' | 'odd';
export type DataBits = 5 | 6 | 7 | 8 | 9;
export type StopBits = 1 | 1.5 | 2;

export interface UartSettings {
  /** Bits per second, or 'auto' (from the shortest pulse). */
  baud: number | 'auto';
  dataBits: DataBits;
  parity: Parity;
  stopBits: StopBits;
}

/** 8N1 with the rate detected from the line. */
export const DEFAULT_UART: UartSettings = { baud: 'auto', dataBits: 8, parity: 'none', stopBits: 1 };

/** Rates offered in the window besides Auto. */
export const UART_BAUDS: readonly number[] = STANDARD_BAUDS;

/** A decoded frame. `error` is 'framing', 'parity' or null. */
export interface UartFrame extends Annotation {
  error: 'framing' | 'parity' | null;
}

/** Settings with a known rate (what decodeUart needs). */
export type UartLine = Omit<UartSettings, 'baud'> & { baud: number };

/** Short form like "8N1", "7E2", "8O1.5". */
export function frameFormat(s: Pick<UartSettings, 'dataBits' | 'parity' | 'stopBits'>): string {
  return `${s.dataBits}${s.parity === 'none' ? 'N' : s.parity === 'even' ? 'E' : 'O'}${s.stopBits}`;
}

/** Bits of one frame (start, data, parity, stop). */
export function frameBits(s: Pick<UartSettings, 'dataBits' | 'parity' | 'stopBits'>): number {
  return 1 + s.dataBits + (s.parity === 'none' ? 0 : 1) + s.stopBits;
}

/** Index of the first edge at or after `seconds`. */
function firstAtOrAfter(signal: LogicSignal, seconds: number): number {
  if (!(seconds > -Infinity)) return 0;
  const k = signal.indexAt(seconds);
  return k >= 0 && signal.time(k) >= seconds ? k : k + 1;
}

/**
 * The complete frames that start at or after `from` and end by `to`
 * (default: the end of the signal), and where to continue next time.
 */
export function decodeUart(signal: LogicSignal, line: UartLine, from = -Infinity, to = signal.end): { items: UartFrame[]; next: number } {
  const items: UartFrame[] = [];
  const bit = 1 / line.baud;
  const total = frameBits(line);
  const paritySlot = line.parity === 'none' ? -1 : 1 + line.dataBits;
  const firstStop = 1 + line.dataBits + (line.parity === 'none' ? 0 : 1);
  const stopSamples = line.stopBits === 2 ? 2 : 1; // 1.5 stop bits: only the first is sampled
  const sample = (start: number, slot: number): boolean => highAt(signal, start + (slot + 0.5) * bit);
  let i = Math.max(1, firstAtOrAfter(signal, from));
  while (i < signal.length) {
    // A start bit: a transition from high to low (index 0 is where recording started, not an edge).
    if (signal.high(i) || !signal.high(i - 1)) {
      i++;
      continue;
    }
    const start = signal.time(i);
    const end = start + total * bit;
    if (end > to) return { items, next: start };
    if (sample(start, 0)) {
      i++; // a glitch shorter than half a bit: not a start bit
      continue;
    }
    let value = 0;
    let ones = 0;
    for (let k = 0; k < line.dataBits; k++) {
      if (sample(start, 1 + k)) {
        value |= 1 << k;
        ones++;
      }
    }
    let error: UartFrame['error'] = null;
    for (let k = 0; k < stopSamples; k++) if (!sample(start, firstStop + k)) error = 'framing';
    if (error === null && paritySlot >= 0) {
      const p = sample(start, paritySlot);
      const even = (ones + (p ? 1 : 0)) % 2 === 0;
      if (even !== (line.parity === 'even')) error = 'parity';
    }
    items.push({ start, end, value, error });
    // Look for the next start bit from the middle of the first stop bit.
    i = Math.max(i + 1, firstAtOrAfter(signal, start + (firstStop + 0.5) * bit));
  }
  return { items, next: to };
}

/**
 * Shortest time between two logic transitions among edges [from, to) of the
 * signal (indices), with the time of the last transition seen; Infinity
 * when there are fewer than two transitions.
 */
export function shortestPulse(signal: LogicSignal, from = 0, last = NaN): { pulse: number; last: number } {
  let pulse = Infinity;
  for (let i = Math.max(1, from); i < signal.length; i++) {
    if (signal.high(i) === signal.high(i - 1)) continue;
    const t = signal.time(i);
    if (t - last > 0 && t - last < pulse) pulse = t - last;
    last = t;
  }
  return { pulse, last };
}

/** The usual rate for a shortest pulse of `seconds` (null when there is none). */
export function baudFromPulse(seconds: number): number | null {
  return seconds > 0 && Number.isFinite(seconds) ? nominalBaud(1 / seconds) : null;
}

/** Auto-detected rate of a whole signal, or null with fewer than two transitions. */
export function detectBaud(signal: LogicSignal): number | null {
  return baudFromPulse(shortestPulse(signal).pulse);
}

export const UART_DECODER: ProtocolDecoder<UartLine, UartFrame> = {
  id: 'uart',
  name: 'UART',
  lines: ['RX/TX'],
  decode: (signals, settings, from, to) => decodeUart(signals[0]!, settings, from, to),
};

/** A byte as shown above the trace: "0x48" or "'H'" (non-printing bytes stay hex). */
export function byteLabel(value: number, ascii: boolean): string {
  if (ascii && value >= 0x20 && value <= 0x7e) return `'${String.fromCharCode(value)}'`;
  if (ascii && value === 0x0a) return '\\n';
  if (ascii && value === 0x0d) return '\\r';
  return `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
}

/** Signal plus what tells a cleared or truncated trace apart. */
export interface StreamSource {
  signal: LogicSignal;
  /** Bumped whenever the trace is cleared. */
  generation: number;
}

/**
 * Incremental decoder of one channel: call update() whenever the trace may
 * have grown; `frames` then holds every complete frame in the kept data.
 */
export class UartStream {
  frames: UartFrame[] = [];
  /** Rate in use (fixed, or detected), null while auto has nothing to go on. */
  baud: number | null = null;
  private generation = -1;
  private settingsKey = '';
  private next = -Infinity;
  /** Auto baud: shortest pulse so far and how far the edges were scanned. */
  private pulse = Infinity;
  private lastTransition = NaN;
  private scannedTime = -Infinity;

  /** Bring the frames up to date. True when they changed. */
  update(source: StreamSource, settings: UartSettings): boolean {
    const { signal } = source;
    const key = JSON.stringify(settings);
    let changed = false;
    if (source.generation !== this.generation || key !== this.settingsKey) {
      this.generation = source.generation;
      this.settingsKey = key;
      this.restart();
      this.pulse = Infinity;
      this.lastTransition = NaN;
      this.scannedTime = -Infinity;
      this.baud = null;
      changed = true;
    }
    let baud: number | null;
    if (settings.baud === 'auto') {
      const from = Number.isFinite(this.scannedTime) ? signal.indexAt(this.scannedTime) + 1 : 0;
      const found = shortestPulse(signal, from, this.lastTransition);
      this.lastTransition = found.last;
      if (signal.length > 0) this.scannedTime = signal.time(signal.length - 1);
      this.pulse = Math.min(this.pulse, found.pulse);
      baud = baudFromPulse(this.pulse);
    } else {
      baud = settings.baud;
    }
    if (baud !== this.baud) {
      this.baud = baud;
      this.restart();
      changed = true;
    }
    // Frames whose start was dropped from the recorder go too.
    if (this.frames.length > 0 && this.frames[0].start < signal.start) {
      const keep = this.frames.findIndex((f) => f.start >= signal.start);
      this.frames = keep < 0 ? [] : this.frames.slice(keep);
      changed = true;
    }
    if (baud === null) return changed;
    const { items, next } = decodeUart(signal, { ...settings, baud }, this.next, signal.end);
    this.next = next;
    if (items.length > 0) {
      for (const f of items) this.frames.push(f);
      changed = true;
    }
    return changed;
  }

  private restart(): void {
    this.frames = [];
    this.next = -Infinity;
  }
}
