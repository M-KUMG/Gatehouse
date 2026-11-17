// Q5: Uno core from source with wasm-only tools; Q6: atmega2560 (Mega) and Nano.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILES } from './tc.mjs';
import { buildSketch } from './sketch.mjs';
import { buildCore, EXTRA_INC } from './corebuild.mjs';

const TC = join(import.meta.dirname, '..', 'tc', 'avr');
const sketches = {
  blink: { 'blink.ino': readFileSync('sk/a_blink/a_blink.ino', 'utf8') },
  serial: { 'serial.ino': readFileSync('sk/b_serial/b_serial.ino', 'utf8') },
  wire: { 'wire.ino': readFileSync('sk/f1_wire/f1_wire.ino', 'utf8') },
  eeprom: { 'eeprom.ino': readFileSync('sk/h_eeprom/h_eeprom.ino', 'utf8') },
  softserial: { 'softserial.ino': '#include <SoftwareSerial.h>\nSoftwareSerial s(10, 11);\nvoid setup(){ s.begin(9600); s.println("hi"); }\nvoid loop(){}\n' },
  serial3: { 'serial3.ino': 'void setup(){ Serial3.begin(9600); Serial3.println("mega"); }\nvoid loop(){}\n' },
};
async function boardRun(key, variant, sketchNames, linkOpts) {
  const prof = PROFILES[key];
  const core = await buildCore(prof, variant);
  for (const s of sketchNames) {
    const name = Object.keys(sketches[s])[0];
    const r = await buildSketch(prof, sketches[s], { mainName: name, extraInc: EXTRA_INC, extraHeaders: core.extra, archiveOverride: core.archive, linkOpts });
    console.log(`  ${key} ${s}:`, r.ok ? `OK flash ${r.flash} bytes, ${Math.round(r.ms)} ms` : 'FAIL ' + r.errors.slice(0, 4).join(' | '));
    if (r.ok) writeFileSync(`out/${key}_${s}.hex`, r.hex);
  }
}
await boardRun('uno', 'standard', ['blink', 'serial', 'wire', 'eeprom', 'softserial', 'serial3'], { devlib: readFileSync(join(TC, 'avr/lib/avr5/libatmega328p.a')) });
await boardRun('nano', 'eightanaloginputs', ['blink', 'serial'], { devlib: readFileSync(join(TC, 'avr/lib/avr5/libatmega328p.a')) });
// Mega: package has no avr6 libs/crt/ldscript; take them from Arduino's native toolchain archive.
const megaLibs = {
  libs: { '/libs/libc.a': readFileSync(join(TC, 'avr/lib/avr6/libc.a')), '/libs/libm.a': readFileSync(join(TC, 'avr/lib/avr6/libm.a')), '/libs/libgcc.a': readFileSync(join(TC, 'lib/gcc/avr/7.3.0/avr6/libgcc.a')) },
  crt: { '/libs/crtatmega2560.o': readFileSync(join(TC, 'avr/lib/avr6/crtatmega2560.o')) },
  ldscript: readFileSync(join(TC, 'avr/lib/ldscripts/avr6.xn')),
  devlib: readFileSync(join(TC, 'avr/lib/avr6/libatmega2560.a')),
};
await boardRun('mega', 'mega', ['blink', 'serial', 'serial3', 'wire', 'eeprom'], megaLibs);
// Mega with only the package's assets (no avr6 libs): what breaks?
const { linkHex, compileUnit } = await import('./tc.mjs');
const c = await compileUnit(PROFILES.mega, 'x.cpp', '#include <avr/io.h>\nint main(){ DDRB = 0x80; for(;;) PORTB ^= 0x80; }\n', (await import('./corebuild.mjs')).boardHeaders(PROFILES.mega, 'mega'));
console.log('mega cc1plus+as with package headers only:', c.ok ? 'OK' : c.stderr.slice(0, 3));
try { const l = await linkHex(PROFILES.mega, { '/build/x.o': c.obj }, {}); console.log('mega link with package assets only:', l.ok ? 'OK' : l.stderr.slice(0, 3)); }
catch (e) { console.log('mega link with package assets only: missing input:', e.message.split('\n')[0]); }
