// Idle skipping with real Arduino sketches (compiled with the wasm tools in
// Node, skipped without a toolchain like peripherals.tools.test.ts): 5
// simulated seconds with idle skipping 'off' and 'spin' must record the same
// pin events (cycle stamps and drive codes), serial bytes per slice, slice
// ends, final data space (registers, I/O, SRAM), PC and timer state. The
// sketches that wait in delay() must also run at least 5x faster.
import { describe, expect, it } from 'vitest';
import { compileSketch } from '../../build/wasm/pipeline';
import { BOARD_PROFILES } from '../../build/wasm/profiles';
import { findToolchain, sharedNodeRunner } from '../../build/wasm/node/toolchain';
import { parseIntelHex } from '../hex';
import { expectSame, pinEvents, record, serialText, type Recording, type Step } from './idleskip.testkit';

const toolchain = findToolchain();
const T = 300_000;
const SECONDS = 5;

async function compile(sketch: string): Promise<Uint8Array> {
  const r = await compileSketch({ files: { 'main.ino': sketch }, profileId: 'uno' }, BOARD_PROFILES.uno, sharedNodeRunner(toolchain.dir!));
  if (!r.ok) throw new Error(`build failed:\n${r.errors.join('\n')}`);
  return parseIntelHex(r.hex, 32 * 1024).bytes;
}

/** Full run and skipping run of a sketch, compared; returns both. */
async function compare(sketch: string, steps: Step[] = []): Promise<{ full: Recording; spin: Recording }> {
  const flash = await compile(sketch);
  const full = record(flash, 'off', SECONDS, steps);
  const spin = record(flash, 'spin', SECONDS, steps);
  expectSame(spin, full);
  return { full, spin };
}

/** Host time of the skipping run (best of two) against the full run. */
function expectFaster(full: Recording, spin: Recording, sketch: Uint8Array | null, factor: number): void {
  let best = spin.hostMs;
  if (sketch) best = Math.min(best, record(sketch, 'spin', SECONDS).hostMs);
  expect(full.hostMs / best, `full ${full.hostMs.toFixed(0)} ms, skipping ${best.toFixed(0)} ms`).toBeGreaterThanOrEqual(factor);
}

const BLINK = `void setup() { pinMode(13, OUTPUT); }
void loop() { digitalWrite(13, HIGH); delay(500); digitalWrite(13, LOW); delay(500); }
`;

const PRINT = `void setup() { Serial.begin(9600); }
void loop() { Serial.print("t="); Serial.println(millis()); delay(1000); }
`;

const FADE = `void setup() { pinMode(9, OUTPUT); }
void loop() {
  static int b = 0, d = 5;
  analogWrite(9, b);
  b += d;
  if (b <= 0 || b >= 255) d = -d;
  delay(10);
}
`;

const MILLIS = `unsigned long last = 0;
void setup() { pinMode(13, OUTPUT); }
void loop() {
  if (millis() - last >= 250) { last += 250; digitalWrite(13, !digitalRead(13)); }
}
`;

// Timer1 CTC at 1 kHz with an ISR counting, an external interrupt on d2
// counting falling edges (driven by the test), and a report every second.
const ISR_COUNTER = `volatile unsigned long ticks = 0;
volatile unsigned int edges = 0;
ISR(TIMER1_COMPA_vect) { ticks++; if (ticks % 250 == 0) PINB = _BV(5); }
void onEdge() { edges++; }
void setup() {
  Serial.begin(115200);
  pinMode(13, OUTPUT);
  pinMode(2, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(2), onEdge, FALLING);
  noInterrupts();
  TCCR1A = 0; TCCR1B = _BV(WGM12) | _BV(CS11) | _BV(CS10); OCR1A = 249; TIMSK1 = _BV(OCIE1A);
  interrupts();
}
void loop() {
  static unsigned long last = 0;
  noInterrupts(); unsigned long t = ticks; unsigned int e = edges; interrupts();
  if (t - last >= 1000) { last = t; Serial.print(t); Serial.print(' '); Serial.println(e); }
}
`;

// A register countdown loop: nothing to skip, and nothing may be skipped wrongly.
const MICROS = `void setup() { pinMode(13, OUTPUT); }
void loop() { PORTB ^= _BV(5); delayMicroseconds(100); }
`;

// Busy-waits on an input that the test changes between slices.
const PIN_WAIT = `void setup() { pinMode(13, OUTPUT); pinMode(2, INPUT); }
void loop() {
  while (digitalRead(2) == HIGH) {}
  digitalWrite(13, HIGH);
  while (digitalRead(2) == LOW) {}
  digitalWrite(13, LOW);
}
`;

const ECHO = `void setup() { Serial.begin(115200); pinMode(13, OUTPUT); }
void loop() {
  if (Serial.available()) {
    char c = Serial.read();
    Serial.write(c + 1);
    digitalWrite(13, !digitalRead(13));
  }
}
`;

