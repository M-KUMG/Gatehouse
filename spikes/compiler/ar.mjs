// Minimal GNU ar writer with a symbol index (what ranlib adds), in plain JS,
// so a core.a can be made without native avr-ar. ELF32 little-endian only.
function definedGlobals(o) {
  const dv = new DataView(o.buffer, o.byteOffset, o.byteLength);
  const shoff = dv.getUint32(0x20, true), shentsize = dv.getUint16(0x2e, true), shnum = dv.getUint16(0x30, true);
  const sh = (i) => { const b = shoff + i * shentsize; return { type: dv.getUint32(b + 4, true), off: dv.getUint32(b + 16, true), size: dv.getUint32(b + 20, true), link: dv.getUint32(b + 24, true), entsize: dv.getUint32(b + 36, true) }; };
  const out = [];
  for (let i = 0; i < shnum; i++) {
    const s = sh(i);
    if (s.type !== 2) continue; // SHT_SYMTAB
    const str = sh(s.link);
    for (let k = 1; k < s.size / 16; k++) {
      const b = s.off + k * 16;
      const name = dv.getUint32(b, true), info = o[b + 12], shndx = dv.getUint16(b + 14, true);
      const bind = info >> 4;
      if ((bind === 1 || bind === 2) && shndx !== 0) {
        let e = str.off + name; let n = '';
        while (o[e]) n += String.fromCharCode(o[e++]);
        out.push(n);
      }
    }
  }
  return out;
}
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
const header = (name, size) => new TextEncoder().encode(pad(name, 16) + pad('0', 12) + pad('0', 6) + pad('0', 6) + pad('644', 8) + pad(String(size), 10) + '`\n');

/** objects: [{name, data}] -> Uint8Array of an indexed .a archive. */
export function makeArchive(objects) {
  const syms = objects.map((o) => definedGlobals(o.data));
  const names = syms.flat();
  const strBytes = new TextEncoder().encode(names.map((n) => n + '\0').join(''));
  let idxSize = 4 + 4 * names.length + strBytes.length;
  const idxPadded = idxSize + (idxSize & 1);
  let off = 8 + 60 + idxPadded;
  const offsets = [];
  objects.forEach((o, i) => { offsets.push(off); off += 60 + o.data.length + (o.data.length & 1); });
  const out = new Uint8Array(off);
  let p = 0;
  const w = (b) => { out.set(b, p); p += b.length; };
  w(new TextEncoder().encode('!<arch>\n'));
  w(header('/', idxSize));
  const idx = new DataView(out.buffer, p, idxSize);
  idx.setUint32(0, names.length, false);
  let k = 0;
  syms.forEach((s, i) => s.forEach(() => idx.setUint32(4 + 4 * k++, offsets[i], false)));
  p += 4 + 4 * names.length; w(strBytes); if (idxSize & 1) w(new Uint8Array([10]));
  objects.forEach((o, i) => { w(header(`m${i}.o/`, o.data.length)); w(o.data); if (o.data.length & 1) w(new Uint8Array([10])); });
  return out;
}
