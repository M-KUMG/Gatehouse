import { describe, expect, it } from 'vitest';
import { I2cWire, spiByteEdges, type LineEdge, type LineName } from '../mcu/avr/lineedges';
import { BusStream } from './busstream';
import { signalOf, type LogicSignal } from './decoders';
import { I2C_DECODER, decodeI2c, type I2cItem } from './i2c';
import { DEFAULT_SPI, SPI_DECODER, decodeSpi, type SpiMode, type SpiSettings } from './spi';

const CLOCK = 16_000_000;
const BIT = 160; // cycles per bit time: 100 kHz at 16 MHz

/** A line from the edges that touch it, the way the recorder stores it: index 0 is the starting level. */
function lineOf(edges: readonly LineEdge[], line: LineName, initial: boolean, endCycle: number): LogicSignal {
  const mine = edges.filter((e) => e.line === line);
  return signalOf([0, ...mine.map((e) => e.cycle / CLOCK)], [initial, ...mine.map((e) => e.high ?? true)], endCycle / CLOCK);
}

/** The edges of a series of I2C operations back to back, and the cycle after the last one. */
function i2c(ops: ('S' | 'P' | [number, boolean])[]): { edges: LineEdge[]; end: number } {
  const wire = new I2cWire();
  const edges: LineEdge[] = [];
  let t = 100;
  for (const op of ops) {
    if (op === 'S') edges.push(...wire.start(t, BIT)), (t += BIT);
    else if (op === 'P') edges.push(...wire.stop(t, BIT)), (t += BIT);
    else edges.push(...wire.byte(t, BIT, op[0], op[1])), (t += 9 * BIT);
  }
  return { edges, end: t + 2 * BIT };
}

const addr = (a: number, read: boolean): number => (a << 1) | (read ? 1 : 0);
const signals = (r: { edges: LineEdge[]; end: number }): [LogicSignal, LogicSignal] => [lineOf(r.edges, 'sda', true, r.end), lineOf(r.edges, 'scl', true, r.end)];

describe('I2C wire and decoder', () => {
  it('decodes a write: START, address, data bytes with ACKs, STOP', () => {
    const [sda, scl] = signals(i2c(['S', [addr(0x3c, false), true], [0xa5, true], [0x0f, true], 'P']));
    const { items, next } = decodeI2c(sda, scl);
    expect(items.map((i) => i.text)).toEqual(['S', '0x3C W', '0xA5', '0x0F', 'P']);
    expect(items.map((i) => i.kind)).toEqual(['start', 'address', 'data', 'data', 'stop']);
    expect(items.every((i) => i.error === null && (i.kind === 'start' || i.kind === 'stop' || i.ack === true))).toBe(true);
    expect(items[1]).toMatchObject({ value: 0x3c, read: false });
    for (let k = 1; k < items.length; k++) expect(items[k].start).toBeGreaterThanOrEqual(items[k - 1].start);
    // A byte lasts nine bit times.
    expect((items[2].end - items[2].start) * CLOCK).toBeCloseTo(9 * BIT, -1);
    expect(next).toBeCloseTo(sda.end, 9);
  });

  it('shows a repeated START and a read, where the last byte the master reads is NACKed without an error', () => {
    const [sda, scl] = signals(i2c(['S', [addr(0x50, false), true], [0x20, true], 'S', [addr(0x50, true), true], [0x7e, false], 'P']));
    const { items } = decodeI2c(sda, scl);
    expect(items.map((i) => i.text)).toEqual(['S', '0x50 W', '0x20', 'Sr', '0x50 R', '0x7E NACK', 'P']);
    expect(items[5]).toMatchObject({ kind: 'data', read: true, ack: false, error: null });
  });

  it('flags an address nobody answers and a refused written byte', () => {
    const [sda, scl] = signals(i2c(['S', [addr(0x51, false), false], 'P', 'S', [addr(0x50, false), true], [0x10, false], 'P']));
    const { items } = decodeI2c(sda, scl);
    expect(items.map((i) => i.text)).toEqual(['S', '0x51 W NACK', 'P', 'S', '0x50 W', '0x10 NACK', 'P']);
    expect(items[1].error).toBe('no ack');
    expect(items[5].error).toBe('nack');
  });

  it('a transfer that is still open is returned so far, and read again from its START', () => {
    const full = i2c(['S', [addr(0x3c, false), true], [0xa5, true], 'P']);
    const [sdaAll, sclAll] = signals(full);
    const cut = (full.edges.find((e) => e.line === 'scl' && e.cycle > 100 + BIT + 9 * BIT + 4 * BIT)?.cycle ?? 0) + 1; // inside the data byte
    const part = (line: LineName): LogicSignal => lineOf(full.edges.filter((e) => e.cycle <= cut), line, true, cut);
    const first = decodeI2c(part('sda'), part('scl'));
    expect(first.items.map((i) => i.text)).toEqual(['S', '0x3C W']);
    expect(first.next).toBeCloseTo(100 / CLOCK + (BIT * 0.5) / CLOCK, 9); // the START
    const rest = decodeI2c(sdaAll, sclAll, first.next);
    expect(rest.items.map((i) => i.text)).toEqual(['S', '0x3C W', '0xA5', 'P']);
    expect(rest.next).toBeCloseTo(sdaAll.end, 9);
  });

  it('BusStream gives the same items however the trace grows (cut anywhere, even mid-byte)', () => {
    const full = i2c(['S', [addr(0x3c, false), true], [0xa5, true], 'S', [addr(0x3c, true), true], [0x11, true], [0x22, false], 'P', 'S', [addr(0x70, false), true], 'P']);
    const expected = decodeI2c(...signals(full)).items;
    for (const step of [37, 160, 1000, 4321]) {
      const stream = new BusStream(I2C_DECODER);
      for (let end = step; end < full.end + step; end += step) {
        const e = Math.min(end, full.end);
        const part = (line: LineName): LogicSignal => lineOf(full.edges.filter((x) => x.cycle <= e), line, true, e);
        stream.update({ signals: [part('sda'), part('scl')], generation: 0 }, {});
      }
      expect(stream.items.map((i) => i.text), `step ${step}`).toEqual(expected.map((i) => i.text));
      expect(stream.items.map((i) => i.start), `step ${step}`).toEqual(expected.map((i) => i.start));
    }
  });

  it('BusStream starts over when the trace was cleared', () => {
    const [sda, scl] = signals(i2c(['S', [addr(0x3c, false), true], 'P']));
    const stream = new BusStream(I2C_DECODER);
    stream.update({ signals: [sda, scl], generation: 0 }, {});
    expect(stream.items).toHaveLength(3);
    const empty = [signalOf([0], [true], 0), signalOf([0], [true], 0)];
    stream.update({ signals: empty, generation: 1 }, {});
    expect(stream.items).toEqual([]);
  });

  it('ignores a glitchy line without a START (no items, no crash)', () => {
    const sda = signalOf([0, 1e-5, 2e-5], [true, false, true], 1e-4);
    const scl = signalOf([0], [false], 1e-4);
    expect(decodeI2c(sda, scl).items).toEqual([]);
  });
});

