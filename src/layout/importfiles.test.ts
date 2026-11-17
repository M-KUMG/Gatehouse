import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, pathError } from '../project/paths';
import { PARTS } from '../parts';
import {
  decodeText, dropTarget, extensionError, extensionList, importTarget, sizeError, splitName, summarizeImport, uniqueName,
} from './importfiles';

const UNO = ['ino', 'cpp', 'c', 'h', 'hpp', 'txt', 'md', 'hex'];
const bytes = (...n: number[]): Uint8Array => new Uint8Array(n);
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('accepted extensions', () => {
  it('the Uno takes sketches, C/C++ sources, headers, text, markdown and firmware', () => {
    expect(PARTS.find((p) => p.id === 'uno')?.sourceExtensions).toEqual(UNO);
    for (const n of ['main.ino', 'a.cpp', 'a.C', 'a.h', 'a.HPP', 'notes.txt', 'README.md']) expect(extensionError(n, UNO), n).toBeNull();
  });

  it('refuses the others and lists what is accepted', () => {
    const e = extensionError('blink.py', UNO) ?? '';
    expect(e).toContain('"blink.py" is a .py file');
    expect(e).toContain(extensionList(UNO));
    expect(extensionList(['ino', 'py'])).toBe('.ino, .py');
    expect(extensionError('Makefile', UNO)).toMatch(/no file extension/);
    expect(extensionError('x.py', ['py', 'txt'])).toBeNull(); // a Pico type only lists .py
  });

  it('takes a compiled .hex (the board firmware) like any other file', () => {
    expect(extensionError('Blink.ino.hex', UNO)).toBeNull();
    expect(extensionError('firmware.HEX', UNO)).toBeNull();
    expect(extensionError('firmware.hex', ['py'])).toMatch(/is a \.hex file/); // only where the type lists it
  });

  it('a board type without extensions takes nothing', () => {
    expect(extensionError('a.ino', [])).toMatch(/does not take/);
  });
});

describe('reading bytes as text', () => {
  it('accepts UTF-8 and drops a byte order mark', () => {
    expect(decodeText('a.txt', text('héllo\n'))).toEqual({ ok: true, text: 'héllo\n' });
    expect(decodeText('a.txt', bytes(0xef, 0xbb, 0xbf, 0x68, 0x69))).toEqual({ ok: true, text: 'hi' });
    expect(decodeText('a.txt', bytes())).toEqual({ ok: true, text: '' });
  });

  it('refuses bytes that are not UTF-8, and NUL', () => {
    expect(decodeText('a.txt', bytes(0x68, 0xff, 0xfe))).toMatchObject({ ok: false, reason: expect.stringMatching(/not valid UTF-8/) });
    expect(decodeText('a.txt', bytes(0x68, 0x00, 0x69))).toMatchObject({ ok: false, reason: expect.stringMatching(/NUL/) });
  });

  it('checks the size in the tree words', () => {
    expect(sizeError('a.txt', MAX_FILE_BYTES)).toBeNull();
    expect(sizeError('a.txt', MAX_FILE_BYTES + 1)).toMatch(/a file can be at most 512 KB/);
  });
});

describe('uniqueName', () => {
  const taken = (...n: string[]): Set<string> => new Set(n.map((x) => x.toLowerCase()));

  it('keeps a free name', () => {
    expect(uniqueName('main.ino', taken('other.ino'))).toBe('main.ino');
  });

  it('adds (2), (3) before the extension until free, ignoring letter case', () => {
    expect(uniqueName('main.ino', taken('main.ino'))).toBe('main (2).ino');
    expect(uniqueName('main.ino', taken('main.ino', 'main (2).ino'))).toBe('main (3).ino');
    expect(uniqueName('Main.INO', taken('main.ino'))).toBe('Main (2).INO');
  });

  it('works for names without an extension and for dotted names', () => {
    expect(uniqueName('Makefile', taken('makefile'))).toBe('Makefile (2)');
    expect(uniqueName('.hidden', taken('.hidden'))).toBe('.hidden (2)');
    expect(uniqueName('a.b.txt', taken('a.b.txt'))).toBe('a.b (2).txt');
    expect(splitName('a.b.txt')).toEqual({ base: 'a.b', ext: '.txt' });
  });

  it('makes names the path rules accept', () => {
    expect(pathError(uniqueName('main.ino', taken('main.ino')))).toBeNull();
  });
});

