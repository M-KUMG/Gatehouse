// Tool runner adapted to the startabit/avr-gcc-wasm v1 release layout:
//   X/tools/{cc1plus,as,ld,objcopy}.{mjs,wasm}   (wasm gunzipped from *.wasm.gz)
//   X/sysroot/{sysroot/..., arduino/...}         (sysroot.tar.gz extracted)
// The sysroot tree is mounted at / in MEMFS, so paths are /sysroot/... and /arduino/...
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const X = process.env.SBX ?? join(import.meta.dirname, '..', 'x');
const TOOLDIR = process.env.TOOLDIR ?? join(X, 'tools');
const TOOLS = JSON.parse(process.env.TOOLNAMES ?? '{"cc1plus":"cc1plus","as":"as","ld":"ld","objcopy":"objcopy"}');
const factories = {};
const modules = {};
export const stats = { compileMs: {} };

async function factory(t) {
  factories[t] ??= (await import(pathToFileURL(join(TOOLDIR, `${TOOLS[t]}.mjs`)).href)).default;
  return factories[t];
}
async function wasmModule(t) {
  if (!modules[t]) {
    const t0 = performance.now();
    modules[t] = await WebAssembly.compile(readFileSync(join(TOOLDIR, `${TOOLS[t]}.wasm`)));
    stats.compileMs[t] = performance.now() - t0;
  }
  return modules[t];
}
function mkdirp(FS, dir) {
  let cur = '';
  for (const p of dir.split('/').filter(Boolean)) { cur += '/' + p; try { FS.mkdir(cur); } catch {} }
}
export function put(FS, path, data) { mkdirp(FS, path.split('/').slice(0, -1).join('/')); FS.writeFile(path, data); }

export async function run(t, args, files = {}) {
  const f = await factory(t);
  const mod = await wasmModule(t);
  const out = [];
  const t0 = performance.now();
  const M = await f({
    noInitialRun: true, thisProgram: t,
    print: (l) => out.push(l), printErr: (l) => out.push(l),
    locateFile: (p) => join(TOOLDIR, p),
    instantiateWasm(imports, done) { WebAssembly.instantiate(mod, imports).then((i) => done(i, mod)); return {}; },
  });
  const instMs = performance.now() - t0;
  for (const [p, d] of Object.entries(files)) put(M.FS, p, d);
  let code = 0;
  const t1 = performance.now();
  try { const r = M.callMain(args); if (typeof r === 'number') code = r; }
  catch (e) { code = typeof e?.status === 'number' ? e.status : (console.error(e), 99); }
  return { code, stderr: out, ms: performance.now() - t1, instMs, FS: M.FS, read: (p) => M.FS.readFile(p) };
}

// ---- sysroot ------------------------------------------------------------
function tree(dir, vroot, filter) {
  const out = {};
  for (const n of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!n.isFile() || !filter(n.name)) continue;
    const p = join(n.parentPath ?? n.path, n.name);
    out[vroot + p.slice(dir.length).replace(/\\/g, '/')] = readFileSync(p);
  }
  return out;
}
let hdr;
export const headers = () => (hdr ??= tree(join(X, 'sysroot'), '', (n) => !/\.(a|o)$/.test(n) && !/^avr5\.x/.test(n)));
export const sysfile = (p) => readFileSync(join(X, 'sysroot', p));

export const PROFILES = {
  uno: { mcu: 'atmega328p', arch: 'avr5', define: '__AVR_ATmega328P__', board: 'ARDUINO_AVR_UNO', nflash: 1, dataStart: '0x800100', variant: '/arduino/variant' },
};
export const LIBS = ['Wire', 'SPI', 'SoftwareSerial', 'EEPROM', 'Servo', 'Adafruit_NeoPixel', 'HCSR04'];
const GCCINC = '/sysroot/lib/gcc/avr/7.3.0';

