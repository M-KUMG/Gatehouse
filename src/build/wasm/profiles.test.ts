import { describe, expect, it } from 'vitest';
import { MemoryObjectCache, contentHash } from './cache';
import { BOARD_PROFILES, getBoardProfile } from './profiles';
import { elfSections, hexDataBytes } from './size';

describe('board profiles', () => {
  it('has the Uno and the Nano on the ATmega328P at 16 MHz', () => {
    for (const id of ['uno', 'nano']) {
      const p = getBoardProfile(id)!;
      expect(p.id).toBe(id);
      expect(p).toMatchObject({ mcu: 'atmega328p', arch: 'avr5', fCpu: '16000000L', flashMax: 32256, ramSize: 2048, variant: 'standard' });
      expect(p.defines).toEqual(expect.arrayContaining(['F_CPU=16000000L', 'ARDUINO=10819', 'ARDUINO_ARCH_AVR', '__AVR_ATmega328P__']));
      expect(p.link.libs).toEqual(['m', 'c', 'atmega328p', 'gcc']);
      expect(p.link.libFiles.map((f) => f.slice(f.lastIndexOf('/') + 1))).toEqual(['libm.a', 'libc.a', 'libatmega328p.a', 'libgcc.a']);
      expect(p.link.flags).toContain('--gc-sections');
    }
    expect(BOARD_PROFILES.uno.defines).toContain('ARDUINO_AVR_UNO');
    expect(BOARD_PROFILES.nano.defines).toContain('ARDUINO_AVR_NANO');
  });

  it('says the Nano has no A6/A7 (no eightanaloginputs variant in the pack)', () => {
    expect(BOARD_PROFILES.nano.notes).toMatch(/A6 and A7 are not defined/);
    expect(BOARD_PROFILES.uno.notes).toBeUndefined();
  });

  it('only knows its own ids', () => {
    expect(getBoardProfile('mega')).toBeUndefined();
    expect(getBoardProfile('toString')).toBeUndefined();
  });
});

describe('object cache', () => {
  it('hashes content so different splits never collide', async () => {
    expect(await contentHash(['ab', 'c'])).not.toBe(await contentHash(['a', 'bc']));
    expect(await contentHash(['x'])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps the most recently used entries', () => {
    const c = new MemoryObjectCache(2);
    const v = (n: number) => ({ object: new Uint8Array([n]), stderr: '' });
    c.set('a', v(1));
    c.set('b', v(2));
    c.get('a');
    c.set('c', v(3));
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')?.object[0]).toBe(1);
    expect(c.size).toBe(2);
  });
});

describe('program size', () => {
  it('counts the data bytes of Intel HEX', () => {
    expect(hexDataBytes(':0400000001020304F2\r\n:02000004000AF0\n:00000001FF\n')).toBe(4);
  });

  it('returns no sections for something that is not an ELF file', () => {
    expect(elfSections(new Uint8Array([1, 2, 3])).size).toBe(0);
  });
});
