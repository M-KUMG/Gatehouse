import { readFileSync } from 'node:fs';
const R = JSON.parse(readFileSync('emu-results-sb.json', 'utf8'));
const f = (v) => v.slice(0, 6).map((x) => `${x.v}@${x.t.toFixed(4)}`).join(' ');
const sum = (r) => {
  const e = Object.entries(r.edges).filter(([, v]) => v.length).map(([k, v]) => `${k}:${v.length}[${f(v)}]`).join(' ');
  let duty = '';
  const v = r.edges.d9; if (v.length > 4) { const hi = v.findIndex((x, i) => i > 1 && x.v === 'H'); const p = v[hi + 2].t - v[hi].t, h = v[hi + 1].t - v[hi].t; duty = ` d9 period ${(p * 1000).toFixed(3)}ms high ${(h * 1000).toFixed(3)}ms`; }
  return `baud=${r.baud} drives=${r.finalDrives} serial=${JSON.stringify(r.serial.slice(0, 90))} ${e}${duty}`;
};
for (const n of [...new Set(R.map((r) => r.name))]) {
  const a = R.find((r) => r.set === 'new' && r.name === n), b = R.find((r) => r.set === 'old' && r.name === n);
  const same = a.serial === b.serial && a.finalDrives === b.finalDrives && Object.keys(a.edges).every((k) => a.edges[k].length === b.edges[k].length && a.edges[k].every((x, i) => x.v === b.edges[k][i].v && Math.abs(x.t - b.edges[k][i].t) < 0.001));
  console.log(`== ${n} (${a.seconds}s) ${same ? 'SAME as old spike hex (serial, drives, edges within 1 ms)' : 'DIFFERS'}\n  new: ${sum(a)}`);
  if (!same) console.log(`  old: ${sum(b)}`);
}
