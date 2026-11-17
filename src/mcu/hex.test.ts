import { describe, expect, it } from 'vitest';
import { HexError, parseIntelHex } from './hex';
import { BLINK_HEX } from './programs/blink';

const FLASH = 32 * 1024;

function errorOf(text: string, flash = FLASH): string {
  try {
    parseIntelHex(text, flash);
  } catch (e) {
    expect(e).toBeInstanceOf(HexError);
    return (e as Error).message;
  }
  throw new Error('expected the hex to be rejected');
}

describe('Intel HEX', () => {
  it('reads data records into flash, the rest stays erased (0xff)', () => {
    const img = parseIntelHex(':0400100001020304E2\n:00000001FF\n', 64);
    expect([...img.bytes.subarray(0x10, 0x14)]).toEqual([1, 2, 3, 4]);
    expect(img.bytes[0]).toBe(0xff);
    expect(img.bytes[0x14]).toBe(0xff);
    expect(img.used).toBe(0x14);
  });

  it('reads the built-in Blink program', () => {
    const img = parseIntelHex(BLINK_HEX, FLASH);
    expect(img.used).toBe(0x238);
    // Reset vector: JMP 0x0068 (0x940C 0x0034).
    expect([...img.bytes.subarray(0, 4)]).toEqual([0x0c, 0x94, 0x34, 0x00]);
  });

  it('accepts CRLF line ends, blank lines, lower case and address records', () => {
    const img = parseIntelHex('\r\n:020000040000FA\r\n:02000002000AF2\r\n:0200000011aa43\r\n:00000001ff\r\n', 256);
    expect([...img.bytes.subarray(0xa0, 0xa2)]).toEqual([0x11, 0xaa]);
  });

  it('rejects a wrong checksum, naming the line', () => {
    expect(errorOf(':0400100001020304E3\n:00000001FF')).toMatch(/Line 1 has a wrong checksum/);
    const lines = BLINK_HEX.split('\n');
    lines[3] = lines[3].slice(0, -2) + '00';
    expect(errorOf(lines.join('\n'))).toMatch(/Line 4 has a wrong checksum/);
  });

  it('rejects malformed records', () => {
    expect(errorOf('hello\n:00000001FF')).toMatch(/Line 1 does not start with ":"/);
    expect(errorOf(':0400100001020304E\n:00000001FF')).toMatch(/Line 1 is not a valid record/);
    expect(errorOf(':04001000010203XYE2\n:00000001FF')).toMatch(/Line 1 is not a valid record/);
    expect(errorOf(':0500100001020304E2\n:00000001FF')).toMatch(/says it holds 5 bytes but holds 4/);
    expect(errorOf(':00000007F9\n:00000001FF')).toMatch(/unknown record type 7/);
  });

  it('rejects files that are cut short, empty, or too big for the flash', () => {
    expect(errorOf(':0400100001020304E2')).toMatch(/no end-of-file record/);
    expect(errorOf('')).toMatch(/empty/);
    expect(errorOf(':00000001FF')).toMatch(/no program data/);
    expect(errorOf(':0400100001020304E2\n:00000001FF', 16)).toMatch(/past the end/);
    expect(errorOf(':00000001FF\n:0400100001020304E2')).toMatch(/after the end-of-file record/);
  });
});
