// Tool-backed tests of the ATmega328P's TWI (Wire), SPI and watchdog:
// real sketches compiled with the wasm tools in Node, run in our Uno
// emulator. Skipped (with the reason in the suite name) when no toolchain
// is found, like src/build/wasm/node/compile.tools.test.ts.
import { describe, expect, it } from 'vitest';
import { compileSketch } from '../../build/wasm/pipeline';
import { BOARD_PROFILES } from '../../build/wasm/profiles';
import { findToolchain, sharedNodeRunner } from '../../build/wasm/node/toolchain';
import { parseIntelHex } from '../hex';
import type { I2cDevice } from './i2c';
import { UNO_CLOCK_HZ, UnoEmulator } from './uno';

const toolchain = findToolchain();
const T = 120_000;

async function compile(sketch: string): Promise<string> {
  const r = await compileSketch({ files: { 'main.ino': sketch }, profileId: 'uno' }, BOARD_PROFILES.uno, sharedNodeRunner(toolchain.dir!));
  if (!r.ok) throw new Error(`build failed:\n${r.errors.join('\n')}`);
  return r.hex;
}

function serialFor(uno: UnoEmulator, seconds: number): string {
  let serial = '';
  const end = uno.cycles + seconds * UNO_CLOCK_HZ;
  while (uno.cycles < end) serial += String.fromCharCode(...(uno.run(UNO_CLOCK_HZ / 1000).serial.usart0 ?? []));
  return serial;
}

/** A 24C02-like EEPROM: first written byte is the address pointer, the rest are stored; reads auto-increment. */
class FakeEeprom implements I2cDevice {
  readonly mem = new Uint8Array(256);
  readonly log: string[] = [];
  private pointer = 0;
  private first = false;
  constructor(readonly address = 0x50) {}
  start(read: boolean): void {
    this.first = !read;
    this.log.push(read ? 'start-read' : 'start-write');
  }
  write(byte: number): boolean {
    this.log.push(`w${byte.toString(16)}`);
    if (this.first) this.pointer = byte;
    else this.mem[this.pointer++ & 0xff] = byte;
    this.first = false;
    return true;
  }
  read(): number {
    const v = this.mem[this.pointer++ & 0xff];
    this.log.push(`r${v.toString(16)}`);
    return v;
  }
  stop(): void {
    this.log.push('stop');
  }
}

const WIRE = `#include <Wire.h>
void setup() {
  Serial.begin(115200);
  Wire.begin();
  Wire.beginTransmission(0x50); Wire.write(0x10); Wire.write(0x42);
  Serial.print("w="); Serial.println(Wire.endTransmission());
  Wire.beginTransmission(0x50); Wire.write(0x20);
  Serial.print("p="); Serial.println(Wire.endTransmission(false));
  Serial.print("n="); Serial.println(Wire.requestFrom(0x50, 1));
  Serial.print("r="); Serial.println(Wire.read(), HEX);
  Wire.beginTransmission(0x51);
  Serial.print("x="); Serial.println(Wire.endTransmission());
}
void loop() {}
`;

const SPI_SKETCH = `#include <SPI.h>
void setup() {
  Serial.begin(115200);
  SPI.begin();
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  Serial.println(SPI.transfer(0xA5), HEX);
  SPI.endTransaction();
}
void loop() {}
`;

const WATCHDOG = `#include <avr/wdt.h>
void setup() {
  Serial.begin(115200);
  Serial.println("boot");
  wdt_enable(WDTO_15MS);
}
void loop() {}
`;

describe.skipIf(!toolchain.dir)(`ATmega328P TWI / SPI / watchdog with compiled sketches (${toolchain.reason})`, () => {
  it('Wire talks to an attached I2C device: writes, a repeated-start read, and a NACK for an empty address', async () => {
    const uno = new UnoEmulator(parseIntelHex(await compile(WIRE), 32 * 1024).bytes);
    const eeprom = new FakeEeprom();
    eeprom.mem[0x20] = 0x7e;
    uno.i2c.attach(eeprom);
    const serial = serialFor(uno, 0.05);
    // endTransmission: 0 success, 2 address NACK.
    expect(serial).toBe('w=0\r\np=0\r\nn=1\r\nr=7E\r\nx=2\r\n');
    expect(eeprom.mem[0x10]).toBe(0x42);
    expect(eeprom.log).toEqual(['start-write', 'w10', 'w42', 'stop', 'start-write', 'w20', 'start-read', 'r7e', 'stop']);
  }, T);

  it('SPI.transfer gets the reply from the handler, and 0xFF with no device', async () => {
    const bytes = parseIntelHex(await compile(SPI_SKETCH), 32 * 1024).bytes;
    const uno = new UnoEmulator(bytes);
    const seen: number[] = [];
    uno.spi.setHandler((tx) => {
      seen.push(tx);
      return tx ^ 0xff;
    });
    expect(serialFor(uno, 0.01)).toBe('5A\r\n');
    expect(seen).toEqual([0xa5]);
    expect(serialFor(new UnoEmulator(bytes), 0.01)).toBe('FF\r\n');
  }, T);

  it('the watchdog resets the chip after ~16 ms: the sketch boots again', async () => {
    const uno = new UnoEmulator(parseIntelHex(await compile(WATCHDOG), 32 * 1024).bytes);
    // Resets near 16 ms and 32 ms (128 kHz / 2048 after each wdt_enable), so 25 ms shows two boots.
    expect(serialFor(uno, 0.025)).toBe('boot\r\nboot\r\n');
    expect(uno.watchdogResets).toBe(1);
    expect(uno.cycles).toBeGreaterThanOrEqual(0.025 * UNO_CLOCK_HZ);
    serialFor(uno, 0.1);
    expect(uno.watchdogResets).toBeGreaterThanOrEqual(6);
  }, T);
});