// ---- SPI ----

interface SpiRun {
  edges: LineEdge[];
  /** Cycles each byte takes and where each starts. */
  starts: number[];
  end: number;
}

function spi(bytes: [tx: number, rx: number][], mode: SpiMode, lsbFirst: boolean, perByte = 128, pause = 300): SpiRun {
  const cpol = mode >= 2;
  const cpha = mode % 2 === 1;
  const level = { sck: cpol as boolean | null, mosi: null as boolean | null, miso: null as boolean | null };
  const edges: LineEdge[] = [];
  const starts: number[] = [];
  let t = 1000;
  for (const [tx, rx] of bytes) {
    starts.push(t);
    const e = spiByteEdges({ t0: t, cycles: perByte, tx, rx, cpol, cpha, lsbFirst }, level);
    for (const x of e) level[x.line as 'sck' | 'mosi' | 'miso'] = x.high;
    edges.push(...e);
    t += perByte + pause;
  }
  return { edges, starts, end: t + 500 };
}

const spiLines = (r: SpiRun, mode: SpiMode, cs: LogicSignal | null = null, miso = true) => ({
  mosi: lineOf(r.edges, 'mosi', false, r.end),
  miso: miso ? lineOf(r.edges, 'miso', true, r.end) : null,
  sck: lineOf(r.edges, 'sck', mode >= 2, r.end),
  cs,
});

