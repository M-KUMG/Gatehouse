// Tool-backed end-to-end test of the logic analyzer's bus decoders: real Wire and
// SPI sketches compiled with the wasm tools, run in our Uno emulator, their pins
// recorded the way the analyzer does (pin events -> edges) and decoded by the
// I2C and SPI decoders. Skipped (with the reason in the suite name) when no
// toolchain is found, like peripherals.tools.test.ts.
import { describe, expect, it } from 'vitest';
import { compileSketch } from '../../build/wasm/pipeline';
import { BOARD_PROFILES } from '../../build/wasm/profiles';
import { findToolchain, sharedNodeRunner } from '../../build/wasm/node/toolchain';
import { signalOf, type LogicSignal } from '../../scope/decoders';
import { decodeI2c } from '../../scope/i2c';
import { DEFAULT_SPI, decodeSpi, type SpiSettings } from '../../scope/spi';
import { parseIntelHex } from '../hex';
import type { I2cDevice } from './i2c';
import { UNO_CLOCK_HZ, UNO_IO, UnoEmulator } from './uno';

const toolchain = findToolchain();
const T = 120_000;

async function compile(sketch: string): Promise<Uint8Array> {
  const r = await compileSketch({ files: { 'main.ino': sketch }, profileId: 'uno' }, BOARD_PROFILES.uno, sharedNodeRunner(toolchain.dir!));
  if (!r.ok) throw new Error(`build failed:\n${r.errors.join('\n')}`);
  return parseIntelHex(r.hex, 32 * 1024).bytes;
}

/** Run for `seconds` and record the pins as logic signals (high / pull-up / hi-Z read as 1, like the recorder). */
function record(uno: UnoEmulator, seconds: number, pins: string[]): LogicSignal[] {
  const idx = pins.map((id) => UNO_IO.findIndex((p) => p.id === id));
  const high = (code: string | undefined): boolean => code !== 'L';
  const initial = uno.drives();
  const last = idx.map((i) => high(initial[i]));
  const times = idx.map(() => [0]);
  const levels = idx.map((_, k) => [last[k]]);
  const end = uno.cycles + seconds * UNO_CLOCK_HZ;
  while (uno.cycles < end) {
    for (const e of uno.run(UNO_CLOCK_HZ / 1000).events) {
      idx.forEach((i, k) => {
        const h = high(e.drives[i]);
        if (h === last[k]) return;
        last[k] = h;
        times[k].push(e.cycle / UNO_CLOCK_HZ);
        levels[k].push(h);
      });
    }
  }
  return idx.map((_, k) => signalOf(times[k], levels[k], uno.cycles / UNO_CLOCK_HZ));
}

class FakeEeprom implements I2cDevice {
  readonly mem = new Uint8Array(256);
  private pointer = 0;
  private first = false;
  constructor(readonly address = 0x50) {}
  start(read: boolean): void {
    this.first = !read;
  }
  write(byte: number): boolean {
    if (this.first) this.pointer = byte;
    else this.mem[this.pointer++ & 0xff] = byte;
    this.first = false;
    return true;
  }
  read(): number {
    return this.mem[this.pointer++ & 0xff];
  }
}

const WIRE = `#include <Wire.h>
void setup() {
  Wire.begin();
  Wire.beginTransmission(0x50); Wire.write(0x10); Wire.write(0x42); Wire.endTransmission();
  Wire.beginTransmission(0x50); Wire.write(0x20); Wire.endTransmission(false);
  Wire.requestFrom(0x50, 1);
  Wire.read();
  Wire.beginTransmission(0x51); Wire.endTransmission();
}
void loop() {}
`;

const SPI_MODE0 = `#include <SPI.h>
void setup() {
  SPI.begin();
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  SPI.transfer(0xA5);
  SPI.transfer(0x3C);
  SPI.endTransaction();
}
void loop() {}
`;

