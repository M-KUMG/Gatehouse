// Spike: drive the avr-gcc-wasm tools directly from Node (no package compile()).
// Each tool run = fresh Emscripten instance (callMain can run once), but the
// compiled WebAssembly.Module is cached so only the first run pays compile time.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PKG = process.env.PKG ?? join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', 'pkg', 'x', 'package');
const TOOLS = { cc1plus: 'cc1plus', as: 'avr-as', ld: 'avr-ld', objcopy: 'avr-objcopy' };
const factories = {};
const modules = {};
export const stats = { compileMs: {}, instMs: {} };

async function factory(t) {
  factories[t] ??= (await import(pathToFileURL(join(PKG, 'tools', `${TOOLS[t]}.mjs`)).href)).default;
  return factories[t];
}
async function wasmModule(t) {
  if (!modules[t]) {
    const t0 = performance.now();
    modules[t] = await WebAssembly.compile(readFileSync(join(PKG, 'tools', `${TOOLS[t]}.wasm`)));
    stats.compileMs[t] = performance.now() - t0;
  }
  return modules[t];
}

function mkdirp(FS, dir) {
  let cur = '';
  for (const p of dir.split('/').filter(Boolean)) {
    cur += '/' + p;
    try { FS.mkdir(cur); } catch {}
  }
}
export function put(FS, path, data) {
  mkdirp(FS, path.split('/').slice(0, -1).join('/'));
  FS.writeFile(path, data);
}

/** Run one tool. files: {vpath: Uint8Array|string}. Returns {code, stderr, read(path)}. */
export async function run(t, args, files = {}, { cache = true } = {}) {
  const f = await factory(t);
  const mod = cache ? await wasmModule(t) : null;
  const stderr = [];
  const t0 = performance.now();
  const M = await f({
    noInitialRun: true,
    print: (l) => stderr.push(l),
    printErr: (l) => stderr.push(l),
    locateFile: (p) => join(PKG, 'tools', p.endsWith('.wasm') ? `${TOOLS[t]}.wasm` : p),
    ...(mod ? { instantiateWasm(imports, done) { WebAssembly.instantiate(mod, imports).then((i) => done(i, mod)); return {}; } } : {}),
  });
  const inst = performance.now() - t0;
  for (const [p, d] of Object.entries(files)) put(M.FS, p, d);
  let code = 0;
  const t1 = performance.now();
  try { const r = M.callMain(args); if (typeof r === 'number') code = r; }
  catch (e) { code = typeof e?.status === 'number' ? e.status : (console.error(e), 99); }
  const ms = performance.now() - t1;
  return { code, stderr, ms, instMs: inst, FS: M.FS, read: (p) => M.FS.readFile(p) };
}

// ---- assets ------------------------------------------------------------
const A = join(PKG, 'assets');
export const manifest = JSON.parse(readFileSync(join(A, 'manifest.json'), 'utf8'));
let headerCache;
export function headers() {
  headerCache ??= Object.fromEntries(manifest.headerFiles.map((p) => [p, readFileSync(join(A, 'fs', p))]));
  return headerCache;
}
export const asset = (p) => readFileSync(join(A, p.replace(/^\//, '')));

/** Walk a host dir and map its files to a virtual root. */
export function hostTree(dir, vroot, filter = () => true) {
  const out = {};
  const walk = (d, v) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p, `${v}/${n}`);
      else if (filter(n)) out[`${v}/${n}`] = readFileSync(p);
    }
  };
  walk(dir, vroot);
  return out;
}

// ---- board profiles (data) --------------------------------------------
export const PROFILES = {
  uno: { mcu: 'atmega328p', arch: 'avr5', define: '__AVR_ATmega328P__', board: 'ARDUINO_AVR_UNO', nflash: 1, dataStart: '0x800100', variant: '/arduino/variant' },
  nano: { mcu: 'atmega328p', arch: 'avr5', define: '__AVR_ATmega328P__', board: 'ARDUINO_AVR_NANO', nflash: 1, dataStart: '0x800100', variant: '/arduino/variants/eightanaloginputs' },
  mega: { mcu: 'atmega2560', arch: 'avr6', define: '__AVR_ATmega2560__', board: 'ARDUINO_AVR_MEGA2560', nflash: 4, dataStart: '0x800200', variant: '/arduino/variants/mega' },
};
export const INCLUDES = [
  '/arduino/core', '/arduino/libraries/Wire/src', '/arduino/libraries/SPI/src', '/arduino/libraries/Wire/src/utility',
  '/libraries/Servo/src', '/libraries/Adafruit_GFX_Library', '/libraries/Adafruit_BusIO',
];

