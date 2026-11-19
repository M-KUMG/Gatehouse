// Serial RX: bytes from sendSerial reach the USART one frame time apart.
import { assemble } from 'avr8js/dist/esm/utils/assembler';
import { describe, expect, it } from 'vitest';
import { NANO_SPEC, UNO_CLOCK_HZ, UnoEmulator } from './uno';

const UCSRA = 0xc0;
const UCSRB = 0xc1;
const UBRRL = 0xc4;
const UBRRH = 0xc5;
const UDR = 0xc6;
const RXEN = 0x10;
const TXEN = 0x08;
const U2X = 0x02;
/** 115200 baud the Arduino way (U2X, UBRR 16): 136 cycles a bit, 1360 a frame (8N1). */
const FRAME = 1360;

/** Set the baud rate (UBRR, U2X), then `before` (assembly), then UCSRB = `ucsrb` and echo every received byte. */
function echo(ucsrb: number, opts: { ubrr?: number; u2x?: boolean; before?: string } = {}): Uint8Array {
  const ubrr = opts.ubrr ?? 16;
  const { bytes, errors } = assemble(`
    ldi r16, ${ubrr >> 8}
    sts ${UBRRH}, r16
    ldi r16, ${ubrr & 0xff}
    sts ${UBRRL}, r16
    ldi r16, ${opts.u2x === false ? 0 : U2X}
    sts ${UCSRA}, r16
    ${opts.before ?? ''}
    ldi r16, ${ucsrb}
    sts ${UCSRB}, r16
  rx:
    lds r16, ${UCSRA}
    sbrs r16, 7        ; RXC
    rjmp rx
    lds r17, ${UDR}
  tx:
    lds r16, ${UCSRA}
    sbrs r16, 5        ; UDRE
    rjmp tx
    sts ${UDR}, r17
    rjmp rx
  `);
  expect(errors).toEqual([]);
  return bytes;
}

/** Run until cycle `until` (overshooting by at most one instruction) in small slices; the bytes the program sent. */
function runTo(uno: UnoEmulator, until: number): number[] {
  const out: number[] = [];
  while (uno.cycles < until) out.push(...(uno.run(Math.min(97, until - uno.cycles)).serial.usart0 ?? []));
  return out;
}

const text = (bytes: readonly number[]): string => String.fromCharCode(...bytes);
const codes = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

describe('Uno serial RX (sendSerial)', () => {
  it('a sent line arrives byte by byte and is echoed', () => {
    const uno = new UnoEmulator(echo(RXEN | TXEN));
    runTo(uno, 100); // set up
    uno.sendSerial('usart0', codes('hi\n'));
    expect(text(runTo(uno, 100 + 3 * FRAME + 100))).toBe('hi\n');
    expect(uno.serialRxPending).toBe(0);
  });

  it('paces bytes at one frame each: a burst of 20 arrives complete and in order', () => {
    const uno = new UnoEmulator(echo(RXEN | TXEN));
    runTo(uno, 100);
    const t0 = uno.cycles;
    const burst = Array.from({ length: 20 }, (_, i) => 0x41 + i);
    uno.sendSerial('usart0', burst);
    // Nothing before the first stop bit; 9 bytes just before the 10th frame ends.
    expect(runTo(uno, t0 + FRAME - 20)).toEqual([]);
    const first = runTo(uno, t0 + 10 * FRAME - 20);
    expect(first).toEqual(burst.slice(0, 9));
    expect(uno.serialRxPending).toBe(10); // byte 10 is on the line
    expect([...first, ...runTo(uno, t0 + 20 * FRAME + 100)]).toEqual(burst);
  });

  it('follows the baud rate the program set (9600: 16640 cycles a frame)', () => {
    const uno = new UnoEmulator(echo(RXEN | TXEN, { ubrr: 207 }));
    runTo(uno, 100);
    const t0 = uno.cycles;
    uno.sendSerial('usart0', codes('ab'));
    expect(runTo(uno, t0 + 16_640 - 20)).toEqual([]);
    expect(text(runTo(uno, t0 + 2 * 16_640 + 100))).toBe('ab');
  });

  it('bytes that arrive while RXEN is off are lost; later ones get through', () => {
    // Receiver off for ~16k cycles (a delay loop), then on.
    const delay = `
      ldi r24, 0
      ldi r25, 0x10
    delay:
      sbiw r24, 1
      brne delay
    `;
    const uno = new UnoEmulator(echo(RXEN | TXEN, { before: delay }));
    runTo(uno, 100);
    uno.sendSerial('usart0', codes('xy'));
    expect(runTo(uno, 20_000)).toEqual([]);
    uno.sendSerial('usart0', codes('z'));
    expect(text(runTo(uno, 20_000 + FRAME + 100))).toBe('z');

    // Never enabled: nothing is received, RXC stays clear.
    const off = new UnoEmulator(echo(TXEN));
    runTo(off, 100);
    off.sendSerial('usart0', codes('abc'));
    expect(runTo(off, 5 * FRAME)).toEqual([]);
    expect(off.serialRxPending).toBe(0);
  });

  it('ignores other ports', () => {
    const uno = new UnoEmulator(echo(RXEN | TXEN));
    uno.sendSerial('usart1', [1, 2, 3]);
    expect(uno.serialRxPending).toBe(0);
    expect(runTo(uno, 5 * FRAME)).toEqual([]);
  });

  it('a watchdog reset drops the queue and the frame on the line', () => {
    // Watchdog on at 16 ms; UBRR 4095 without U2X: 655360 cycles (~41 ms) a frame.
    const wdt = `
      ldi r16, 0x18
      sts 0x60, r16
      ldi r16, 0x08
      sts 0x60, r16
    `;
    const uno = new UnoEmulator(echo(RXEN | TXEN, { ubrr: 4095, u2x: false, before: wdt }));
    runTo(uno, 100);
    uno.sendSerial('usart0', codes('abc'));
    expect(uno.serialRxPending).toBe(2);
    expect(runTo(uno, 0.02 * UNO_CLOCK_HZ)).toEqual([]);
    expect(uno.watchdogResets).toBe(1);
    expect(uno.serialRxPending).toBe(0);
    // The rebooted program would echo, but nothing is on its way any more.
    expect(runTo(uno, 0.1 * UNO_CLOCK_HZ)).toEqual([]);
  });

  it('the Nano shares it', () => {
    const nano = NANO_SPEC.create(echo(RXEN | TXEN));
    nano.run(100);
    nano.sendSerial('usart0', [0x5a]);
    let out: number[] = [];
    while (nano.cycles < 2 * FRAME) out = [...out, ...(nano.run(500).serial.usart0 ?? [])];
    expect(out).toEqual([0x5a]);
  });
});
