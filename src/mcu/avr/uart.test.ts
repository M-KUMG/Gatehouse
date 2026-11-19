// Serial TX on d1: the USART drives the pin with cycle-exact UART frames.
import { assemble } from 'avr8js/dist/esm/utils/assembler';
import { describe, expect, it } from 'vitest';
import { RED_LED, solveCircuit, type SimInput } from '../../sim';
import { parseIntelHex } from '../hex';
import { MixedSignal } from '../mixedsignal';
import { BLINK_HEX } from '../programs/blink';
import { UNO_CLOCK_HZ, UNO_ELECTRICAL, UNO_IO, UnoEmulator } from './uno';

const D1 = UNO_IO.findIndex((p) => p.id === 'd1');
const UCSRA = 0xc0;
const UCSRB = 0xc1;
const UCSRC = 0xc2;
const UBRRL = 0xc4;
const UBRRH = 0xc5;
const UDR = 0xc6;
const DDRD = 0x2a;
const PORTD = 0x2b;
const TXEN = 0x08;
const U2X = 0x02;

/** 9600 baud the Arduino way (U2X, UBRR 207): 1664 cycles a bit. */
const BAUD_9600 = { ubrr: 207, u2x: true, bit: 1664 };
/** 115200 baud the Arduino way (U2X, UBRR 16): 136 cycles a bit. */
const BAUD_115200 = { ubrr: 16, u2x: true, bit: 136 };

/**
 * A program that does register writes back to back (ldi + sts, 3 cycles
 * each: write i lands at cycle 3i + 1), then spins.
 */
function writes(list: readonly [number, number][]): Uint8Array {
  const src = list.map(([addr, v]) => `ldi r16, ${v}\nsts ${addr}, r16\n`).join('') + 'spin: rjmp spin\n';
  const { bytes, errors } = assemble(src);
  expect(errors).toEqual([]);
  return bytes;
}
const writeCycle = (i: number): number => 3 * i + 1;

const baudWrites = (b: typeof BAUD_9600): [number, number][] => [
  [UBRRH, b.ubrr >> 8],
  [UBRRL, b.ubrr & 0xff],
  [UCSRA, b.u2x ? U2X : 0],
];

interface Edge {
  cycle: number;
  code: string;
}

/** Run `total` cycles in slices of `slice`; returns d1's changes. Checks the SliceResult contract on the way. */
function d1Edges(uno: UnoEmulator, total: number, slice: number): Edge[] {
  const edges: Edge[] = [];
  let last = uno.drives();
  let lastCode = last[D1];
  while (uno.cycles < total) {
    const r = uno.run(slice);
    expect(r.drives).toBe(last);
    let prev = r.start;
    for (const e of r.events) {
      expect(e.cycle).toBeGreaterThanOrEqual(prev);
      expect(e.cycle).toBeLessThanOrEqual(r.end);
      prev = e.cycle;
      last = e.drives;
      if (e.drives[D1] !== lastCode) edges.push({ cycle: e.cycle, code: (lastCode = e.drives[D1]) });
    }
    expect(uno.drives()).toBe(last);
  }
  return edges;
}

/** The expected d1 edges of an 8N1 frame of `byte` starting at `start`, from an idle-high line. */
function frameEdges(byte: number, start: number, bit: number): Edge[] {
  const levels = [0, ...Array.from({ length: 8 }, (_, i) => (byte >> i) & 1), 1];
  const edges: Edge[] = [];
  let level = 1;
  levels.forEach((l, i) => {
    if (l !== level) edges.push({ cycle: start + i * bit, code: (level = l) ? 'H' : 'L' });
  });
  return edges;
}

/** Decode 8N1 bytes from d1 edges (line idle high), sampling mid-bit. */
function decode(edges: readonly Edge[], bit: number): number[] {
  const levelAt = (c: number): number => {
    let level = 1;
    for (const e of edges) {
      if (e.cycle > c) break;
      level = e.code === 'H' ? 1 : 0;
    }
    return level;
  };
  const bytes: number[] = [];
  let i = 0;
  while (i < edges.length) {
    const e = edges[i];
    if (e.code !== 'L') {
      i++;
      continue;
    }
    const start = e.cycle;
    let byte = 0;
    for (let k = 0; k < 8; k++) byte |= levelAt(start + (k + 1.5) * bit) << k;
    expect(levelAt(start + 9.5 * bit)).toBe(1); // stop bit
    bytes.push(byte);
    const next = start + 10 * bit;
    while (i < edges.length && edges[i].cycle < next) i++;
  }
  return bytes;
}

