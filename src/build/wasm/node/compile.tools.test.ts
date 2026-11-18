// Tool-backed tests: the real startabit wasm tools in Node, through the
// compile core, and the result run in OUR Uno emulator. Skipped (with the
// reason in the suite name) when no toolchain is found: set
// GATEHOUSE_TOOLCHAIN to an unpacked toolchain folder, or fetch one into
// toolchain/ at the repository root.
import { describe, expect, it } from 'vitest';
import { parseIntelHex } from '../../../mcu/hex';
import { UNO_CLOCK_HZ, UNO_IO, UnoEmulator } from '../../../mcu/avr/uno';
import { MemoryObjectCache } from '../cache';
import { compileSketch, type CompileResult } from '../pipeline';
import { BOARD_PROFILES } from '../profiles';
import { BUNDLED_LIBRARIES, CORE_HEADERS, GCC_HEADERS, LIBC_HEADERS, SYSROOT } from '../sysroot';
import type { ToolName, ToolRequest, ToolRunner } from '../toolrunner';
import { DiskSysroot } from './noderunner';
import { findToolchain, sharedNodeRunner } from './toolchain';

const toolchain = findToolchain();
const T = 120_000;

/** Counts tool runs, on top of the shared Node runner. */
class CountingRunner implements ToolRunner {
  readonly runs: ToolName[] = [];
  constructor(private readonly inner: ToolRunner) {}
  get version(): string {
    return this.inner.version;
  }
  run(req: ToolRequest) {
    this.runs.push(req.tool);
    return this.inner.run(req);
  }
}

const BLINK = 'void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); delay(1000); digitalWrite(13, LOW); delay(1000); }\n';
const SERIAL = 'int n = 0;\nvoid setup() { Serial.begin(9600); }\nvoid loop() { Serial.print("tick "); Serial.println(n++); delay(500); }\n';
const MULTI = {
  'multi.ino': '#include "counter.h"\nvoid setup() { Serial.begin(9600); pinMode(13, OUTPUT); greet(); }\nvoid loop() {\n  counterStep();\n  Serial.println(describe(counterValue()));\n  blinkTimes(1);\n  delay(100);\n}\n',
  'helpers.ino': 'void greet() { Serial.println(F("multi-file sketch")); }\nvoid blinkTimes(int n) { for (int i = 0; i < n; i++) { digitalWrite(13, HIGH); delay(50); digitalWrite(13, LOW); delay(50); } }\n',
  'counter.h': '#pragma once\n#include <Arduino.h>\nvoid counterStep();\nint counterValue();\nString describe(int v);\n',
  'counter.cpp': '#include "counter.h"\nstatic int value = 0;\nvoid counterStep() { value += 3; }\nint counterValue() { return value; }\n',
  'describe.cpp': '#include "counter.h"\nString describe(int v) { return String("count=") + v; }\n',
};
const TIMER1_ISR = 'ISR(TIMER1_COMPA_vect) { PINB = _BV(5); }\nvoid setup() { pinMode(13, OUTPUT); TCCR1A = 0; TCCR1B = _BV(WGM12) | _BV(CS12); OCR1A = 31249; TIMSK1 = _BV(OCIE1A); }\nvoid loop() {}\n';

const D13 = UNO_IO.findIndex((p) => p.id === 'd13');

/** Run a hex in the Uno emulator for `seconds`: pin 13 edges (s) and the serial text. */
function runUno(hex: string, seconds: number): { edges: { t: number; level: string }[]; serial: string } {
  const uno = new UnoEmulator(parseIntelHex(hex, 32 * 1024).bytes);
  const edges: { t: number; level: string }[] = [];
  let serial = '';
  let last = uno.drives()[D13];
  for (let i = 0; i < seconds * 1000; i++) {
    const r = uno.run(UNO_CLOCK_HZ / 1000);
    for (const e of r.events) if (e.drives[D13] !== last) edges.push({ t: e.cycle / UNO_CLOCK_HZ, level: (last = e.drives[D13]) });
    serial += String.fromCharCode(...(r.serial.usart0 ?? []));
  }
  return { edges, serial };
}

function expectOk(r: CompileResult): asserts r is Extract<CompileResult, { ok: true }> {
  if (!r.ok) throw new Error(`build failed:\n${r.errors.join('\n')}`);
}

