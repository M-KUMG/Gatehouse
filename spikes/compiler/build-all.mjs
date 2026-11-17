// Q4/Q7: build every sketch folder in sk/ with the direct pipeline; write out/<name>.hex.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILES } from './tc.mjs';
import { buildSketch, preprocessIno } from './sketch.mjs';

const prof = PROFILES[process.argv[2] ?? 'uno'];
const EEPROM_H = readFileSync(join(import.meta.dirname, '..', 'core', 'ArduinoCore-avr-1.8.7', 'libraries', 'EEPROM', 'src', 'EEPROM.h'));
for (const dir of readdirSync('sk')) {
  if (!statSync(join('sk', dir)).isDirectory()) continue;
  const files = Object.fromEntries(readdirSync(join('sk', dir)).map((f) => [f, readFileSync(join('sk', dir, f), 'utf8')]));
  const r = await buildSketch(prof, files, { mainName: `${dir}.ino`, extraInc: ['/arduino/libraries/EEPROM/src'], extraHeaders: { '/arduino/libraries/EEPROM/src/EEPROM.h': EEPROM_H }, linkOpts: process.env.DEVLIB ? { devlib: readFileSync(process.env.DEVLIB) } : {} });
  if (r.ok) { writeFileSync(join('out', `${dir}.hex`), r.hex); writeFileSync(join('out', `${dir}.elf`), r.elf); console.log(dir.padEnd(10), 'OK  flash', String(r.flash).padStart(5), 'bytes', Math.round(r.ms), 'ms'); }
  else console.log(dir.padEnd(10), 'FAIL', r.errors.slice(0, 8).join('\n   '));
  if (dir === 'multi' && process.argv[3] === 'show') console.log(preprocessIno(files, 'multi.ino'));
}
