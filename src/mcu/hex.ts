// Intel HEX reader: the text a compiler (avr-gcc, arduino-cli) writes for
// a microcontroller's flash memory, turned into the bytes of that memory.
// Supports data (00), end of file (01), extended segment (02) and extended
// linear (04) address records; start address records (03, 05) are ignored.

/** Something wrong with a hex file, worded for the person loading it. */
export class HexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HexError';
  }
}

export interface FlashImage {
  /** Flash contents from address 0; unused bytes are 0xff (erased flash). */
  bytes: Uint8Array;
  /** One past the highest address written. */
  used: number;
}

/**
 * Parse Intel HEX text into a flash image of `flashSize` bytes. Throws a
 * HexError naming the line for bad syntax, checksums or addresses.
 */
export function parseIntelHex(text: string, flashSize: number): FlashImage {
  const bytes = new Uint8Array(flashSize).fill(0xff);
  let used = 0;
  let base = 0; // from extended address records
  let ended = false;
  let records = 0;
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim();
    if (line === '') continue;
    const where = `Line ${n + 1}`;
    if (ended) throw new HexError(`${where}: there is data after the end-of-file record.`);
    if (line[0] !== ':') throw new HexError(`${where} does not start with ":". Is this an Intel HEX file?`);
    const body = line.slice(1);
    if (body.length < 10 || body.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(body)) {
      throw new HexError(`${where} is not a valid record (it must be hexadecimal digits in pairs).`);
    }
    const rec = new Uint8Array(body.length / 2);
    for (let i = 0; i < rec.length; i++) rec[i] = parseInt(body.slice(2 * i, 2 * i + 2), 16);
    const count = rec[0];
    if (rec.length !== count + 5) {
      throw new HexError(`${where} says it holds ${count} bytes but holds ${rec.length - 5}.`);
    }
    let sum = 0;
    for (const b of rec) sum += b;
    if ((sum & 0xff) !== 0) throw new HexError(`${where} has a wrong checksum; the file is damaged.`);
    const address = (rec[1] << 8) | rec[2];
    const type = rec[3];
    const data = rec.subarray(4, 4 + count);
    records++;
    switch (type) {
      case 0x00: {
        const start = base + address;
        if (start + count > flashSize) {
          throw new HexError(`${where} writes past the end of the ${flashSize / 1024} KB flash memory.`);
        }
        bytes.set(data, start);
        used = Math.max(used, start + count);
        break;
      }
      case 0x01:
        ended = true;
        break;
      case 0x02:
      case 0x04:
        if (count !== 2) throw new HexError(`${where}: an address record must hold 2 bytes.`);
        base = ((data[0] << 8) | data[1]) * (type === 0x02 ? 16 : 65536);
        break;
      case 0x03:
      case 0x05:
        break; // start address: not needed, the CPU starts at the reset vector
      default:
        throw new HexError(`${where} has an unknown record type ${type}.`);
    }
  }
  if (records === 0) throw new HexError('The file is empty.');
  if (!ended) throw new HexError('The file has no end-of-file record; it may be cut short.');
  if (used === 0) throw new HexError('The file holds no program data.');
  return { bytes, used };
}