describe('Uno serial TX on d1', () => {
  for (const [name, baud] of [['9600', BAUD_9600], ['115200', BAUD_115200]] as const) {
    for (const byte of [0x55, 'H'.charCodeAt(0)]) {
      it(`sends 0x${byte.toString(16)} at ${name} baud as a cycle-exact 8N1 frame`, () => {
        const uno = new UnoEmulator(writes([...baudWrites(baud), [UCSRB, TXEN], [UDR, byte]]));
        expect(uno.drives()[D1]).toBe('Z');
        const edges = d1Edges(uno, 20 * baud.bit, 1000);
        const start = writeCycle(4);
        // TXEN: the USART takes the pin over, idle high. Then the frame.
        expect(edges).toEqual([{ cycle: writeCycle(3), code: 'H' }, ...frameEdges(byte, start, baud.bit)]);
        expect(edges.at(-1)).toEqual({ cycle: start + 9 * baud.bit, code: 'H' });
      });
    }
  }

  it("'H' at 9600: low for the start bit and bits 0..2, high bit 3, low 4..5, high 6, low 7, then stop", () => {
    const b = BAUD_9600.bit;
    const uno = new UnoEmulator(writes([...baudWrites(BAUD_9600), [UCSRB, TXEN], [UDR, 0x48]]));
    const s = writeCycle(4);
    expect(d1Edges(uno, 12 * b, 5000).slice(1)).toEqual([
      { cycle: s, code: 'L' },
      { cycle: s + 4 * b, code: 'H' },
      { cycle: s + 5 * b, code: 'L' },
      { cycle: s + 7 * b, code: 'H' },
      { cycle: s + 8 * b, code: 'L' },
      { cycle: s + 9 * b, code: 'H' },
    ]);
  });

  it('back-to-back bytes follow each other at the line pace without overlapping', () => {
    const bit = BAUD_115200.bit;
    const uno = new UnoEmulator(writes([...baudWrites(BAUD_115200), [UCSRB, TXEN], [UDR, 0x55], [UDR, 0x48]]));
    const edges = d1Edges(uno, 30 * bit, 700);
    const first = writeCycle(4);
    expect(edges.slice(1)).toEqual([...frameEdges(0x55, first, bit), ...frameEdges(0x48, first + 10 * bit, bit)]);
    expect(decode(edges.slice(1), bit)).toEqual([0x55, 0x48]);
  });

  it('carries a frame across slice boundaries: any slicing gives the same edges', () => {
    const program = writes([...baudWrites(BAUD_9600), [UCSRB, TXEN], [UDR, 0x55], [UDR, 0x48]]);
    const total = 25 * BAUD_9600.bit;
    const whole = d1Edges(new UnoEmulator(program), total, total);
    for (const slice of [1, 7, 100, 1664, 1665, 16_000]) {
      expect(d1Edges(new UnoEmulator(program), total, slice)).toEqual(whole);
    }
    expect(whole).toHaveLength(1 + 10 + 6);
  });

  it('clearing TXEN gives d1 back to PORTD/DDRD (after the frame in progress)', () => {
    const bit = BAUD_9600.bit;
    // d1 as an output driven low by the port.
    const port: [number, number][] = [[DDRD, 0x02], [PORTD, 0x00]];
    // Enable and disable while idle: H at once, then back to the port's L.
    let uno = new UnoEmulator(writes([...port, ...baudWrites(BAUD_9600), [UCSRB, TXEN], [UCSRB, 0]]));
    expect(d1Edges(uno, 1000, 100)).toEqual([
      { cycle: writeCycle(0), code: 'L' },
      { cycle: writeCycle(5), code: 'H' },
      { cycle: writeCycle(6), code: 'L' },
    ]);
    // Disabled in the middle of a frame: the frame finishes, then the port takes over.
    // A byte written while TXEN is off still reaches the serial console but not the pin.
    uno = new UnoEmulator(writes([...port, ...baudWrites(BAUD_9600), [UCSRB, TXEN], [UDR, 0x55], [UCSRB, 0], [UDR, 0x41]]));
    const start = writeCycle(6);
    let serial: number[] = [];
    const edges: Edge[] = [];
    let last = uno.drives()[D1];
    while (uno.cycles < 15 * bit) {
      const r = uno.run(997);
      serial = [...serial, ...(r.serial.usart0 ?? [])];
      for (const e of r.events) if (e.drives[D1] !== last) edges.push({ cycle: e.cycle, code: (last = e.drives[D1]) });
    }
    expect(edges).toEqual([
      { cycle: writeCycle(0), code: 'L' },
      { cycle: writeCycle(5), code: 'H' },
      ...frameEdges(0x55, start, bit),
      { cycle: start + 10 * bit, code: 'L' },
    ]);
    expect(serial).toEqual([0x55, 0x41]);
    expect(uno.serialBaud('usart0')).toBeNull();
  });

  it('honours 7 data bits, even parity and 2 stop bits', () => {
    const bit = BAUD_115200.bit;
    // UCSRC: UPM1 (even parity), USBS (2 stop bits), UCSZ = 2 (7 bits).
    const ucsrc = 0x20 | 0x08 | 0x04;
    const uno = new UnoEmulator(writes([...baudWrites(BAUD_115200), [UCSRC, ucsrc], [UCSRB, TXEN], [UDR, 0x83], [UDR, 0x01]]));
    const edges = d1Edges(uno, 30 * bit, 333).slice(1);
    // 0x83 -> 7 bits 0000011, ones = 2 -> parity 0. Levels: S0 1 1 0 0 0 0 0 P0 1 1 (11 symbols).
    // 0x01 -> 1 one -> parity 1. Levels: S0 1 0 0 0 0 0 0 P1 1 1.
    const s = writeCycle(5);
    const t = s + 11 * bit;
    expect(edges).toEqual([
      { cycle: s, code: 'L' },
      { cycle: s + 1 * bit, code: 'H' },
      { cycle: s + 3 * bit, code: 'L' },
      { cycle: s + 9 * bit, code: 'H' },
      { cycle: t, code: 'L' },
      { cycle: t + 1 * bit, code: 'H' },
      { cycle: t + 2 * bit, code: 'L' },
      { cycle: t + 8 * bit, code: 'H' },
    ]);
  });

  it('a watchdog reset in the middle of a frame drops the frame: d1 is an input again', () => {
    // Watchdog on at 16 ms, then a very slow frame (UBRR 4095: 65536 cycles a bit, ~41 ms a frame).
    const program = writes([[0x60, 0x18], [0x60, 0x08], [UBRRH, 0x0f], [UBRRL, 0xff], [UCSRB, TXEN], [UDR, 0x00]]);
    const uno = new UnoEmulator(program);
    const edges = d1Edges(uno, 0.02 * UNO_CLOCK_HZ, 16_000);
    expect(uno.watchdogResets).toBe(1);
    const reset = edges.find((e) => e.code === 'Z')!;
    expect(reset.cycle / UNO_CLOCK_HZ).toBeGreaterThan(0.015);
    // Boot 1: H (TXEN), L (start bit, 0x00 stays low). Reset: Z. Boot 2 starts the same, shifted.
    const boot = [{ cycle: writeCycle(4), code: 'H' }, { cycle: writeCycle(5), code: 'L' }];
    expect(edges).toEqual([...boot, reset, ...boot.map((e) => ({ ...e, cycle: e.cycle + reset.cycle }))]);
  });

  it('Blink (a real sketch) puts its Serial text on d1 at 9600 baud', () => {
    const uno = new UnoEmulator(parseIntelHex(BLINK_HEX, 32 * 1024).bytes);
    let serial: number[] = [];
    const edges: Edge[] = [];
    let last = uno.drives()[D1];
    while (uno.cycles < 0.05 * UNO_CLOCK_HZ) {
      const r = uno.run(UNO_CLOCK_HZ / 1000);
      serial = [...serial, ...(r.serial.usart0 ?? [])];
      for (const e of r.events) if (e.drives[D1] !== last) edges.push({ cycle: e.cycle, code: (last = e.drives[D1]) });
    }
    expect(String.fromCharCode(...serial)).toBe('Blink: LED on pin 13\r\nLED on\r\n');
    expect(edges[0].code).toBe('H'); // Serial.begin
    expect(decode(edges.slice(1), BAUD_9600.bit)).toEqual(serial);
    expect(uno.serialBaud('usart0')).toBe(9615);
  });

  it('the mixed-signal bridge handles a continuous 115200 stream cheaply (two pin setups)', () => {
    // Sends 0xFF forever (start bit low, 9 bits high): an LED on d1 is on ~90 % of the time.
    const { bytes, errors } = assemble(`
      ldi r16, 0
      sts ${UBRRH}, r16
      ldi r16, 16
      sts ${UBRRL}, r16
      ldi r16, ${U2X}
      sts ${UCSRA}, r16
      ldi r16, ${TXEN}
      sts ${UCSRB}, r16
      ldi r17, 0xff
    wait:
      lds r16, ${UCSRA}
      sbrs r16, 5        ; UDRE
      rjmp wait
      sts ${UDR}, r17
      rjmp wait
    `);
    expect(errors).toEqual([]);
    const uno = new UnoEmulator(bytes);
    const circuit = (from: string, ohms = 220): SimInput => ({
      components: [
        { id: 1, model: { kind: 'board', rails: { ...UNO_ELECTRICAL.rails }, io: {} } },
        { id: 2, model: { kind: 'resistor', ohms } },
        { id: 3, model: RED_LED },
      ],
      links: [
        [{ part: 1, pin: from }, { part: 2, pin: 'a' }],
        [{ part: 2, pin: 'b' }, { part: 3, pin: 'anode' }],
        [{ part: 3, pin: 'cathode' }, { part: 1, pin: 'gnd' }],
      ],
    });
    let solves = 0;
    const ms = new MixedSignal((input) => (solves++, solveCircuit(input)));
    ms.setCircuit(circuit('d1'), [{ partId: 1, io: UNO_IO, electrical: UNO_ELECTRICAL, emulator: uno, running: true }]);
    const t0 = performance.now();
    const serial = ms.advance(0.1);
    const ms100 = performance.now() - t0;
    const sent = serial.get(1)!.usart0.length;
    expect(sent).toBeGreaterThan(1100); // ~11.5 kB/s
    expect(solves).toBeLessThanOrEqual(4); // Z at start, H idle, L start bit
    const on = new MixedSignal();
    on.setCircuit(circuit('5v', 220 + UNO_ELECTRICAL.outputOhms), []); // the same as d1 held high
    const ratio = ms.result!.parts[3].current / on.result!.parts[3].current;
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(0.95);
    expect(ms100).toBeLessThan(5000); // generous: 100 ms of simulated time
  });
});