export function ccArgs(prof, src, out, { extraInc = [], lang = 'c++', extraArgs = [] } = {}) {
  return [
    '-quiet', ...extraArgs, '-imultilib', prof.arch, `-D${prof.define}`, `-D__AVR_DEVICE_NAME__=${prof.mcu}`,
    '-DF_CPU=16000000L', '-DARDUINO=10819', `-D${prof.board}`, '-DARDUINO_ARCH_AVR',
    '-isystem', '/sysroot/gcc/include', '-isystem', '/sysroot/avr/include',
    '-I', prof.variant, ...extraInc.flatMap((i) => ['-I', i]), ...INCLUDES.flatMap((i) => ['-I', i]),
    src, `-mn-flash=${prof.nflash}`, '-mno-skip-bug', `-mmcu=${prof.arch}`,
    '-Os', '-w', ...(lang === 'c++' ? ['-std=gnu++11', '-fpermissive', '-fno-exceptions', '-fno-threadsafe-statics', '-fno-rtti', '-fno-enforce-eh-specs'] : ['-fpermissive']),
    '-ffunction-sections', '-fdata-sections', '-o', out,
  ];
}

/** Compile one translation unit (text) to an object (bytes). */
export async function compileUnit(prof, name, text, extraFiles = {}, opts = {}) {
  if (name.endsWith('.c') && opts.cAsCxx !== false) { text = `extern "C" {
#line 1 "${name}"
${text}
}
`; opts = { ...opts, extraArgs: ['-U__cplusplus', '-D_Bool=bool', ...(opts.extraArgs ?? [])] }; }
  const src = `/build/${name}`;
  const s = `/build/${name}.s`;
  const cc = await run('cc1plus', ccArgs(prof, src, s, opts), { ...headers(), ...extraFiles, [src]: text });
  if (cc.code !== 0) return { ok: false, stage: 'cc1plus', stderr: cc.stderr, ms: cc.ms };
  const asm = cc.read(s);
  const as = await run('as', [`-mmcu=${prof.mcu}`, '-o', '/build/o.o', '/build/o.s'], { '/build/o.s': asm });
  if (as.code !== 0) return { ok: false, stage: 'as', stderr: as.stderr };
  return { ok: true, obj: as.read('/build/o.o'), ccMs: cc.ms, ccInst: cc.instMs, asMs: as.ms, warnings: cc.stderr };
}

/** Link objects (vpath->bytes) with core/lib objects + libs, then objcopy to hex. */
export async function linkHex(prof, userObjs, extraObjs, { libs, crt, ldscript, devlib } = {}) {
  libs ??= { '/libs/libc.a': asset('libs/libc.a'), '/libs/libm.a': asset('libs/libm.a'), '/libs/libgcc.a': asset('libs/libgcc.a') };
  crt ??= { [`/libs/crt${prof.mcu}.o`]: asset(`libs/crt${prof.mcu}.o`) };
  ldscript ??= asset(`ldscripts/${prof.arch}.xn`);
  const files = { ...libs, ...crt, ...userObjs, ...extraObjs, [`/ldscripts/${prof.arch}.xn`]: ldscript, ...(devlib ? { [`/libs/lib${prof.mcu}.a`]: devlib } : {}) };
  const ld = await run('ld', [
    '-m', prof.arch, `-Tdata=${prof.dataStart}`, '--gc-sections', '-o', '/build/fw.elf',
    `/libs/crt${prof.mcu}.o`, ...Object.keys(userObjs), ...Object.keys(extraObjs), '-L/libs', '-lm', '-lc', ...(devlib ? [`-l${prof.mcu}`] : []), '-lgcc',
  ], files);
  if (ld.code !== 0) return { ok: false, stage: 'ld', stderr: ld.stderr };
  const elf = ld.read('/build/fw.elf');
  const oc = await run('objcopy', ['-O', 'ihex', '-R', '.eeprom', '/build/fw.elf', '/build/fw.hex'], { '/build/fw.elf': elf });
  if (oc.code !== 0) return { ok: false, stage: 'objcopy', stderr: oc.stderr };
  const hex = new TextDecoder().decode(oc.read('/build/fw.hex'));
  let flash = 0;
  for (const l of hex.split(/\r?\n/)) if (l.startsWith(':') && l.slice(7, 9) === '00') flash += parseInt(l.slice(1, 3), 16);
  return { ok: true, hex, flash, elf, ldMs: ld.ms, ldStderr: ld.stderr };
}

export const coreObjs = (names) => Object.fromEntries(names.map((n) => [`/objects/${n}`, asset(`objects/${n}`)]));
export const CORE = [
  'core_HardwareSerial.o', 'core_HardwareSerial0.o', 'core_Print.o', 'core_Stream.o', 'core_Tone.o', 'core_WMath.o',
  'core_WString.o', 'core_hooks.o', 'core_main.o', 'core_new.o', 'core_wiring.o', 'core_wiring_analog.o',
  'core_wiring_digital.o', 'core_wiring_pulse.o', 'core_wiring_pulse_asm.o', 'core_wiring_shift.o', 'core_abi.o',
];
