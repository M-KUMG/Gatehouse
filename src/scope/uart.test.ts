// UART decoding of lines recorded from the real Uno emulator (Blink's
// Serial.print at 9600, assembled programs at 115200) plus synthetic lines
// for the error cases.
import { assemble } from 'avr8js/dist/esm/utils/assembler';
import { describe, expect, it } from 'vitest';
import { UNO_CLOCK_HZ, UNO_IO, UnoEmulator } from '../mcu/avr/uno';
import { parseIntelHex } from '../mcu/hex';
import { BLINK_HEX } from '../mcu/programs/blink';
import { logicOf, signalOf } from './decoders';
import { SignalRecorder, type DigitalTrace } from './recorder';
import { DEFAULT_UART, UartStream, byteLabel, decodeUart, detectBaud, frameFormat } from './uart';

const UCSRA = 0xc0;
const UCSRB = 0xc1;
const UCSRC = 0xc2;
const UBRRL = 0xc4;
const UBRRH = 0xc5;
const UDR = 0xc6;

/** A program that sets the USART up (U2X, `ubrr`, `ucsrc`) and sends `bytes` as fast as the line takes them, then spins. */
function sender(ubrr: number, bytes: readonly number[], ucsrc = 0x06): Uint8Array {
  const send = bytes.map((_, i) => `w${i}`);
  const body = bytes
    .map((b, i) => `${send[i]}:\n  lds r16, ${UCSRA}\n  sbrs r16, 5\n  rjmp ${send[i]}\n  ldi r17, ${b}\n  sts ${UDR}, r17\n`)
    .join('');
  const { bytes: program, errors } = assemble(`
    ldi r16, ${ubrr >> 8}
    sts ${UBRRH}, r16
    ldi r16, ${ubrr & 0xff}
    sts ${UBRRL}, r16
    ldi r16, 2
    sts ${UCSRA}, r16
    ldi r16, ${ucsrc}
    sts ${UCSRC}, r16
    ldi r16, 0x08
    sts ${UCSRB}, r16
  ${body}
  spin: rjmp spin
  `);
  expect(errors).toEqual([]);
  return program;
}

/** Record d1 of an Uno running `program` for `seconds`, in 1 ms slices like the bridge. */
function recordD1(program: Uint8Array, seconds: number, rec = new SignalRecorder()): { trace: DigitalTrace; serial: number[] } {
  const uno = new UnoEmulator(program);
  const board = { partId: 1, io: UNO_IO, emulator: uno };
  rec.arm(1, 'd1');
  const serial: number[] = [];
  while (uno.cycles < seconds * UNO_CLOCK_HZ) {
    const run = uno.run(UNO_CLOCK_HZ / 1000);
    rec.slice(board, run);
    serial.push(...(run.serial.usart0 ?? []));
  }
  return { trace: rec.trace(1, 'd1')!, serial };
}

const text = (bytes: readonly number[]): string => String.fromCharCode(...bytes);

describe('UART decoder on emulator lines', () => {
  it('decodes Blink at 9600 baud (auto-detected) into the bytes it sent', () => {
    const { trace, serial } = recordD1(parseIntelHex(BLINK_HEX, 32 * 1024).bytes, 0.05);
    expect(text(serial)).toBe('Blink: LED on pin 13\r\nLED on\r\n');
    const signal = logicOf(trace);
    expect(detectBaud(signal)).toBe(9600);
    const { items } = decodeUart(signal, { ...DEFAULT_UART, baud: 9600 });
    expect(items.map((f) => f.value)).toEqual(serial);
    expect(items.every((f) => f.error === null)).toBe(true);
    // Frame times: 10 bits of 1/9600 s (the line really runs at 9615 baud: within a bit over the frame).
    expect(items[0].end - items[0].start).toBeCloseTo(10 / 9600, 9);
    expect(items[1].start - items[0].start).toBeGreaterThanOrEqual(10 / 9615 - 1e-9);
  });

  it('decodes a 115200 stream (auto-detected from the 117647 baud the Uno really sends)', () => {
    const message = [...'Hello, 0x55 U!\n'].map((c) => c.charCodeAt(0)).concat([0x00, 0xff, 0x80]);
    const { trace, serial } = recordD1(sender(16, message), 0.01);
    expect(serial).toEqual(message);
    const signal = logicOf(trace);
    expect(detectBaud(signal)).toBe(115200);
    const { items } = decodeUart(signal, { ...DEFAULT_UART, baud: 115200 });
    expect(items.map((f) => f.value)).toEqual(message);
    expect(items.filter((f) => f.error !== null)).toEqual([]);
  });

  it('decodes 7 data bits with even parity and 2 stop bits; the wrong parity gives parity errors', () => {
    // UCSRC: UPM1 (even), USBS (2 stop), UCSZ = 2 (7 bits).
    const { trace } = recordD1(sender(16, [0x41, 0x43, 0x01], 0x20 | 0x08 | 0x04), 0.005);
    const signal = logicOf(trace);
    const line = { baud: 115200, dataBits: 7 as const, parity: 'even' as const, stopBits: 2 as const };
    expect(frameFormat(line)).toBe('7E2');
    const good = decodeUart(signal, line).items;
    expect(good.map((f) => [f.value, f.error])).toEqual([[0x41, null], [0x43, null], [0x01, null]]);
    const odd = decodeUart(signal, { ...line, parity: 'odd' }).items;
    expect(odd.map((f) => [f.value, f.error])).toEqual([[0x41, 'parity'], [0x43, 'parity'], [0x01, 'parity']]);
  });

  it('decodes a growing trace piece by piece exactly like at once', () => {
    const message = [...'abcdefghij'].map((c) => c.charCodeAt(0));
    const program = sender(207, message); // 9600
    const once = decodeUart(logicOf(recordD1(program, 0.015).trace), { ...DEFAULT_UART, baud: 9600 }).items;
    const rec = new SignalRecorder();
    const uno = new UnoEmulator(program);
    const board = { partId: 1, io: UNO_IO, emulator: uno };
    rec.arm(1, 'd1');
    const stream = new UartStream();
    while (uno.cycles < 0.015 * UNO_CLOCK_HZ) {
      rec.slice(board, uno.run(UNO_CLOCK_HZ / 2000)); // half-ms slices: frames cross them
      const t = rec.trace(1, 'd1')!;
      stream.update({ signal: logicOf(t), generation: t.generation }, DEFAULT_UART);
    }
    expect(stream.baud).toBe(9600);
    expect(stream.frames).toEqual(once);
    expect(stream.frames.map((f) => f.value)).toEqual(message);
  });
});

