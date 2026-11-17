import { readFileSync, readdirSync, statSync } from 'node:fs';
import zlib from 'node:zlib';
import { PKG } from './tc.mjs';
const A = PKG.split(String.fromCharCode(92)).join('/') + '/assets';
const walk = (d) => readdirSync(d).flatMap((n) => { const p = d + '/' + n; return statSync(p).isDirectory() ? walk(p) : [p]; });
const MB = (n) => (n / 1048576).toFixed(2);
function group(label, files) { let u = 0, g = 0, b = 0; for (const f of files) { const d = readFileSync(f); u += d.length; g += zlib.gzipSync(d, { level: 9 }).length; b += zlib.brotliCompressSync(d, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }).length; }
  console.log(label.padEnd(52), String(files.length).padStart(4), 'files', MB(u).padStart(6), 'MB raw', MB(g).padStart(6), 'MB gz', MB(b).padStart(6), 'MB br'); }
const all = walk(A + '/fs');
const otherIo = all.filter((f) => /\/sysroot\/avr\/include\/avr\/io[^/]+\.h$/.test(f) && !/\/(io|iom328p|iom2560|portpins|common|version|fuse|lock|sfr_defs|interrupt)\.h$/.test(f));
group('avr/io*.h for MCUs other than 328P/2560', otherIo);
const thirdParty = all.filter((f) => /\/fs\/libraries\//.test(f));
const minHeaders = all.filter((f) => !otherIo.includes(f) && !thirdParty.includes(f));
group('headers, trimmed (no other-MCU io, no 3rd-party libs)', minHeaders);
const core = walk(A + '/objects').filter((f) => /core_/.test(f));
group('core objects', core);
group('Wire+twi+SPI+Servo objects', ['lib_Wire.o', 'lib_twi.o', 'lib_SPI.o', 'lib_Servo.o'].map((f) => A + '/objects/' + f));
group('libc+libm+libgcc+crt+ldscript', [...walk(A + '/libs'), A + '/ldscripts/avr5.xn']);
const tools = walk(PKG.split(String.fromCharCode(92)).join('/') + '/tools');
group('MIN Uno blink set (tools+trimmed headers+core+libs)', [...tools, ...minHeaders, ...core, ...walk(A + '/libs'), A + '/ldscripts/avr5.xn']);
group('Uno set + Wire/SPI/Servo', [...tools, ...minHeaders, ...core, ...walk(A + '/libs'), A + '/ldscripts/avr5.xn', ...['lib_Wire.o', 'lib_twi.o', 'lib_SPI.o', 'lib_Servo.o'].map((f) => A + '/objects/' + f), ...all.filter((f) => /\/libraries\/Servo\//.test(f))]);