const SPI_MODE3_LSB = `#include <SPI.h>
void setup() {
  SPI.begin();
  SPI.beginTransaction(SPISettings(500000, LSBFIRST, SPI_MODE3));
  SPI.transfer(0x3C);
  SPI.endTransaction();
}
void loop() {}
`;

const SPI_CS = `#include <SPI.h>
void setup() {
  pinMode(10, OUTPUT); digitalWrite(10, HIGH);
  SPI.begin();
  SPI.beginTransaction(SPISettings(2000000, MSBFIRST, SPI_MODE0));
  digitalWrite(10, LOW);
  SPI.transfer(0x9F);
  SPI.transfer(0x00);
  digitalWrite(10, HIGH);
  SPI.endTransaction();
}
void loop() {}
`;

describe.skipIf(!toolchain.dir)(`logic analyzer bus decoding with compiled sketches (${toolchain.reason})`, () => {
  it('I2C: a Wire sketch decodes into START, addresses, bytes, ACK / NACK, repeated START and STOP', async () => {
    const uno = new UnoEmulator(await compile(WIRE));
    const eeprom = new FakeEeprom();
    eeprom.mem[0x20] = 0x7e;
    uno.i2c.attach(eeprom);
    const [sda, scl] = record(uno, 0.05, ['a4', 'a5']);
    const { items } = decodeI2c(sda, scl);
    expect(items.map((i) => i.text)).toEqual([
      'S', '0x50 W', '0x10', '0x42', 'P',
      'S', '0x50 W', '0x20', 'Sr', '0x50 R', '0x7E NACK', 'P',
      'S', '0x51 W NACK', 'P',
    ]);
    expect(items.filter((i) => i.error).map((i) => i.error)).toEqual(['no ack']); // only the empty address
    // Standard-speed timing: a byte takes nine bit times of 100 kHz (Wire's default), about 90 us.
    const data = items.find((i) => i.text === '0x42')!;
    expect(data.end - data.start).toBeCloseTo(90e-6, 5);
  }, T);

  it('SPI mode 0: both bytes come back with MOSI and MISO', async () => {
    const uno = new UnoEmulator(await compile(SPI_MODE0));
    uno.spi.setHandler((tx) => tx ^ 0xff);
    const [mosi, miso, sck] = record(uno, 0.02, ['d11', 'd12', 'd13']);
    const { items } = decodeSpi({ mosi, miso, sck, cs: null }, DEFAULT_SPI);
    expect(items.map((w) => [w.mosi, w.miso])).toEqual([[0xa5, 0x5a], [0x3c, 0xc3]]);
    expect(items[0].text).toBe('0xA5 · 0x5A');
    // 1 MHz clock: a word is 8 us.
    expect((items[0].end - items[0].start) * 1e6).toBeCloseTo(8, 0);
  }, T);

  it('SPI mode 3, LSB first, 500 kHz', async () => {
    const uno = new UnoEmulator(await compile(SPI_MODE3_LSB));
    uno.spi.setHandler(() => 0x81);
    const [mosi, miso, sck] = record(uno, 0.02, ['d11', 'd12', 'd13']);
    const settings: SpiSettings = { mode: 3, lsbFirst: true, csActiveLow: true };
    const { items } = decodeSpi({ mosi, miso, sck, cs: null }, settings);
    expect(items.map((w) => [w.mosi, w.miso])).toEqual([[0x3c, 0x81]]);
  }, T);

  it('SPI with a chip select on d10 (a plain pin the sketch drives)', async () => {
    const uno = new UnoEmulator(await compile(SPI_CS));
    uno.spi.setHandler(() => 0x12);
    const [mosi, miso, sck, cs] = record(uno, 0.02, ['d11', 'd12', 'd13', 'd10']);
    const { items } = decodeSpi({ mosi, miso, sck, cs }, DEFAULT_SPI);
    expect(items.map((w) => [w.mosi, w.miso])).toEqual([[0x9f, 0x12], [0x00, 0x12]]);
  }, T);
});
