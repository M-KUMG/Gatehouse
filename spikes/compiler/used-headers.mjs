// Which headers does a real build open? cc1plus -H lists them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { PROFILES, run, headers, ccArgs, PKG } from './tc.mjs';
const src = '#include <Arduino.h>\n#include <Wire.h>\n#include <SPI.h>\n#include <Servo.h>\nvoid setup(){}\nvoid loop(){}\n';
const r = await run('cc1plus', ['-H', ...ccArgs(PROFILES.uno, '/build/x.cpp', '/build/x.s')], { ...headers(), '/build/x.cpp': src });
const used = [...new Set(r.stderr.filter((l) => /^\.+ /.test(l)).map((l) => l.replace(/^\.+ /, '').replace(/\/[^/]+\/\.\.\//g, '/')))];
let raw = 0, gz = 0, br = 0;
for (const u of used) { const d = headers()[u] ?? null; if (!d) { console.log('not in manifest?', u); continue; } raw += d.length; gz += zlib.gzipSync(d, { level: 9 }).length; br += zlib.brotliCompressSync(d).length; }
console.log('headers opened for Arduino.h+Wire+SPI+Servo:', used.length, 'files', (raw / 1024).toFixed(0), 'KB raw', (gz / 1024).toFixed(0), 'KB gz (per file)', (br / 1024).toFixed(0), 'KB br');
console.log(used.join('\n'));
