// Idle-skip benchmark: host milliseconds per simulated second of a few
// programs, with idle skipping off, 'sleep' and 'spin'. Skipped in the
// normal `npm test`; run it with
//   GATEHOUSE_BENCH=1 npx vitest run src/mcu/avr/idleskip.bench.test.ts
// The compiled sketches need the toolchain (see peripherals.tools.test.ts);
// without it only the built-in Blink hex is measured. Runs 1 ms slices, like
// the mixed-signal bridge.
import { describe, it } from 'vitest';
import { compileSketch } from '../../build/wasm/pipeline';
import { BOARD_PROFILES } from '../../build/wasm/profiles';
import { findToolchain, sharedNodeRunner } from '../../build/wasm/node/toolchain';
import type { IdleSkipMode } from '../board';
import { parseIntelHex } from '../hex';
import { BLINK_HEX } from '../programs/blink';
import { UNO_CLOCK_HZ, UnoEmulator } from './uno';

const SECONDS = 3;
const MODES: IdleSkipMode[] = ['off', 'sleep', 'spin'];

const SKETCHES: Record<string, string> = {
  'Arduino Blink, delay(500)': `void setup() { pinMode(13, OUTPUT); }
void loop() { digitalWrite(13, HIGH); delay(500); digitalWrite(13, LOW); delay(500); }
`,
  'Serial.print + delay(1000)': `void setup() { Serial.begin(9600); }
void loop() { Serial.print("t="); Serial.println(millis()); delay(1000); }
`,
};

function measure(name: string, flash: Uint8Array): void {
  const cells: string[] = [];
  for (const mode of MODES) {
    const uno = new UnoEmulator(flash, { idleSkip: mode });
    const t0 = performance.now();
    while (uno.cycles < SECONDS * UNO_CLOCK_HZ) uno.run(UNO_CLOCK_HZ / 1000);
    const ms = (performance.now() - t0) / SECONDS;
    const skipped = uno.idleSkipStats.skippedCycles / uno.cycles;
    cells.push(`${mode} ${ms.toFixed(1).padStart(7)} ms/sim s (skipped ${(skipped * 100).toFixed(1)} %)`);
  }
  console.log(`${name.padEnd(30)} ${cells.join('   ')}`);
}

describe.skipIf(!process.env.GATEHOUSE_BENCH)('idle skip benchmark', () => {
  it('prints host ms per simulated second', async () => {
    measure('built-in Blink hex', parseIntelHex(BLINK_HEX, 32 * 1024).bytes);
    const toolchain = findToolchain();
    if (!toolchain.dir) {
      console.log(`compiled sketches skipped: ${toolchain.reason}`);
      return;
    }
    for (const [name, sketch] of Object.entries(SKETCHES)) {
      const r = await compileSketch({ files: { 'main.ino': sketch }, profileId: 'uno' }, BOARD_PROFILES.uno, sharedNodeRunner(toolchain.dir));
      if (!r.ok) throw new Error(r.errors.join('\n'));
      measure(name, parseIntelHex(r.hex, 32 * 1024).bytes);
    }
  }, 600_000);
});
