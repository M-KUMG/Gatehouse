// Program size of a build: flash bytes from the Intel HEX (what gets
// written to flash: .text + .data), RAM from the ELF's .data/.bss/.noinit
// (Arduino's "global variables" figure). Pure.

/** Data bytes in Intel HEX text (record type 00). */
export function hexDataBytes(hex: string): number {
  let n = 0;
  for (const line of hex.split(/\r?\n/)) {
    if (line.startsWith(':') && line.slice(7, 9) === '00') n += parseInt(line.slice(1, 3), 16);
  }
  return n;
}

/** Section sizes of a 32-bit little-endian ELF file, by name; empty when it is not one. */
export function elfSections(elf: Uint8Array): Map<string, number> {
  const out = new Map<string, number>();
  if (elf.length < 52 || elf[0] !== 0x7f || elf[1] !== 0x45 || elf[2] !== 0x4c || elf[3] !== 0x46 || elf[4] !== 1 || elf[5] !== 1) return out;
  const v = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
  const shoff = v.getUint32(0x20, true);
  const shentsize = v.getUint16(0x2e, true);
  const shnum = v.getUint16(0x30, true);
  const shstrndx = v.getUint16(0x32, true);
  if (shoff + shnum * shentsize > elf.length || shstrndx >= shnum) return out;
  const strOff = v.getUint32(shoff + shstrndx * shentsize + 0x10, true);
  for (let i = 0; i < shnum; i++) {
    const h = shoff + i * shentsize;
    let p = strOff + v.getUint32(h, true);
    let name = '';
    while (p < elf.length && elf[p] !== 0) name += String.fromCharCode(elf[p++]);
    out.set(name, v.getUint32(h + 0x14, true));
  }
  return out;
}

/** Static RAM use (bytes): .data + .bss + .noinit. */
export function ramBytes(elf: Uint8Array): number {
  const s = elfSections(elf);
  return (s.get('.data') ?? 0) + (s.get('.bss') ?? 0) + (s.get('.noinit') ?? 0);
}