describe('UART decoder on synthetic lines', () => {
  const bit = 1 / 1000; // 1000 baud: one bit = 1 ms

  /** Edges of frames given as bit levels (start bit included), from an idle-high line at t = 0. */
  function line(frames: readonly number[][], gap = 2): ReturnType<typeof signalOf> {
    const times = [0];
    const levels: boolean[] = [true];
    let t = gap * bit;
    for (const bits of frames) {
      for (const b of bits) {
        if ((b === 1) !== levels[levels.length - 1]) {
          times.push(t);
          levels.push(b === 1);
        }
        t += bit;
      }
      if (!levels[levels.length - 1]) {
        // Back to idle high after the frame (after a framing error too).
        times.push(t);
        levels.push(true);
      }
      t += gap * bit;
    }
    if (!levels[levels.length - 1]) {
      times.push(t);
      levels.push(true);
    }
    return signalOf(times, levels, t + 5 * bit);
  }
  const frame8N1 = (byte: number, stop = 1): number[] => [0, ...Array.from({ length: 8 }, (_, i) => (byte >> i) & 1), stop];

  it('reports a framing error when the stop bit is low, and still the byte', () => {
    const s = line([frame8N1(0x5a), frame8N1(0x00, 0), frame8N1(0xa5)]);
    const items = decodeUart(s, { ...DEFAULT_UART, baud: 1000 }).items;
    expect(items.map((f) => [f.value, f.error])).toEqual([[0x5a, null], [0x00, 'framing'], [0xa5, null]]);
    expect(items[0].start).toBeCloseTo(2 * bit, 12);
    expect(items[0].end).toBeCloseTo(12 * bit, 12);
  });

  it('ignores a glitch shorter than half a bit', () => {
    const s = signalOf([0, 0.002, 0.0022, 0.005], [true, false, true, true], 0.03);
    expect(decodeUart(s, { ...DEFAULT_UART, baud: 1000 }).items).toEqual([]);
  });

  it('leaves an unfinished frame for the next call', () => {
    const s = line([frame8N1(0x31)]);
    const cut = 8 * bit; // in the middle of the frame
    const { items, next } = decodeUart(s, { ...DEFAULT_UART, baud: 1000 }, -Infinity, cut);
    expect(items).toEqual([]);
    expect(next).toBeCloseTo(2 * bit, 12);
    expect(decodeUart(s, { ...DEFAULT_UART, baud: 1000 }, next).items.map((f) => f.value)).toEqual([0x31]);
  });

  it('auto-detects the rate from the shortest pulse, snapped to a usual rate', () => {
    expect(detectBaud(line([frame8N1(0x55)]))).toBe(1000);
    const b = 1 / 9615; // what an Arduino set for 9600 really sends
    expect(detectBaud(signalOf([0, b * 3, b * 4, b * 6], [true, false, true, false], 1))).toBe(9600);
    expect(detectBaud(signalOf([0], [true], 1))).toBeNull();
  });

  it('labels bytes as hex or ASCII', () => {
    expect(byteLabel(0x48, true)).toBe("'H'");
    expect(byteLabel(0x48, false)).toBe('0x48');
    expect(byteLabel(0x0a, true)).toBe('\\n');
    expect(byteLabel(0x07, true)).toBe('0x07');
  });
});
