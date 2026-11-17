import { readFileSync, existsSync } from 'node:fs';
const R = JSON.parse(readFileSync('emu-results.json', 'utf8'));
function syms(elfPath) {
  const o = readFileSync(elfPath); const dv = new DataView(o.buffer, o.byteOffset, o.byteLength);
  const shoff = dv.getUint32(0x20, true), es = dv.getUint16(0x2e, true), n = dv.getUint16(0x30, true);
  const sh = (i) => { const b = shoff + i * es; return { type: dv.getUint32(b + 4, true), off: dv.getUint32(b + 16, true), size: dv.getUint32(b + 20, true), link: dv.getUint32(b + 24, true) }; };
  const out = [];
  for (let i = 0; i < n; i++) { const s = sh(i); if (s.type !== 2) continue; const st = sh(s.link);
    for (let k = 1; k < s.size / 16; k++) { const b = s.off + k * 16; const val = dv.getUint32(b + 4, true), size = dv.getUint32(b + 8, true), info = o[b + 12];
      if ((info & 15) !== 2) continue; let e = st.off + dv.getUint32(b, true), nm = ''; while (o[e]) nm += String.fromCharCode(o[e++]); out.push({ val, size, nm }); } }
  return out;
}
for (const r of R) {
  if (r.error) { console.log(r.name, 'ERROR', r.error); continue; }
  const elf = `out/${r.name}.elf`; const S = existsSync(elf) ? syms(elf) : [];
  const where = (pc) => (S.find((s) => pc >= s.val && pc < s.val + s.size)?.nm ?? '?') + '@0x' + pc.toString(16);
  const e = Object.fromEntries(Object.entries(r.edges).map(([k, v]) => [k, `${v.length} edges: ` + v.slice(0, 6).map((x) => `${x.v}@${x.t.toFixed(4)}`).join(' ')]));
  let duty = '';
  if (r.edges.d9?.length > 4) { const v = r.edges.d9; const hi = v.findIndex((x, i) => i > 1 && x.v === 'H'); const p = v[hi + 2].t - v[hi].t, h = v[hi + 1].t - v[hi].t; duty = `d9 period ${(p * 1000).toFixed(3)} ms high ${(h * 1000).toFixed(3)} ms duty ${(100 * h / p).toFixed(1)}%`; }
  console.log(`== ${r.name} (${r.seconds}s) baud=${r.baud} drives=${r.finalDrives}`);
  console.log('   serial:', JSON.stringify(r.serial.slice(0, 160)));
  for (const [k, v] of Object.entries(e)) console.log('   ', k, v);
  if (duty) console.log('   ', duty);
  console.log('   pc:', [...new Set(r.pcSamples.map(where).map((w) => w.split('@')[0]))].join(', '));
}
