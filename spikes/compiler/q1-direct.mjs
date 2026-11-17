// Q1/Q3: drive the tools directly; compare "all base objects" vs "core only" links.
import { readFileSync, writeFileSync } from 'node:fs';
import { PROFILES, compileUnit, linkHex, coreObjs, CORE, manifest, stats } from './tc.mjs';

const uno = PROFILES.uno;
const src = readFileSync('sk/blink.cpp', 'utf8');
for (const label of ['first (compiles wasm)', 'second (cached module)']) {
  const t0 = performance.now();
  const c = await compileUnit(uno, 'blink.cpp', src);
  if (!c.ok) { console.log(c); process.exit(1); }
  const coreOnly = await linkHex(uno, { '/build/sketch.o': c.obj }, coreObjs(CORE));
  const ms = performance.now() - t0;
  const all = await linkHex(uno, { '/build/sketch.o': c.obj }, coreObjs(['core_abi.o', ...manifest.objectGroups.base.map((p) => p.split('/').pop())]));
  console.log(label, { totalMs: Math.round(ms), cc1plusRunMs: Math.round(c.ccMs), cc1plusInstMs: Math.round(c.ccInst), flashCoreOnly: coreOnly.flash, flashAllBaseObjects: all.flash, wasmCompileMs: Object.fromEntries(Object.entries(stats.compileMs).map(([k, v]) => [k, Math.round(v)])) });
  writeFileSync('out/blink.hex', coreOnly.hex);
}
