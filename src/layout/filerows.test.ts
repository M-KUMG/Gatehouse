import { describe, expect, it } from 'vitest';
import { onOpenFile, emitOpenFile } from './fileevents';
import { ROOT, baseLength, checkNewName, checkRename, isCodeFile, remapPaths } from './filerows';

describe('typed names', () => {
  it('joins a new name to its folder and checks the path rules', () => {
    expect(checkNewName('lib', ' util.h ')).toEqual({ ok: true, path: 'lib/util.h' });
    expect(checkNewName(ROOT, 'a/b.txt')).toEqual({ ok: true, path: 'a/b.txt' });
    expect(checkNewName(ROOT, 'copy (2).ino')).toEqual({ ok: true, path: 'copy (2).ino' });
    expect(checkNewName(ROOT, '   ')).toMatchObject({ ok: false });
    expect(checkNewName(ROOT, 'bad:name')).toMatchObject({ ok: false });
    expect(checkNewName(ROOT, '../x')).toMatchObject({ ok: false });
  });

  it('renames within the same folder only', () => {
    expect(checkRename('lib/led.h', 'led2.h')).toEqual({ ok: true, path: 'lib/led2.h', unchanged: false });
    expect(checkRename('lib/led.h', 'led.h')).toEqual({ ok: true, path: 'lib/led.h', unchanged: true });
    expect(checkRename('main.ino', 'x.ino')).toEqual({ ok: true, path: 'x.ino', unchanged: false });
    expect(checkRename('main.ino', 'sub/x.ino')).toMatchObject({ ok: false });
    expect(checkRename('main.ino', '')).toMatchObject({ ok: false });
    expect(checkRename('main.ino', 'a*b')).toMatchObject({ ok: false });
  });

  it('knows base names and code files', () => {
    expect(baseLength('main.ino')).toBe(4);
    expect(baseLength('.hidden')).toBe(7);
    expect(baseLength('Makefile')).toBe(8);
    expect(isCodeFile('led.H')).toBe(true);
    expect(isCodeFile('notes.txt')).toBe(false);
  });
});

describe('remapPaths', () => {
  it('moves collapsed folders along with a renamed folder', () => {
    const moved = remapPaths(new Set(['lib', 'lib/deep', 'library']), 'lib', 'src');
    expect([...moved].sort()).toEqual(['library', 'src', 'src/deep']);
  });
});

describe('open file events', () => {
  it('reach listeners until they stop', () => {
    const seen: string[] = [];
    const stop = onOpenFile((board, path) => seen.push(`${board}:${path}`));
    emitOpenFile('uno-1', 'main.ino');
    stop();
    emitOpenFile('uno-1', 'other.ino');
    expect(seen).toEqual(['uno-1:main.ino']);
  });
});