describe.skipIf(!toolchain.dir)(`browser compiler with the real tools (${toolchain.reason})`, () => {
  const runner = () => new CountingRunner(sharedNodeRunner(toolchain.dir!));
  const build = (files: Record<string, string>, opts: { profile?: string; runner?: ToolRunner; cache?: MemoryObjectCache; sketchName?: string } = {}) =>
    compileSketch({ files, profileId: opts.profile ?? 'uno', sketchName: opts.sketchName }, BOARD_PROFILES[opts.profile ?? 'uno'], opts.runner ?? runner(), { cache: opts.cache });

  it('compiles Blink to about 1 KB and it blinks pin 13 every second in the emulator', async () => {
    const r = await build({ 'Blink.ino': BLINK }, { sketchName: 'Blink' });
    expectOk(r);
    expect(r.flashBytes).toBeGreaterThan(900);
    expect(r.flashBytes).toBeLessThan(1200);
    expect(r.firmwareName).toBe('Blink.ino.hex');
    expect(r.messages.at(-1)?.message).toMatch(/^Sketch uses \d+ bytes \(3%\) of program storage space\. Maximum is 32256 bytes\. Global variables use 9 bytes/);
    const { edges } = runUno(r.hex, 4.5);
    const rises = edges.filter((e) => e.level === 'H').map((e) => e.t);
    const falls = edges.filter((e) => e.level === 'L' && e.t > 0.001).map((e) => e.t);
    expect(rises.length).toBe(3);
    expect(rises[0]).toBeLessThan(0.001);
    expect(rises[1] - rises[0]).toBeCloseTo(2, 2);
    expect(rises[2] - rises[1]).toBeCloseTo(2, 2);
    expect(falls[0] - rises[0]).toBeCloseTo(1, 2);
    expect(falls[1] - rises[1]).toBeCloseTo(1, 2);
  }, T);

  it('compiles the serial sketch and its text appears in the emulator', async () => {
    const r = await build({ 'main.ino': SERIAL });
    expectOk(r);
    expect(runUno(r.hex, 1.2).serial).toBe('tick 0\r\ntick 1\r\ntick 2\r\n');
  }, T);

  it('compiles and links the multi-file sketch (2 .ino, 2 .cpp, 1 .h), which runs', async () => {
    const r = await build(MULTI, { sketchName: 'multi' });
    expectOk(r);
    expect(r.timings.units.map((u) => u.file)).toEqual(['multi.ino', 'counter.cpp', 'describe.cpp']);
    // one loop() is ~200 ms (two 50 ms blink delays + 100 ms)
    expect(runUno(r.hex, 0.5).serial).toBe('multi-file sketch\r\ncount=3\r\ncount=6\r\ncount=9\r\n');
  }, T);

  it('reports an undeclared identifier in the SECOND .ino file at its own file and line', async () => {
    const r = await build({
      'main.ino': 'void setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n  blinkOnce(200);\n}\n',
      'b_helpers.ino': '// helpers\nvoid blinkOnce(int ms) {\n  digitalWrite(13, HIGH);\n  dealy(ms);\n  digitalWrite(13, LOW);\n}\n',
    });
    expect(r.ok).toBe(false);
    const err = r.messages.find((m) => m.severity === 'error')!;
    expect(err).toMatchObject({ file: 'b_helpers.ino', line: 4, column: 3, message: "'dealy' was not declared in this scope" });
    expect(err.detail).toBe('   dealy(ms);\n   ^~~~~');
    expect(r.ok || r.errors).toEqual(["b_helpers.ino:4:3: error: 'dealy' was not declared in this scope"]);
  }, T);

  it('reports a missing semicolon and never runs the linker after it', async () => {
    const counting = runner();
    const r = await build({ 'main.ino': 'void setup() {\n  int x = 3\n  pinMode(13, OUTPUT);\n}\nvoid loop() {}\n' }, { runner: counting });
    expect(r.ok || r.errors).toEqual(["main.ino:3:3: error: expected ',' or ';' before 'pinMode'"]);
    expect(counting.runs).toEqual(['cc1plus']);
  }, T);

  it('says "Sketch too big" with the numbers when the flash overflows', async () => {
    const r = await build({
      'main.ino':
        'const uint8_t a[17000] PROGMEM = {1};\nconst uint8_t b[17000] PROGMEM = {2};\nvoid setup() { Serial.begin(9600); }\n' +
        'void loop() { static unsigned int i; i++; Serial.write(pgm_read_byte(&a[i % sizeof a]) + pgm_read_byte(&b[i % sizeof b])); }\n',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/^error: Sketch too big: 3\d{4} bytes of 32256 bytes maximum \(1\d\d%\)\./);
  }, T);

  it('reports an unknown library before running any tool', async () => {
    const counting = runner();
    const r = await build({ 'main.ino': '#include <DHT.h>\nvoid setup() {}\nvoid loop() {}\n' }, { runner: counting });
    expect(r.ok || r.errors[0]).toMatch(/^main\.ino:1:10: error: Library 'DHT\.h' is not available in the browser compiler\. Bundled libraries: /);
    expect(counting.runs).toEqual([]);
  }, T);

  it('uses the object cache: a second build of unchanged units runs only ld and objcopy', async () => {
    const counting = runner();
    const cache = new MemoryObjectCache();
    const first = await build(MULTI, { runner: counting, cache });
    expectOk(first);
    expect(counting.runs.filter((t) => t === 'cc1plus')).toHaveLength(3);
    counting.runs.length = 0;
    const second = await build(MULTI, { runner: counting, cache });
    expectOk(second);
    expect(counting.runs).toEqual(['ld', 'objcopy']);
    expect(second.hex).toBe(first.hex);
    counting.runs.length = 0;
    await build({ ...MULTI, 'counter.cpp': MULTI['counter.cpp'].replace('+= 3', '+= 4') }, { runner: counting, cache });
    expect(counting.runs).toEqual(['cc1plus', 'as', 'ld', 'objcopy']);
  }, T);

  it('links a sketch with its own Timer1 ISR when Servo is not included, and explains the clash when it is', async () => {
    const own = await build({ 'main.ino': TIMER1_ISR });
    expectOk(own);
    const { edges } = runUno(own.hex, 1.6);
    const toggles = edges.filter((e) => e.t > 0.01).map((e) => e.t);
    expect(toggles.length).toBe(3);
    expect(toggles[1] - toggles[0]).toBeCloseTo(0.5, 3);
    const clash = await build({ 'main.ino': `#include <Servo.h>\nServo s;\n${TIMER1_ISR}` });
    expect(clash.ok).toBe(false);
    const err = clash.messages.find((m) => m.severity === 'error')!;
    expect(err).toMatchObject({ file: 'main.ino', line: 3 });
    expect(err.message).toMatch(/Interrupt handler __vector_11 .* and in the Servo library/);
  }, T);

  it('reports an undefined reference with its source line', async () => {
    const r = await build({ 'main.ino': 'void foo();\nvoid setup() { foo(); }\nvoid loop() {}\n' });
    expect(r.ok || r.errors).toEqual(["main.ino:2: error: Undefined reference to 'foo()' in setup: it is declared but never defined, or its library is not included."]);
  }, T);

  it('builds every bundled library and a .c file (compiled as C++)', async () => {
    const r = await build({
      'main.ino':
        '#include <Wire.h>\n#include <SPI.h>\n#include <SoftwareSerial.h>\n#include <EEPROM.h>\n#include <Servo.h>\n#include <Adafruit_NeoPixel.h>\n#include <HCSR04.h>\n' +
        '#include "src/mathc.h"\nSoftwareSerial soft(10, 11);\nServo servo;\nAdafruit_NeoPixel strip(8, 6, NEO_GRB + NEO_KHZ800);\nUltraSonicDistanceSensor sonar(4, 5);\n' +
        'void setup() { Wire.begin(); SPI.begin(); soft.begin(9600); EEPROM.write(0, 1); servo.attach(9); strip.begin(); strip.show(); }\n' +
        'void loop() { soft.println(sonar.measureDistanceCm() + add3(1, 2, 3)); }\n',
      'src/mathc.h': '#ifdef __cplusplus\nextern "C" {\n#endif\nint add3(int a, int b, int c);\n#ifdef __cplusplus\n}\n#endif\n',
      'src/mathc.c': '#include <stdbool.h>\n#include "mathc.h"\nstatic bool positive(int v) { return v > 0; }\nint add3(int a, int b, int c) { return positive(a) ? a + b + c : 0; }\n',
    });
    expectOk(r);
    expect(r.libraries).toEqual(['Wire', 'SPI', 'SoftwareSerial', 'EEPROM', 'Servo', 'Adafruit_NeoPixel', 'HCSR04']);
  }, T);

  it('builds Blink for the Nano profile too (same size as the Uno)', async () => {
    const uno = await build({ 'main.ino': BLINK });
    const nano = await build({ 'main.ino': BLINK }, { profile: 'nano' });
    expectOk(uno);
    expectOk(nano);
    expect(nano.flashBytes).toBe(uno.flashBytes);
  }, T);

  it('has the sysroot the tables describe', async () => {
    const sys = new DiskSysroot(`${toolchain.dir}/sysroot`);
    const has = async (p: string) => (await sys.list(p)).length === 1;
    for (const h of CORE_HEADERS) expect(await has(`${SYSROOT.core}/${h}`), h).toBe(true);
    for (const h of LIBC_HEADERS) expect(await has(`${SYSROOT.libcInclude}/${h}`), h).toBe(true);
    expect((await sys.list(SYSROOT.libcInclude)).length).toBe(LIBC_HEADERS.length);
    for (const h of GCC_HEADERS) expect((await has(`${SYSROOT.gccInclude}/${h}`)) || (await has(`${SYSROOT.gccIncludeFixed}/${h}`)), h).toBe(true);
    for (const l of BUNDLED_LIBRARIES) {
      for (const h of l.headers) expect(await has(`${l.includeDir}/${h}`), h).toBe(true);
      if (l.archive) expect(await has(l.archive), l.archive).toBe(true);
    }
    // No Nano variant in the pack: the Nano profile's note is still true.
    expect(await sys.list('/arduino/variants/eightanaloginputs')).toEqual([]);
    for (const p of Object.values(BOARD_PROFILES)) {
      for (const f of [p.coreArchive, p.link.crt, p.link.script.from, ...p.link.libFiles]) expect(await has(f), f).toBe(true);
    }
  }, T);
});
