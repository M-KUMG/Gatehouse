// Q5/Q6: build the Arduino core (and Wire/SPI/SoftwareSerial) from source with the
// wasm cc1plus + avr-as only (no native avr-gcc), for any board profile.
// Note: there is no cc1 (C compiler) in the package, so .c files go through cc1plus.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compileUnit, run, headers } from './tc.mjs';
import { makeArchive } from './ar.mjs';

export const CORE_ROOT = join(import.meta.dirname, '..', 'core', 'ArduinoCore-avr-1.8.7');
const vtree = (dir, vroot) => {
  const out = {};
  for (const n of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (n.isFile() && /\.(h|hpp)$|^new$/.test(n.name)) {
      const rel = join(n.parentPath ?? n.path, n.name).slice(dir.length).replace(/\\/g, '/');
      out[vroot + rel] = readFileSync(join(n.parentPath ?? n.path, n.name));
    }
  }
  return out;
};

/** Extra headers for a profile: variant + core libs not in the package (EEPROM, SoftwareSerial). */
export function boardHeaders(prof, variantName) {
  return {
    ...vtree(join(CORE_ROOT, 'variants'), '/arduino/variants'),
    ...vtree(join(CORE_ROOT, 'libraries', 'EEPROM', 'src'), '/arduino/libraries/EEPROM/src'),
    ...vtree(join(CORE_ROOT, 'libraries', 'SoftwareSerial', 'src'), '/arduino/libraries/SoftwareSerial/src'),
  };
}
export const EXTRA_INC = ['/arduino/libraries/EEPROM/src', '/arduino/libraries/SoftwareSerial/src'];

export async function buildCore(prof, variantName, log = console.log) {
  const extra = boardHeaders(prof, variantName);
  const srcs = [
    ...readdirSync(join(CORE_ROOT, 'cores', 'arduino')).filter((f) => /\.(c|cpp|S)$/.test(f)).map((f) => ['cores/arduino/' + f, f]),
    ['libraries/Wire/src/Wire.cpp', 'Wire.cpp'], ['libraries/Wire/src/utility/twi.c', 'twi.c'],
    ['libraries/SPI/src/SPI.cpp', 'SPI.cpp'], ['libraries/SoftwareSerial/src/SoftwareSerial.cpp', 'SoftwareSerial.cpp'],
  ];
  const objs = [];
  const failures = [];
  const t0 = performance.now();
  for (const [path, name] of srcs) {
    const text = readFileSync(join(CORE_ROOT, path), 'utf8');
    let r;
    if (name.endsWith('.S')) {
      // assembler-with-cpp: preprocess with cc1plus -E, then avr-as
      const pp = await run('cc1plus', ['-E', '-quiet', '-lang-asm', '-imultilib', prof.arch, `-D${prof.define}`, '-D__ASSEMBLER__', '-DF_CPU=16000000L',
        '-isystem', '/sysroot/avr/include', '-I', '/arduino/core', '-I', prof.variant, `/build/${name}`, `-mmcu=${prof.arch}`, '-o', '/build/pp.s'],
        { ...headers(), ...extra, [`/build/${name}`]: text });
      if (pp.code !== 0) { failures.push([name, pp.stderr.slice(0, 4)]); continue; }
      const as = await run('as', [`-mmcu=${prof.mcu}`, '-o', '/build/o.o', '/build/pp.s'], { '/build/pp.s': pp.read('/build/pp.s') });
      r = as.code === 0 ? { ok: true, obj: as.read('/build/o.o') } : { ok: false, stderr: as.stderr };
    } else {
      r = await compileUnit(prof, name, text, extra, { extraInc: ['/arduino/libraries/Wire/src/utility', ...EXTRA_INC] });
    }
    if (r.ok) objs.push({ name, data: r.obj });
    else failures.push([name, r.stderr.filter((l) => /error/.test(l)).slice(0, 4)]);
  }
  log(`core for ${prof.mcu}/${variantName}: ${objs.length} objects ok, ${failures.length} failed, ${Math.round(performance.now() - t0)} ms`);
  for (const f of failures) log('  FAIL', f[0], f[1].join(' | '));
  return { archive: makeArchive(objs), objs, failures, extra };
}
