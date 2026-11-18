// The compile core with a fake ToolRunner: argument lists, caching, error
// flow and progress, without the real tools.
import { describe, expect, it } from 'vitest';
import { MemoryObjectCache } from './cache';
import { compileSketch, type CompileProgress } from './pipeline';
import { BOARD_PROFILES, getBoardProfile } from './profiles';
import { layoutSketch } from './sketch';
import { asText, type ToolRequest, type ToolResult, type ToolRunner } from './toolrunner';
import { WasmAvrCompiler } from './wasmcompiler';

const HEX = ':0400000001020304F2\n:00000001FF\n';

/** Pretends to be the tools: cc1plus fails on "#error", ld fails on "UNDEFINED". */
class FakeRunner implements ToolRunner {
  readonly version = 'fake-1';
  readonly calls: ToolRequest[] = [];

  run(req: ToolRequest): Promise<ToolResult> {
    this.calls.push(req);
    const out = (path: string, data: string): ToolResult => ({ exitCode: 0, stdout: '', stderr: '', outputs: new Map([[path, new TextEncoder().encode(data)]]) });
    const arg = (flag: string) => req.args[req.args.indexOf(flag) + 1];
    switch (req.tool) {
      case 'cc1plus': {
        const src = req.args[req.args.indexOf('-o') - 1];
        const text = asText(req.files.get(src)!);
        if (text.includes('#error')) {
          return Promise.resolve({ exitCode: 1, stdout: '', stderr: '/sketch/main.ino:2:2: error: #error boom\n #error boom\n  ^~~~~', outputs: new Map() });
        }
        const r = out(arg('-o'), `asm of ${src}`);
        return Promise.resolve(text.includes('#warning') ? { ...r, stderr: '/sketch/main.ino:1:2: warning: #warning careful' } : r);
      }
      case 'as':
        return Promise.resolve(out(arg('-o'), 'object'));
      case 'ld':
        if ([...req.files.values()].some((f) => asText(f).includes('UNDEFINED'))) {
          return Promise.resolve({ exitCode: 1, stdout: '', stderr: "ld: /build/main.ino.o: in function `loop':\n/sketch/main.ino:3:(.text.loop+0x0): undefined reference to `nope()'", outputs: new Map() });
        }
        return Promise.resolve(out(arg('-o'), 'not an elf'));
      case 'objcopy':
        return Promise.resolve(out(req.args[req.args.length - 1], HEX));
    }
  }

  count(tool: string): number {
    return this.calls.filter((c) => c.tool === tool).length;
  }
}

const uno = BOARD_PROFILES.uno;
const sketch = (files: Record<string, string>) => ({ files, profileId: 'uno' });
const MULTI = {
  'main.ino': 'void setup() { helper(); }\nvoid loop() {}\n',
  'helpers.ino': 'void helper() {}\n',
  'src/dev.cpp': '#include "dev.h"\nint dev() { return 1; }\n',
  'src/dev.h': 'int dev();\n',
  'mathc.c': 'int add(int a, int b) { return a + b; }\n',
  'firmware.hex': HEX,
  'diagram.json': '{}',
  'other/ignored.cpp': 'nope',
};

