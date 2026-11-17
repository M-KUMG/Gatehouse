// Build every sketch folder in sk/ for the Uno with the startabit tools + sysroot; write out/<name>.hex/.elf.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILES, compileUnit, linkHex, run, stats } from './tc.mjs';
import { preprocessIno } from './sketch.mjs';

const prof = PROFILES.uno;
const W = import.meta.dirname;
if (process.argv[2] === 'versions') {
  for (const t of ['cc1plus', 'as', 'ld', 'objcopy']) {
    const r = await run(t, ['--version']);
    console.log(`== ${t} (exit ${r.code})\n` + r.stderr.slice(0, 3).join('\n'));
  }
  process.exit(0);
}

async function build(files, mainName) {
  const t0 = performance.now();
  const units = [['sketch.ino.cpp', preprocessIno(files, mainName)]];
  for (const [f, t] of Object.entries(files)) if (/\.(cpp|c)$/.test(f)) units.push([f, t]);
  const userHeaders = Object.fromEntries(Object.entries(files).filter(([f]) => /\.(h|hpp)$/.test(f)).map(([f, t]) => [`/build/${f}`, t]));
  const objs = {}, errors = [];
  for (const [name, text] of units) {
    const r = await compileUnit(prof, name, text, userHeaders);
    if (!r.ok) errors.push(`[${r.stage}] ` + r.stderr.filter((l) => /error|warning|undefined/.test(l)).join(' | '));
    else objs[`/build/${name}.o`] = r.obj;
  }
  if (errors.length) return { ok: false, errors };
  const l = await linkHex(prof, objs);
  if (!l.ok) return { ok: false, errors: [`[${l.stage}] ` + l.stderr.join(' | ')] };
  return { ...l, ms: performance.now() - t0 };
}

const only = process.argv.slice(2);
for (const dir of readdirSync(join(W, 'sk'))) {
  if (!statSync(join(W, 'sk', dir)).isDirectory() || (only.length && !only.includes(dir))) continue;
  const files = Object.fromEntries(readdirSync(join(W, 'sk', dir)).map((f) => [f, readFileSync(join(W, 'sk', dir, f), 'utf8')]));
  const times = [];
  let r;
  for (let i = 0; i < 3; i++) { r = await build(files, `${dir}.ino`); if (!r.ok) break; times.push(Math.round(r.ms)); }
  if (r.ok) {
    writeFileSync(join(W, 'out', `${dir}.hex`), r.hex); writeFileSync(join(W, 'out', `${dir}.elf`), r.elf);
    console.log(dir.padEnd(13), 'OK  flash', String(r.flash).padStart(5), 'bytes  ms(3 runs):', times.join('/'), r.ldStderr.length ? ' ld: ' + r.ldStderr.join(' | ') : '');
  } else console.log(dir.padEnd(13), 'FAIL', r.errors.slice(0, 6).join('\n   '));
}
console.log('WebAssembly.compile ms:', Object.fromEntries(Object.entries(stats.compileMs).map(([k, v]) => [k, Math.round(v)])));
