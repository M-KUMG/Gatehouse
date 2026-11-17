import './horang-shim.mjs';
const { run, PROFILES, compileUnit, linkHex } = await import('./tc.mjs');
const { preprocessIno } = await import('./sketch.mjs');
import { readFileSync, writeFileSync } from 'node:fs';
const v = await run('cc1plus', ['-version', '-quiet', '/e.cpp', '-o', '/e.s'], { '/e.cpp': '' }); console.log(v.code, v.stderr.slice(0, 2).join('\n'));
for (const t of ['as', 'ld', 'objcopy']) { const r = await run(t, ['--version']); console.log(t, r.stderr[0]); }
for (const sk of process.argv.slice(2)) {
  const src = preprocessIno({ [`${sk}.ino`]: readFileSync(`sk/${sk}/${sk}.ino`, 'utf8') }, `${sk}.ino`);
  const c = await compileUnit(PROFILES.uno, 'sketch.ino.cpp', src); if (!c.ok) { console.log(sk, 'FAIL', c.stderr.join('|')); continue; }
  const l = await linkHex(PROFILES.uno, { '/build/sketch.o': c.obj }); if (!l.ok) { console.log(sk, 'LINK FAIL', l.stderr.join('|')); continue; }
  writeFileSync(`outh/${sk}.hex`, l.hex); writeFileSync(`outh/${sk}.s.o`, c.obj); console.log(sk, 'flash', l.flash);
}