export function ccArgs(prof, src, out, { lang = 'c++', extraArgs = [] } = {}) {
  return [
    '-quiet', ...extraArgs, '-imultilib', prof.arch, `-D${prof.define}`, `-D__AVR_DEVICE_NAME__=${prof.mcu}`,
    '-DF_CPU=16000000L', '-DARDUINO=10819', `-D${prof.board}`, '-DARDUINO_ARCH_AVR',
    '-isystem', `${GCCINC}/include`, '-isystem', `${GCCINC}/include-fixed`, '-isystem', '/sysroot/avr/include',
    '-I', prof.variant, '-I', '/arduino/core', ...LIBS.flatMap((l) => ['-I', `/arduino/libraries/${l}`]),
    src, `-mn-flash=${prof.nflash}`, '-mno-skip-bug', `-mmcu=${prof.arch}`,
    '-Os', '-w', ...(lang === 'c++' ? ['-std=gnu++11', '-fpermissive', '-fno-exceptions', '-fno-threadsafe-statics', '-fno-rtti', '-fno-enforce-eh-specs'] : []),
    '-ffunction-sections', '-fdata-sections', '-o', out,
  ];
}

export async function compileUnit(prof, name, text, extraFiles = {}, opts = {}) {
  if (name.endsWith('.c')) { // no cc1 in the release either: C as C++ with C linkage
    text = `extern "C" {\n#line 1 "${name}"\n${text}\n}\n`;
    opts = { ...opts, extraArgs: ['-U__cplusplus', '-D_Bool=bool', ...(opts.extraArgs ?? [])] };
  }
  const src = `/build/${name}`, s = `/build/${name}.s`;
  const cc = await run('cc1plus', ccArgs(prof, src, s, opts), { ...headers(), ...extraFiles, [src]: text });
  if (cc.code !== 0) return { ok: false, stage: 'cc1plus', stderr: cc.stderr };
  const as = await run('as', [`-mmcu=${prof.mcu}`, '-o', '/build/o.o', '/build/o.s'], { '/build/o.s': cc.read(s) });
  if (as.code !== 0) return { ok: false, stage: 'as', stderr: as.stderr };
  return { ok: true, obj: as.read('/build/o.o'), ccMs: cc.ms, asMs: as.ms };
}

/** Link with the release's precompiled core.a + library archives + avr-libc/libgcc from the sysroot. */
export async function linkHex(prof, userObjs, extraObjs = {}) {
  const L5 = `/sysroot/avr/lib/${prof.arch}`, LG = `${GCCINC}/${prof.arch}`;
  const archives = { ...Object.fromEntries(LIBS.filter((l) => l !== 'EEPROM').map((l) => [`/arduino/libraries/${l}.a`, sysfile(`arduino/libraries/${l}.a`)])), '/arduino/core.a': sysfile('arduino/core.a') };
  const libs = Object.fromEntries(['libc.a', 'libm.a', `lib${prof.mcu}.a`, `crt${prof.mcu}.o`].map((n) => [`${L5}/${n}`, sysfile(`sysroot/avr/lib/${prof.arch}/${n}`)]));
  libs[`${LG}/libgcc.a`] = sysfile(`sysroot/lib/gcc/avr/7.3.0/${prof.arch}/libgcc.a`);
  const files = { ...libs, ...archives, ...userObjs, ...extraObjs, [`/ldscripts/${prof.arch}.xn`]: sysfile(`sysroot/avr/lib/ldscripts/${prof.arch}.xn`) };
  const ld = await run('ld', [
    '-m', prof.arch, `-Tdata=${prof.dataStart}`, '--gc-sections', '-o', '/build/fw.elf',
    `${L5}/crt${prof.mcu}.o`, ...Object.keys(userObjs), ...Object.keys(extraObjs),
    '--start-group', ...Object.keys(archives), '--end-group',
    `-L${L5}`, `-L${LG}`, '-lm', '-lc', `-l${prof.mcu}`, '-lgcc',
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

// keep sketch.mjs's imports resolvable (its arduinoArchive() is not used here)
export const asset = () => { throw new Error('horang layout not available'); };
export const manifest = {};
