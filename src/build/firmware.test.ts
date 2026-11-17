import { afterEach, describe, expect, it } from 'vitest';
import type { Compiler } from './compiler';
import { pickFirmware } from './firmware';
import { FirmwareFileCompiler, NOT_COMPILED_NOTE } from './firmwarefile';
import { buildFirmware, getCompiler, registerCompiler } from './registry';

const HEX = ':00000001FF\n';
const pick = (files: Record<string, string>) => pickFirmware({ files });

describe('pickFirmware', () => {
  it('takes firmware.hex at the board root, even next to other .hex files', () => {
    expect(pick({ 'main.ino': '', 'firmware.hex': HEX, 'other.hex': 'x' })).toEqual({ ok: true, path: 'firmware.hex', hex: HEX });
    expect(pick({ 'Firmware.HEX': HEX, 'b.hex': 'x' })).toMatchObject({ ok: true, path: 'Firmware.HEX' });
  });

  it('otherwise takes the only .hex at the root', () => {
    expect(pick({ 'main.ino': '', 'Blink.ino.hex': HEX, 'build/x.hex': 'y' })).toEqual({ ok: true, path: 'Blink.ino.hex', hex: HEX });
  });

  it('reports no firmware, also when the only .hex is in a sub-folder', () => {
    const cases: Record<string, string>[] = [{}, { 'main.ino': '' }, { 'build/firmware.hex': HEX }];
    for (const files of cases) {
      const r = pick(files);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/^No firmware: .*firmware\.hex/);
    }
  });

  it('asks to name one firmware.hex when several are at the root', () => {
    const r = pick({ 'b.hex': 'x', 'a.hex': 'y' });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/Several \.hex files .*\(a\.hex, b\.hex\).*firmware\.hex/) });
  });
});

describe('FirmwareFileCompiler', () => {
  const compiler = new FirmwareFileCompiler();

  it('runs the firmware file and says the sketch is not compiled', async () => {
    expect(compiler.available()).toBe(true);
    expect(await compiler.build({ boardTypeId: 'uno', files: { 'main.ino': 'void setup(){}', 'firmware.hex': HEX } })).toEqual({
      ok: true, hex: HEX, source: 'firmware-file', name: 'firmware.hex', messages: [NOT_COMPILED_NOTE],
    });
    expect(NOT_COMPILED_NOTE).toBe('Sketch files are not compiled yet: running firmware.hex');
    for (const sketch of ['lib/x.cpp', 'a.c']) {
      const r = await compiler.build({ boardTypeId: 'uno', files: { [sketch]: '', 'firmware.hex': HEX } });
      expect(r.ok && r.messages).toEqual([NOT_COMPILED_NOTE]);
    }
  });

  it('has no messages without sketch files, and passes pickFirmware errors on', async () => {
    const r = await compiler.build({ boardTypeId: 'uno', files: { 'firmware.hex': HEX, 'notes.txt': '' } });
    expect(r.ok && r.messages).toEqual([]);
    const bad = await compiler.build({ boardTypeId: 'uno', files: { 'main.ino': '' } });
    expect(bad).toEqual({ ok: false, errors: [expect.stringMatching(/^No firmware/)] });
  });
});

describe('compiler registry', () => {
  let undo: (() => void) | null = null;
  afterEach(() => {
    undo?.();
    undo = null;
  });

  const fake = (available: boolean, hex = 'compiled'): Compiler => ({
    id: 'fake',
    available: () => Promise.resolve(available),
    build: () => Promise.resolve({ ok: true, hex, source: 'compiled', name: 'main.ino', messages: [] }),
  });

  it('defaults to the firmware-file compiler', () => {
    expect(getCompiler('uno').id).toBe('firmware-file');
  });

  it('uses a registered compiler, and falls back to the firmware file when it is not available', async () => {
    const input = { boardTypeId: 'uno', files: { 'firmware.hex': HEX } };
    undo = registerCompiler('uno', fake(true));
    expect(getCompiler('uno').id).toBe('fake');
    expect(await buildFirmware(input)).toMatchObject({ ok: true, source: 'compiled', hex: 'compiled' });
    undo();
    undo = registerCompiler('uno', fake(false));
    expect(await buildFirmware(input)).toMatchObject({ ok: true, source: 'firmware-file', hex: HEX });
    expect(getCompiler('pico').id).toBe('firmware-file');
  });

  it('turns a throwing compiler into an error result', async () => {
    undo = registerCompiler('uno', { id: 'broken', available: () => true, build: () => Promise.reject(new Error('boom')) });
    expect(await buildFirmware({ boardTypeId: 'uno', files: {} })).toEqual({ ok: false, errors: ['The build failed: boom'] });
  });
});
