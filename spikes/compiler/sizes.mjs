import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import zlib from 'node:zlib';
import { PKG, manifest } from './tc.mjs';
const gz = (b) => zlib.gzipSync(b, { level: 9 }).length;
const br = (b) => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;
const MB = (n) => (n / 1048576).toFixed(2);
function walk(d) { return readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; }); }
function group(label, files) {
  let u = 0, g = 0, b = 0; for (const f of files) { const d = readFileSync(f); u += d.length; g += gz(d); b += br(d); }
  console.log(label.padEnd(44), String(files.length).padStart(4), 'files', MB(u).padStart(7), 'MB raw', MB(g).padStart(7), 'MB gz', MB(b).padStart(7), 'MB br');
  return { u, g, b };
}
for (const f of readdirSync(join(PKG, 'tools'))) group('tools/' + f, [join(PKG, 'tools', f)]);
const A = join(PKG, 'assets');
group('tools/ total', walk(join(PKG, 'tools')));
group('assets/ total', walk(A));
group('assets/fs (headers) total', walk(join(A, 'fs')));
group('  fs/sysroot/avr/include', walk(join(A, 'fs/sysroot/avr/include')));
const avrInc = walk(join(A, 'fs/sysroot/avr/include'));
const isOtherIo = (f) => /[\/]avr[\/]io[a-z0-9]+\.h$/.test(f) && !/io(m328p|m2560|m328|m2561)?\.h$/.test(f.replace(/.*[\/]/, '').replace(/^/, '')) ;
const ioOther = avrInc.filter((f) => /[\/]avr[\/]io.+\.h$/.test(f) && !/[\/]io(m328p|m2560)\.h$/.test(f) && !/[\/](io|iom(x8|xx0_1)|portpins|common|version|fuse|lock|sfr_defs)\.h$/.test(f));
group('  of which avr/io*.h for other MCUs', ioOther);
group('  fs/libraries (3rd-party libs headers)', walk(join(A, 'fs/libraries')));
group('  fs/libraries/Adafruit_GFX_Library', walk(join(A, 'fs/libraries/Adafruit_GFX_Library')));
group('assets/objects (all)', walk(join(A, 'objects')));
group('assets/libs', walk(join(A, 'libs')));
const core = manifest.objectGroups.base.filter((p) => p.includes('core_')).map((p) => join(A, p));
group('objects: core_* only', [...core, join(A, 'objects/core_abi.o')]);
group('libs w/o libgcc.a', ['libc.a', 'libm.a', 'crtatmega328p.o'].map((f) => join(A, 'libs', f)));
// minimal Uno blink set: 4 tools + headers excluding other-MCU io + 3rd party libs + core objs + libs
const minimalHeaders = walk(join(A, 'fs')).filter((f) => !ioOther.includes(f) && !/[\/]fs[\/]libraries[\/]/.test(f));
group('MIN Uno set: headers (no other-MCU io, no 3rd-party)', minimalHeaders);
group('MIN Uno set: everything', [...walk(join(PKG, 'tools')).filter((f) => f.endsWith('.wasm') || f.endsWith('.mjs')), ...minimalHeaders, ...core, join(A, 'objects/core_abi.o'), ...walk(join(A, 'libs')), join(A, 'ldscripts/avr5.xn')]);
// libgcc.a: how much is debug info? count members
