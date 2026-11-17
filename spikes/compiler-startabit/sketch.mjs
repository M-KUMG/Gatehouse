// Spike of what Gatehouse would own: .ino preprocessing, per-unit compile,
// archive link (core + libraries, so only referenced objects are pulled in),
// error lines mapped back to the user's files.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileUnit, linkHex, asset, manifest } from './tc.mjs';
import { makeArchive } from './ar.mjs';

const CORE_SRC = join(import.meta.dirname, '..', 'core', 'ArduinoCore-avr-1.8.7');

/** Very small prototype generator: top-level `type name(args) {` definitions without a prior declaration. */
export function prototypes(code) {
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '').replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''");
  const protos = [];
  let depth = 0, start = 0;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '{') {
      if (depth === 0) {
        const head = stripped.slice(start, i).trim().replace(/\s+/g, ' ');
        const m = head.match(/^(?:#.*\s)*((?:[A-Za-z_][\w:<>,*&\s]*?)\s*[*&\s]\s*([A-Za-z_]\w*)\s*\(([^()]*)\))\s*$/);
        if (m && !/^(if|while|for|switch|else|return)\b/.test(m[1]) && !/\b(class|struct|namespace|enum|union)\b/.test(m[1]) && !['setup', 'loop'].includes(m[2])) {
          protos.push(m[1].replace(/=[^,)]*/g, '') + ';'); // default arguments stay on the definition only
        }
      }
      depth++;
    } else if (ch === '}') { depth--; if (depth === 0) start = i + 1; }
    else if (ch === ';' && depth === 0) start = i + 1;
    else if (ch === '\n' && depth === 0 && stripped.slice(start, i).trim().startsWith('#')) start = i + 1;
  }
  return protos;
}

/** Join .ino files (main sketch first, rest alphabetical) into one C++ unit. */
export function preprocessIno(files, mainName) {
  const inos = Object.keys(files).filter((f) => f.endsWith('.ino')).sort((a, b) => (a === mainName ? -1 : b === mainName ? 1 : a.localeCompare(b)));
  const body = inos.map((f) => `#line 1 "${f}"\n${files[f]}\n`).join('');
  const protos = prototypes(inos.map((f) => files[f]).join('\n'));
  // Arduino puts prototypes before the first function; after the includes is close enough for a spike.
  return `#include <Arduino.h>\n${protos.join('\n')}\n${body}`;
}

let archive;
/** core objects from the package + WInterrupts compiled here with cc1plus + library objects, as one indexed archive. */
export async function arduinoArchive(prof) {
  if (archive) return archive;
  const objs = manifest.objectGroups.base.concat(['/objects/core_abi.o'], manifest.objectGroups.oled, manifest.objectGroups.tof)
    .map((p) => ({ name: p, data: asset(p) }));
  const wint = await compileUnit(prof, 'WInterrupts.c', readFileSync(join(CORE_SRC, 'cores/arduino/WInterrupts.c'), 'utf8'));
  if (!wint.ok) throw new Error('WInterrupts.c: ' + wint.stderr.join('\n'));
  objs.push({ name: 'core_WInterrupts.o', data: wint.obj });
  archive = makeArchive(objs);
  return archive;
}

/** Build a sketch: files = {name: text}. Returns {ok, hex, flash, ms} or {ok:false, errors}. */
export async function buildSketch(prof, files, { mainName, extraInc = [], extraHeaders = {}, archiveOverride, linkOpts = {} } = {}) {
  const t0 = performance.now();
  mainName ??= Object.keys(files).find((f) => f.endsWith('.ino'));
  const units = [];
  if (mainName) units.push(['sketch.ino.cpp', preprocessIno(files, mainName)]);
  for (const [f, t] of Object.entries(files)) if (/\.(cpp|c)$/.test(f)) units.push([f, t]);
  // user headers sit next to the sketch, visible as "x.h"
  const userHeaders = Object.fromEntries(Object.entries(files).filter(([f]) => /\.(h|hpp)$/.test(f)).map(([f, t]) => [`/build/${f}`, t]));
  const objs = {};
  const errors = [];
  for (const [name, text] of units) {
    const r = await compileUnit(prof, name, text, { ...userHeaders, ...extraHeaders }, { extraInc });
    if (!r.ok) errors.push(...r.stderr.filter((l) => /(error|warning):/.test(l)));
    else objs[`/build/${name}.o`] = r.obj;
  }
  if (errors.length) return { ok: false, errors };
  const ar = archiveOverride ?? (await arduinoArchive(prof));
  const l = await linkHex(prof, objs, { '/libs/libarduino.a': ar }, linkOpts);
  if (!l.ok) return { ok: false, errors: l.stderr };
  return { ok: true, hex: l.hex, elf: l.elf, flash: l.flash, ms: performance.now() - t0 };
}
