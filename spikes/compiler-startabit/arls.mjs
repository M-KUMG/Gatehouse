// list members of a GNU/BSD ar archive (and GNU long-name table)
import { readFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  const b = readFileSync(f); let p = 8, longt = ''; const names = [];
  while (p + 60 <= b.length) {
    const h = b.subarray(p, p + 60).toString('latin1'); let n = h.slice(0, 16).trim(); const sz = parseInt(h.slice(48, 58));
    if (n === '//') longt = b.subarray(p + 60, p + 60 + sz).toString('latin1');
    else if (n !== '/' && n !== '/SYM64/') { if (/^\/\d+/.test(n)) { const o = +n.slice(1); n = longt.slice(o, longt.indexOf('/\n', o)); } names.push(n.replace(/\/$/, '') + '(' + sz + ')'); }
    p += 60 + sz + (sz & 1);
  }
  console.log(f.split(/[\/]/).slice(-2).join('/'), names.length, names.join(' '));
}