describe('where files go', () => {
  const board = { kind: 'board', boardId: 'uno-1', path: '' } as const;
  const folder = { kind: 'folder', boardId: 'uno-1', path: 'lib/deep' } as const;
  const file = { kind: 'file', boardId: 'uno-2', path: 'lib/led.h' } as const;
  const top = { kind: 'file', boardId: 'uno-2', path: 'main.ino' } as const;

  it('a drop goes to the board, the folder, or the folder of the file under it', () => {
    expect(dropTarget(board)).toEqual({ boardId: 'uno-1', folder: '' });
    expect(dropTarget(folder)).toEqual({ boardId: 'uno-1', folder: 'lib/deep' });
    expect(dropTarget(file)).toEqual({ boardId: 'uno-2', folder: 'lib' });
    expect(dropTarget(top)).toEqual({ boardId: 'uno-2', folder: '' });
  });

  it('a drop elsewhere does nothing', () => {
    for (const kind of ['project', 'manifest', 'boards'] as const) expect(dropTarget({ kind }), kind).toBeNull();
    expect(dropTarget(null)).toBeNull();
  });

  it('the button uses the selection, else the active board folder, else nothing', () => {
    expect(importTarget(folder, 'uno-2')).toEqual({ boardId: 'uno-1', folder: 'lib/deep' });
    expect(importTarget(file, 'uno-1')).toEqual({ boardId: 'uno-2', folder: 'lib' });
    expect(importTarget({ kind: 'boards' }, 'uno-2')).toEqual({ boardId: 'uno-2', folder: '' });
    expect(importTarget({ kind: 'manifest' }, 'uno-2')).toEqual({ boardId: 'uno-2', folder: '' });
    expect(importTarget(null, 'uno-1')).toEqual({ boardId: 'uno-1', folder: '' });
    expect(importTarget(null, null)).toBeNull();
    expect(importTarget({ kind: 'project' }, null)).toBeNull();
  });
});

describe('summarizeImport', () => {
  it('reports a clean import quietly', () => {
    expect(summarizeImport({ imported: 3, renamed: 0, skipped: [] })).toEqual({ text: 'Imported 3 files', kind: 'info' });
    expect(summarizeImport({ imported: 1, renamed: 0, skipped: [] }).text).toBe('Imported 1 file');
  });

  it('mentions renames and skips with the reason', () => {
    const s = summarizeImport({ imported: 3, renamed: 1, skipped: [{ name: 'a.py', reason: '"a.py" is a .py file; this board takes .ino.' }] });
    expect(s.text).toBe('Imported 3 files (1 renamed to keep both), 1 skipped: "a.py" is a .py file; this board takes .ino.');
    expect(s.kind).toBe('error');
  });

  it('spells out three reasons at most', () => {
    const skipped = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ name: n, reason: `${n} skipped.` }));
    expect(summarizeImport({ imported: 1, renamed: 0, skipped }).text).toBe('Imported 1 file, 5 skipped: a skipped. b skipped. c skipped. and 2 more.');
  });

  it('says so when nothing came in', () => {
    const s = summarizeImport({ imported: 0, renamed: 0, skipped: [{ name: 'x', reason: 'x is bad.' }] });
    expect(s).toEqual({ text: 'Nothing was imported. x is bad.', kind: 'error' });
    expect(summarizeImport({ imported: 0, renamed: 0, skipped: [] }).kind).toBe('info');
  });
});