describe('SPI wire and decoder', () => {
  const sent: [number, number][] = [[0x9f, 0xff], [0x00, 0xc2], [0xa5, 0x5a], [0x01, 0x80]];

  for (const mode of [0, 1, 2, 3] as SpiMode[]) {
    for (const lsbFirst of [false, true]) {
      it(`mode ${mode}, ${lsbFirst ? 'LSB' : 'MSB'} first: MOSI and MISO come back as sent`, () => {
        const run = spi(sent, mode, lsbFirst);
        const settings: SpiSettings = { ...DEFAULT_SPI, mode, lsbFirst };
        const { items, next } = decodeSpi(spiLines(run, mode), settings);
        expect(items.map((i) => [i.mosi, i.miso])).toEqual(sent);
        expect(items[0].text).toBe('0x9F · 0xFF');
        expect(next).toBeCloseTo(run.end / CLOCK, 9);
        // Each box covers its byte's eight bits.
        items.forEach((w, k) => {
          expect(w.start * CLOCK).toBeCloseTo(run.starts[k], -1);
          expect((w.end - w.start) * CLOCK).toBeCloseTo(128, -1);
        });
      });
    }
  }

  it('a wrong bit order decodes something else (so the setting matters)', () => {
    const run = spi(sent, 0, false);
    const { items } = decodeSpi(spiLines(run, 0), { ...DEFAULT_SPI, lsbFirst: true });
    expect(items.map((i) => i.mosi)).toEqual([0xf9, 0x00, 0xa5, 0x80]); // 0x9F, 0x00, 0xA5, 0x01 read backwards
  });

  it('works with only MOSI, or only MISO', () => {
    const run = spi(sent, 0, false);
    const onlyMosi = decodeSpi({ ...spiLines(run, 0), miso: null }, DEFAULT_SPI).items;
    expect(onlyMosi.map((i) => [i.mosi, i.miso, i.text])).toEqual(sent.map(([tx]) => [tx, null, `0x${tx.toString(16).toUpperCase().padStart(2, '0')}`]));
    const onlyMiso = decodeSpi({ ...spiLines(run, 0), mosi: null }, DEFAULT_SPI).items;
    expect(onlyMiso.map((i) => [i.mosi, i.miso])).toEqual(sent.map(([, rx]) => [null, rx]));
  });

  it('with a chip select, only asserted words count, and a word cut by CS going high is dropped', () => {
    const run = spi(sent, 0, false);
    const t = (k: number): number => run.starts[k] / CLOCK;
    // CS low around words 1 and 2 only; it goes high again in the middle of word 3.
    const cs = signalOf([0, t(1) - 1e-6, t(3) + 3e-7], [true, false, true], run.end / CLOCK);
    const { items } = decodeSpi(spiLines(run, 0, cs), DEFAULT_SPI);
    expect(items.map((i) => i.mosi)).toEqual([0x00, 0xa5]);
    // Active-high select.
    const high = signalOf([0, t(1) - 1e-6, t(3) + 3e-7], [false, true, false], run.end / CLOCK);
    expect(decodeSpi(spiLines(run, 0, high), { ...DEFAULT_SPI, csActiveLow: false }).items.map((i) => i.mosi)).toEqual([0x00, 0xa5]);
  });

  it('an unfinished word is not reported, and the next call starts at it', () => {
    const run = spi([[0x12, 0x34], [0xab, 0xcd]], 0, false);
    const cut = run.starts[1] + 64; // half way through the second byte
    const part = (line: LineName, initial: boolean): LogicSignal => lineOf(run.edges.filter((e) => e.cycle <= cut), line, initial, cut);
    const lines = { mosi: part('mosi', false), miso: part('miso', true), sck: part('sck', false), cs: null };
    const first = decodeSpi(lines, DEFAULT_SPI);
    expect(first.items.map((i) => i.mosi)).toEqual([0x12]);
    expect(first.next * CLOCK).toBeGreaterThan(run.starts[1]);
    const rest = decodeSpi(spiLines(run, 0), DEFAULT_SPI, first.next);
    expect(rest.items.map((i) => i.mosi)).toEqual([0xab]);
  });

  it('BusStream gives the same words however the trace grows', () => {
    const run = spi(sent, 3, true);
    const settings: SpiSettings = { ...DEFAULT_SPI, mode: 3, lsbFirst: true };
    for (const step of [50, 333, 2000]) {
      const stream = new BusStream(SPI_DECODER);
      for (let end = step; end < run.end + step; end += step) {
        const e = Math.min(end, run.end);
        const part = (line: LineName, initial: boolean): LogicSignal => lineOf(run.edges.filter((x) => x.cycle <= e), line, initial, e);
        stream.update({ signals: [part('mosi', false), part('miso', true), part('sck', true), null], generation: 0 }, settings);
      }
      expect(stream.items.map((i) => [i.mosi, i.miso]), `step ${step}`).toEqual(sent);
    }
  });

  it('without a chip select, a pause in the clock drops a half word', () => {
    // Four clocks, a long pause, then a whole byte (all ones): only the byte counts.
    const times: number[] = [0];
    const lv: boolean[] = [false];
    let u = 1e-5;
    const clocks = (n: number): void => {
      for (let k = 0; k < n; k++) {
        times.push(u + 1e-6, u + 2e-6);
        lv.push(true, false);
        u += 2e-6;
      }
    };
    clocks(4);
    u += 1e-3;
    clocks(8);
    const clock = signalOf(times, lv, u + 1e-5);
    const data = signalOf([0], [true], u + 1e-5);
    const { items } = decodeSpi({ mosi: data, miso: null, sck: clock, cs: null }, DEFAULT_SPI);
    expect(items.map((i) => i.mosi)).toEqual([0xff]);
  });
});

describe('the decoders as plug-ins', () => {
  it('say which lines they read, and which may be left out', () => {
    expect(I2C_DECODER.lines).toEqual(['SDA', 'SCL']);
    expect(SPI_DECODER.lines).toEqual(['MOSI', 'MISO', 'SCK', 'CS']);
    expect(SPI_DECODER.optional).toEqual([0, 1, 3]);
  });

  it('have the right item types', () => {
    const item: I2cItem = { kind: 'stop', text: 'P', start: 0, end: 0, value: 0, error: null, ack: null, read: null };
    expect(item.kind).toBe('stop');
  });
});
