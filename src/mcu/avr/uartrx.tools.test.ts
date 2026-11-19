// Serial input with a compiled sketch: Serial.available() / Serial.read()
// see the bytes from sendSerial. Skipped (reason in the suite name) when no
// toolchain is found, like peripherals.tools.test.ts.
import { describe, expect, it } from 'vitest';
import { compileSketch } from '../../build/wasm/pipeline';
import { BOARD_PROFILES } from '../../build/wasm/profiles';
import { findToolchain, sharedNodeRunner } from '../../build/wasm/node/toolchain';
import { parseIntelHex } from '../hex';
import { UNO_CLOCK_HZ, UnoEmulator } from './uno';

const toolchain = findToolchain();
const T = 120_000;

const ECHO = `void setup() {
  Serial.begin(115200);
  Serial.println("ready");
}
void loop() {
  while (Serial.available() > 0) {
    int c = Serial.read();
    Serial.print('[');
    Serial.write((uint8_t)c);
    Serial.print(']');
  }
}
`;

async function echoSketch(): Promise<UnoEmulator> {
  const r = await compileSketch({ files: { 'main.ino': ECHO }, profileId: 'uno' }, BOARD_PROFILES.uno, sharedNodeRunner(toolchain.dir!));
  if (!r.ok) throw new Error(`build failed:\n${r.errors.join('\n')}`);
  return new UnoEmulator(parseIntelHex(r.hex, 32 * 1024).bytes);
}

function serialFor(uno: UnoEmulator, seconds: number): string {
  let serial = '';
  const end = uno.cycles + seconds * UNO_CLOCK_HZ;
  while (uno.cycles < end) serial += String.fromCharCode(...(uno.run(UNO_CLOCK_HZ / 1000).serial.usart0 ?? []));
  return serial;
}

const codes = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

describe.skipIf(!toolchain.dir)(`Serial.read() with a compiled sketch (${toolchain.reason})`, () => {
  it('echoes "hi\\n" back with the prefix', async () => {
    const uno = await echoSketch();
    expect(serialFor(uno, 0.01)).toBe('ready\r\n');
    uno.sendSerial('usart0', codes('hi\n'));
    expect(serialFor(uno, 0.01)).toBe('[h][i][\n]');
  }, T);

  it('a burst of 20 bytes arrives complete and in order', async () => {
    const uno = await echoSketch();
    serialFor(uno, 0.01);
    const burst = 'ABCDEFGHIJKLMNOPQRST';
    uno.sendSerial('usart0', codes(burst));
    expect(serialFor(uno, 0.02)).toBe([...burst].map((c) => `[${c}]`).join(''));
  }, T);
});
