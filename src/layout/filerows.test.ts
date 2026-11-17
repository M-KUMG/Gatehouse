import { describe, expect, it } from 'vitest';
import { canonical, listTree } from '../project/filetree';
import { onOpenFile, emitOpenFile } from './fileevents';
import {
  ROOT, baseLength, checkNewName, checkRename, horizontalMove, isCodeFile, moveSelection, newItemParent, reconcile,
  remapPaths, selectionAfterDelete, visibleRows,
} from './filerows';

const entries = listTree(canonical({ 'main.ino': '', 'lib/led.h': '', 'lib/deep/x.c': '', 'notes.txt': '' }, ['empty']));
const paths = (rows: { path: string }[]): string[] => rows.map((r) => r.path);

describe('visibleRows', () => {
  it('starts with the board folder, folders first, indented by depth', () => {
    const rows = visibleRows(entries, new Set(), 'boards/uno-1');
    expect(paths(rows)).toEqual(['', 'empty', 'lib', 'lib/deep', 'lib/deep/x.c', 'lib/led.h', 'main.ino', 'notes.txt']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 2, 3, 2, 1, 1]);
    expect(rows[0]).toMatchObject({ kind: 'root', name: 'boards/uno-1' });
  });

  it('hides what is inside collapsed folders, at any depth', () => {
    const rows = visibleRows(entries, new Set(['lib']), 'r');
    expect(paths(rows)).toEqual(['', 'empty', 'lib', 'main.ino', 'notes.txt']);
    expect(rows.find((r) => r.path === 'lib')?.expanded).toBe(false);
    expect(paths(visibleRows(entries, new Set(['lib/deep']), 'r'))).toContain('lib/led.h');
    expect(paths(visibleRows(entries, new Set(['lib/deep']), 'r'))).not.toContain('lib/deep/x.c');
  });

  it('does not mistake a sibling with the same prefix for contents', () => {
    const e = listTree(canonical({ 'lib/a.h': '', 'lib2/b.h': '' }, []));
    expect(paths(visibleRows(e, new Set(['lib']), 'r'))).toEqual(['', 'lib', 'lib2', 'lib2/b.h']);
  });
});

describe('newItemParent', () => {
  const rows = visibleRows(entries, new Set(), 'r');
  it('is the selected folder, else the board folder', () => {
    expect(newItemParent(rows, 'lib')).toBe('lib');
    expect(newItemParent(rows, ROOT)).toBe(ROOT);
    expect(newItemParent(rows, 'main.ino')).toBe(ROOT);
    expect(newItemParent(rows, null)).toBe(ROOT);
  });
});

describe('typed names', () => {
  it('joins a new name to its folder and checks the path rules', () => {
    expect(checkNewName('lib', ' util.h ')).toEqual({ ok: true, path: 'lib/util.h' });
    expect(checkNewName(ROOT, 'a/b.txt')).toEqual({ ok: true, path: 'a/b.txt' });
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

describe('keyboard moves', () => {
  const rows = visibleRows(entries, new Set(['lib/deep']), 'r');

  it('moves the selection and clamps at the ends', () => {
    expect(moveSelection(rows, 'lib', 1)).toBe('lib/deep');
    expect(moveSelection(rows, ROOT, -1)).toBe(ROOT);
    expect(moveSelection(rows, 'notes.txt', 1)).toBe('notes.txt');
    expect(moveSelection(rows, null, 1)).toBe(ROOT);
    expect(moveSelection(rows, null, -1)).toBe('notes.txt');
  });

  it('Left collapses an open folder, else goes to the parent', () => {
    expect(horizontalMove(rows, 'lib', 'left')).toEqual({ kind: 'collapse', path: 'lib' });
    expect(horizontalMove(rows, 'lib/deep', 'left')).toEqual({ kind: 'select', path: 'lib' });
    expect(horizontalMove(rows, 'lib/led.h', 'left')).toEqual({ kind: 'select', path: 'lib' });
    expect(horizontalMove(rows, 'main.ino', 'left')).toEqual({ kind: 'select', path: ROOT });
    expect(horizontalMove(rows, ROOT, 'left')).toBeNull();
  });

  it('Right expands a closed folder, else goes to the first child', () => {
    expect(horizontalMove(rows, 'lib/deep', 'right')).toEqual({ kind: 'expand', path: 'lib/deep' });
    expect(horizontalMove(rows, 'lib', 'right')).toEqual({ kind: 'select', path: 'lib/deep' });
    expect(horizontalMove(rows, ROOT, 'right')).toEqual({ kind: 'select', path: 'empty' });
    expect(horizontalMove(rows, 'empty', 'right')).toBeNull();
    expect(horizontalMove(rows, 'main.ino', 'right')).toBeNull();
  });
});

describe('after changes', () => {
  const rows = visibleRows(entries, new Set(), 'r');

  it('selects what takes the place of a deleted item, else the one before', () => {
    expect(selectionAfterDelete(rows, 'lib/deep')).toBe('lib/led.h');
    expect(selectionAfterDelete(rows, 'notes.txt')).toBe('main.ino');
    expect(selectionAfterDelete(visibleRows(listTree(canonical({ 'a.txt': '' }, [])), new Set(), 'r'), 'a.txt')).toBe(ROOT);
  });

  it('keeps collapsed folders and the selection that still exist', () => {
    const now = listTree(canonical({ 'lib/led.h': '' }, []));
    const kept = reconcile(now, new Set(['lib', 'gone', 'lib/led.h']), 'lib/deep/x.c');
    expect([...kept.collapsed]).toEqual(['lib']);
    expect(kept.selected).toBe('lib');
    expect(reconcile(now, new Set(), 'lib/led.h').selected).toBe('lib/led.h');
    expect(reconcile(now, new Set(), 'zzz').selected).toBe(ROOT);
    expect(reconcile(now, new Set(), null).selected).toBeNull();
  });

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
