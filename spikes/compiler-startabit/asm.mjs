const shim = process.env.TOOLDIR ? await import('./horang-shim.mjs') : null;
const { run, PROFILES, ccArgs, headers } = await import('./tc.mjs');
const { preprocessIno } = await import('./sketch.mjs');
import { readFileSync, writeFileSync } from 'node:fs';
for (const sk of process.argv.slice(3)) {
  const src = preprocessIno({ [`${sk}.ino`]: readFileSync(`sk/${sk}/${sk}.ino`, 'utf8') }, `${sk}.ino`);
  const r = await run('cc1plus', ccArgs(PROFILES.uno, '/build/s.cpp', '/build/s.s'), { ...headers(), '/build/s.cpp': src });
  writeFileSync(`${process.argv[2]}/${sk}.s`, r.read('/build/s.s'));
}