const WATCHDOG = `#include <avr/wdt.h>
void setup() { Serial.begin(115200); Serial.println("boot"); wdt_enable(WDTO_250MS); }
void loop() { delay(100); Serial.print('.'); }
`;

const SLEEP = `#include <avr/sleep.h>
ISR(TIMER1_COMPA_vect) { PINB = _BV(5); }
void setup() {
  pinMode(13, OUTPUT);
  noInterrupts();
  TCCR1A = 0; TCCR1B = _BV(WGM12) | _BV(CS12); OCR1A = 31249; TIMSK1 = _BV(OCIE1A);
  interrupts();
  set_sleep_mode(SLEEP_MODE_IDLE);
}
void loop() { sleep_mode(); }
`;

describe.skipIf(!toolchain.dir)(`idle skipping with compiled sketches (${toolchain.reason})`, () => {
  it('Blink with delay(500): same outputs, at least 5x faster', async () => {
    const flash = await compile(BLINK);
    const full = record(flash, 'off', SECONDS);
    const spin = record(flash, 'spin', SECONDS);
    expectSame(spin, full);
    expect(pinEvents(full).length).toBe(11); // pinMode, then 10 changes
    expectFaster(full, spin, flash, 5);
  }, T);

  it('Serial.print + delay(1000): same bytes in the same slices, same d1 edges, at least 5x faster', async () => {
    const flash = await compile(PRINT);
    const full = record(flash, 'off', SECONDS);
    const spin = record(flash, 'spin', SECONDS);
    expectSame(spin, full);
    expect(serialText(full)).toMatch(/^t=0\r\nt=999\r\nt=1999\r\nt=3000\r\n/);
    expectFaster(full, spin, flash, 5);
  }, T);

  it('analogWrite fade with delay(10): same PWM edges', async () => {
    const { full, spin } = await compare(FADE);
    expect(pinEvents(full).length).toBeGreaterThan(1000);
    expect(spin.skippedCycles).toBeGreaterThan(0);
  }, T);

  it('millis() polling blink: same edges, mostly skipped', async () => {
    const { full, spin } = await compare(MILLIS);
    expect(pinEvents(full).length).toBe(20);
    expect(spin.skippedCycles / spin.cycles).toBeGreaterThan(0.5);
  }, T);

  it('Timer1 ISR counter and attachInterrupt on d2: same counts and edges', async () => {
    const steps: Step[] = [{ at: 0, inputs: { d2: true } }];
    for (let k = 1; k <= 20; k++) steps.push({ at: 200 * k + 3, inputs: { d2: k % 2 === 0 } });
    const { full } = await compare(ISR_COUNTER, steps);
    expect(serialText(full)).toMatch(/^1000 \d+\r\n2000 \d+\r\n3000 \d+\r\n4000 10\r\n/);
  }, T);

  it('delayMicroseconds(100) loop: same 100 us edges', async () => {
    const { full } = await compare(MICROS);
    const edges = pinEvents(full);
    expect(edges.length).toBeGreaterThan(40_000);
  }, T);

  it('busy-wait on an input: the change set between slices takes effect at the same cycle', async () => {
    const steps: Step[] = [{ at: 0, inputs: { d2: true } }];
    for (let k = 1; k <= 8; k++) steps.push({ at: 500 * k + 17, inputs: { d2: k % 2 === 0 } });
    const { full } = await compare(PIN_WAIT, steps);
    expect(pinEvents(full).length).toBe(9); // pinMode, then 8 changes
  }, T);

  it('Serial echo reading in loop(): bytes queued by sendSerial arrive and are answered at the same cycles', async () => {
    const steps: Step[] = [{ at: 1200, serial: 'abc' }, { at: 3400, serial: 'Hello' }];
    const { full, spin } = await compare(ECHO, steps);
    expect(serialText(full)).toBe('bcdIfmmp');
    expect(spin.skippedCycles).toBeGreaterThan(0);
  }, T);

  it('watchdog resets: the same resets at the same cycles', async () => {
    const { full, spin } = await compare(WATCHDOG);
    expect(full.resets).toBeGreaterThanOrEqual(15);
    expect(serialText(full)).toContain('boot\r\n..boot');
    expect(spin.skippedCycles).toBeGreaterThan(0);
  }, T);

  it("sleep loop: 'sleep' and 'spin' both skip it with the same outputs", async () => {
    const flash = await compile(SLEEP);
    const full = record(flash, 'off', SECONDS);
    for (const mode of ['sleep', 'spin'] as const) {
      const skip = record(flash, mode, SECONDS);
      expectSame(skip, full);
      expect(skip.skippedCycles / skip.cycles, mode).toBeGreaterThan(0.5);
    }
    expect(pinEvents(full).length).toBe(11); // pinMode, then 10 toggles
  }, T);
});