describe('layoutSketch', () => {
  it('makes one unit of the .ino files and one per .cpp/.c (root and src/), ignoring other files', () => {
    const l = layoutSketch(sketch(MULTI));
    expect(l.units.map((u) => [u.display, u.path, u.object, u.isC])).toEqual([
      ['main.ino', '/sketch/main.ino.cpp', '/build/main.ino.o', false],
      ['mathc.c', '/sketch/mathc.c.cpp', '/build/mathc.c.o', true],
      ['src/dev.cpp', '/sketch/src/dev.cpp', '/build/src/dev.cpp.o', false],
    ]);
    expect(l.inoOrder).toEqual(['main.ino', 'helpers.ino']);
    expect(l.prototypes).toEqual(['void helper();']);
    expect(l.units[1].text).toMatch(/^extern "C" \{\n#line 1 "\/sketch\/mathc\.c"\n/);
    expect(l.headers.map((h) => h.path)).toEqual(['src/dev.h']);
    expect(l.firmwareName).toBe('main.ino.hex');
  });
});

describe('compileSketch (fake tools)', () => {
  it('runs cc1plus and as per unit, then ld and objcopy, with the profile flags', async () => {
    const runner = new FakeRunner();
    const progress: CompileProgress[] = [];
    const r = await compileSketch(sketch(MULTI), uno, runner, { onProgress: (p) => progress.push(p) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ hex: HEX, flashBytes: 4, flashMax: 32256, ramBytes: 0, ramMax: 2048, firmwareName: 'main.ino.hex', libraries: [] });
    expect(runner.calls.map((c) => c.tool)).toEqual(['cc1plus', 'as', 'cc1plus', 'as', 'cc1plus', 'as', 'ld', 'objcopy']);
    const cc = runner.calls[0].args;
    for (const f of ['-DF_CPU=16000000L', '-DARDUINO=10819', '-DARDUINO_AVR_UNO', '-DARDUINO_ARCH_AVR', '-Os', '-std=gnu++11', '-fpermissive', '-fno-exceptions', '-ffunction-sections', '-fdata-sections', '-fno-threadsafe-statics', '-Wno-error=narrowing', '-mmcu=avr5']) {
      expect(cc).toContain(f);
    }
    expect(runner.calls[2].args).toEqual(expect.arrayContaining(['-U__cplusplus', '-D_Bool=bool']));
    const ld = runner.calls[6].args.join(' ');
    expect(ld).toMatch(/^-m avr5 -Tdata=0x800100 --gc-sections -o \/build\/firmware\.elf \/sysroot\/avr\/lib\/avr5\/crtatmega328p\.o \/build\/main\.ino\.o \/build\/mathc\.c\.o \/build\/src\/dev\.cpp\.o --start-group \/arduino\/core\.a --end-group -L\S+ -L\S+ -lm -lc -latmega328p -lgcc$/);
    expect(runner.calls[6].sysroot).toContainEqual({ from: '/sysroot/avr/lib/ldscripts/avr5.xn', to: '/ldscripts/avr5.xn' });
    expect(runner.calls[7].args).toEqual(['-O', 'ihex', '-R', '.eeprom', '/build/firmware.elf', '/build/firmware.hex']);
    expect(progress.map((p) => p.message)).toEqual([
      'Preparing sketch', 'Compiling main.ino (1/3)', 'Compiling mathc.c (2/3)', 'Compiling src/dev.cpp (3/3)', 'Linking', 'Done',
    ]);
    expect(r.messages.at(-1)?.message).toMatch(/^Sketch uses 4 bytes \(0%\) of program storage space\. Maximum is 32256 bytes\./);
  });

  it('mounts and links only the included libraries', async () => {
    const runner = new FakeRunner();
    const r = await compileSketch(sketch({ 'main.ino': '#include <Servo.h>\n#include <EEPROM.h>\nvoid setup() {}\nvoid loop() {}\n' }), uno, runner);
    expect(r.ok && r.libraries).toEqual(['EEPROM', 'Servo']);
    expect(runner.calls[0].args.join(' ')).toContain('-I /arduino/libraries/EEPROM -I /arduino/libraries/Servo');
    expect(runner.calls[0].sysroot.map((m) => m.from)).toEqual(expect.arrayContaining(['/arduino/libraries/Servo', '/arduino/core']));
    const ld = runner.calls.find((c) => c.tool === 'ld')!.args.join(' ');
    expect(ld).toContain('--start-group /arduino/libraries/Servo.a /arduino/core.a --end-group');
    expect(ld).not.toContain('Wire');
  });

  it('skips cc1plus and as for unchanged units on the next build, and recompiles what changed', async () => {
    const runner = new FakeRunner();
    const cache = new MemoryObjectCache();
    await compileSketch(sketch(MULTI), uno, runner, { cache });
    expect(runner.count('cc1plus')).toBe(3);
    const again = await compileSketch(sketch(MULTI), uno, runner, { cache });
    expect(runner.count('cc1plus')).toBe(3);
    expect(runner.count('as')).toBe(3);
    expect(runner.count('ld')).toBe(2);
    expect(again.timings.units.map((u) => u.cached)).toEqual([true, true, true]);
    // Editing one unit recompiles only it; editing a header recompiles every unit.
    await compileSketch(sketch({ ...MULTI, 'mathc.c': 'int add(int a, int b) { return b + a; }\n' }), uno, runner, { cache });
    expect(runner.count('cc1plus')).toBe(4);
    await compileSketch(sketch({ ...MULTI, 'src/dev.h': 'int dev(); // v2\n' }), uno, runner, { cache });
    expect(runner.count('cc1plus')).toBe(7);
    // Another board profile is another object.
    await compileSketch(sketch(MULTI), BOARD_PROFILES.nano, runner, { cache });
    expect(runner.count('cc1plus')).toBe(10);
  });

  it('shows a cached unit\'s warnings again', async () => {
    const runner = new FakeRunner();
    const cache = new MemoryObjectCache();
    const files = { 'main.ino': '#warning careful\nvoid setup() {}\nvoid loop() {}\n' };
    await compileSketch(sketch(files), uno, runner, { cache });
    const r = await compileSketch(sketch(files), uno, runner, { cache });
    expect(runner.count('cc1plus')).toBe(1);
    expect(r.messages[0]).toMatchObject({ severity: 'warning', file: 'main.ino', line: 1, message: '#warning careful' });
  });

  it('never links after a compile error, and reports it with the original file', async () => {
    const runner = new FakeRunner();
    const r = await compileSketch(sketch({ 'main.ino': 'void setup() {}\n#error boom\n' }), uno, runner);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(runner.count('as')).toBe(0);
    expect(runner.count('ld')).toBe(0);
    expect(r.errors).toEqual(['main.ino:2:2: error: #error boom']);
  });

  it('reports linker errors as messages', async () => {
    const runner = new FakeRunner();
    const r = await compileSketch(sketch({ 'main.ino': 'void setup() {}\n' }), uno, { ...runner, version: 'x', run: (q) => runner.run({ ...q, files: q.tool === 'ld' ? new Map([['/x', 'UNDEFINED']]) : q.files }) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(["main.ino:3: error: Undefined reference to 'nope()' in loop: it is declared but never defined, or its library is not included."]);
  });

  it('reports a missing sketch, an unknown library and a crashing runner without throwing', async () => {
    const runner = new FakeRunner();
    const none = await compileSketch(sketch({ 'firmware.hex': HEX }), uno, runner);
    expect(none.ok || none.errors).toEqual(['error: No sketch to compile: add a .ino file (or .cpp files) to the board folder.']);
    const lib = await compileSketch(sketch({ 'main.ino': '#include <LiquidCrystal_I2C.h>\n' }), uno, runner);
    expect(lib.ok || lib.errors[0]).toMatch(/^main\.ino:1:10: error: Library 'LiquidCrystal_I2C\.h' is not available in the browser compiler\. Bundled libraries: Wire, /);
    expect(runner.calls).toEqual([]);
    const broken: ToolRunner = { version: 'x', run: () => Promise.reject(new Error('cc1plus.wasm missing')) };
    const crash = await compileSketch(sketch({ 'main.ino': 'void setup() {}\n' }), uno, broken);
    expect(crash.ok || crash.errors).toEqual(['error: Internal compiler problem: cc1plus.wasm missing']);
  });
});

describe('WasmAvrCompiler', () => {
  it('maps a build to the BuildResult shape, with the structured messages alongside', async () => {
    const runner = new FakeRunner();
    const compiler = new WasmAvrCompiler({ runner: () => runner });
    expect(compiler.available()).toBe(true);
    const ok = await compiler.build({ boardTypeId: 'uno', files: { 'main.ino': '#warning careful\nvoid setup() {}\n' } });
    expect(ok).toMatchObject({ ok: true, hex: HEX, source: 'compiled', name: 'main.ino' });
    if (ok.ok) {
      expect(ok.messages[0]).toBe('main.ino:1:2: warning: #warning careful');
      expect(ok.messages[1]).toMatch(/^note: Sketch uses 4 bytes/);
    }
    expect(ok.buildMessages?.[0]).toMatchObject({ severity: 'warning', line: 1 });
    const bad = await compiler.build({ boardTypeId: 'uno', files: { 'main.ino': '#error boom\n' } });
    expect(bad).toMatchObject({ ok: false, errors: ['main.ino:2:2: error: #error boom'] });
    expect(await compiler.build({ boardTypeId: 'pico', files: {} })).toMatchObject({ ok: false, errors: ["The browser compiler cannot build boards of type 'pico'."] });
  });

  it('uses the profile lookup it is given', async () => {
    const runner = new FakeRunner();
    const compiler = new WasmAvrCompiler({ runner: () => runner, profileFor: (id) => (id === 'my-nano' ? getBoardProfile('nano') : undefined) });
    await compiler.build({ boardTypeId: 'my-nano', files: { 'main.ino': 'void setup() {}\n' } });
    expect(runner.calls[0].args).toContain('-DARDUINO_AVR_NANO');
  });
});
