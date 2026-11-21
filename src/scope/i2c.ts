// I2C decoding of two recorded lines, like a logic analyzer does it:
//   START          SDA falls while SCL is high (a second one inside a transfer is a repeated START)
//   STOP           SDA rises while SCL is high
//   a byte         8 bits on SCL's rising edges, MSB first, then a 9th clock for the ACK:
//                  the receiver pulls SDA low (ACK) or leaves it high (NACK)
//   first byte     the 7-bit address and the direction bit (0 = write, 1 = read)
// A NACK on an address means nobody answered; on a written byte it is a refusal
// (shown as an error); on the last byte a master reads it is normal.
// 10-bit addressing is not decoded as such (the second address byte is data).
// DOM-free, deterministic (times are simulated seconds from the recorder).

import { highAt, type Annotation, type LogicSignal, type ProtocolDecoder } from './decoders';

export type I2cKind = 'start' | 'repeated-start' | 'address' | 'data' | 'stop';

export interface I2cItem extends Annotation {
  kind: I2cKind;
  /** The label for the box: "S", "0x3C W", "0xA5", "P". */
  text: string;
  /** address and data: did the receiver acknowledge; null for START and STOP. */
  ack: boolean | null;
  /** address: the direction (true = read); data: the direction of the transfer it belongs to. */
  read: boolean | null;
}

/** I2C has no settings (the lines are the channels); extra keys are ignored (the window adds its pin choice, which only tells a stream to start over). */
export type I2cSettings = Record<string, unknown>;

const EPS = 1e-12;
const hex2 = (n: number): string => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

interface Event {
  t: number;
  line: 'sda' | 'scl';
  high: boolean;
}

/** Index of the first edge (not the initial level) at or after `seconds`. */
function firstEdgeFrom(signal: LogicSignal, seconds: number): number {
  if (!(seconds > -Infinity)) return 1;
  const k = signal.indexAt(seconds);
  return Math.max(1, k >= 0 && signal.time(k) >= seconds ? k : k + 1);
}

/** The signal's level just before `seconds` (its first level when the time is before every edge). */
function levelBefore(signal: LogicSignal, seconds: number): boolean {
  if (signal.length === 0) return true;
  if (!(seconds > -Infinity)) return signal.high(0);
  return highAt(signal, seconds - EPS);
}

/** The edges of both lines in [from, to], in time order (SDA first on a tie). */
function mergedEdges(sda: LogicSignal, scl: LogicSignal, from: number, to: number): Event[] {
  const out: Event[] = [];
  let i = firstEdgeFrom(sda, from);
  let j = firstEdgeFrom(scl, from);
  for (;;) {
    const a = i < sda.length && sda.time(i) <= to ? sda.time(i) : Infinity;
    const b = j < scl.length && scl.time(j) <= to ? scl.time(j) : Infinity;
    if (a === Infinity && b === Infinity) return out;
    if (a <= b) {
      out.push({ t: a, line: 'sda', high: sda.high(i) });
      i++;
    } else {
      out.push({ t: b, line: 'scl', high: scl.high(j) });
      j++;
    }
  }
}

/**
 * The items from `from` to `to`, and where to continue. While a transfer is
 * open (START seen, no STOP yet) its items so far are returned too and `next`
 * is its START, so the whole transfer is read again from there.
 */
export function decodeI2c(sda: LogicSignal, scl: LogicSignal, from = -Infinity, to = Math.min(sda.end, scl.end)): { items: I2cItem[]; next: number } {
  const items: I2cItem[] = [];
  let sdaHigh = levelBefore(sda, from);
  let sclHigh = levelBefore(scl, from);
  let open = false;
  let openAt = to;
  let bits = 0;
  let shift = 0;
  let byteIndex = 0;
  let read: boolean | null = null;
  let byteStart = from;
  let lastFall = from;
  let pending: I2cItem | null = null;
  let pendingAt = to;

  const finish = (end: number): void => {
    if (!pending) return;
    pending.end = end;
    items.push(pending);
    pending = null;
  };

  for (const e of mergedEdges(sda, scl, from, to)) {
    if (e.line === 'sda') {
      const wasHigh = sdaHigh;
      sdaHigh = e.high;
      if (!sclHigh || wasHigh === e.high) continue;
      if (!e.high) {
        // START (or repeated START): SDA falls while SCL is high.
        finish(e.t);
        items.push({ kind: open ? 'repeated-start' : 'start', text: open ? 'Sr' : 'S', start: e.t, end: e.t, value: 0, error: null, ack: null, read: null });
        if (!open) openAt = e.t;
        lastFall = e.t; // the first byte starts at the SCL fall that follows
        open = true;
        bits = 0;
        shift = 0;
        byteIndex = 0;
        read = null;
      } else if (open) {
        // STOP: SDA rises while SCL is high.
        items.push({ kind: 'stop', text: 'P', start: e.t, end: e.t, value: 0, error: null, ack: null, read: null });
        open = false;
        bits = 0;
      }
    } else {
      const wasHigh = sclHigh;
      sclHigh = e.high;
      if (wasHigh === e.high) continue;
      if (!e.high) {
        lastFall = e.t;
        finish(e.t);
      } else if (open) {
        // SCL rises: SDA holds the bit.
        if (bits === 0) byteStart = Number.isFinite(lastFall) ? lastFall : e.t;
        if (bits < 8) {
          shift = (shift << 1) | (sdaHigh ? 1 : 0);
          bits++;
        } else {
          const ack = !sdaHigh;
          const address = byteIndex === 0;
          if (address) read = (shift & 1) === 1;
          const value = address ? shift >> 1 : shift;
          const text = address ? `${hex2(value)} ${read ? 'R' : 'W'}` : hex2(value);
          // A NACK is an error where it means something: nobody answered an address, or a device refused a written byte.
          const error = !ack && (address || !read) ? (address ? 'no ack' : 'nack') : null;
          pending = {
            kind: address ? 'address' : 'data', text: text + (ack ? '' : ' NACK'), start: byteStart, end: e.t, value, error, ack, read,
          };
          pendingAt = byteStart;
          byteIndex++;
          bits = 0;
          shift = 0;
        }
      }
    }
  }
  // The byte whose last clock is still high is not finished; an open transfer is read again from its START.
  if (pending) items.push({ ...pending, end: to });
  let next = to;
  if (open) next = openAt;
  else if (pending) next = pendingAt;
  else if (bits > 0) next = byteStart;
  return { items, next };
}

export const I2C_DECODER: ProtocolDecoder<I2cSettings, I2cItem> = {
  id: 'i2c',
  name: 'I2C',
  lines: ['SDA', 'SCL'],
  decode: (signals, _settings, from, to) => decodeI2c(signals[0]!, signals[1]!, from, to),
};
