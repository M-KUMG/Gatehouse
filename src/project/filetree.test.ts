import { describe, expect, it } from 'vitest';
import {
  createFile, createFolder, defaultTree, deletePath, emptyTree, kindOf, listTree, readFile, renamePath, treeError, writeFile,
  type BoardTree, type TreeResult,
} from './filetree';
import { MAX_DEPTH, MAX_FILES, MAX_FILE_BYTES, MAX_PATH_LENGTH, pathError } from './paths';

/** The tree of a successful result (fails the test otherwise). */
function tree(r: TreeResult): BoardTree {
  if (!r.ok) throw new Error(`unexpected error: ${r.error}`);
  return r.tree;
}

function error(r: TreeResult | { ok: boolean; error?: string }): string {
  expect(r.ok).toBe(false);
  return (r as { error: string }).error;
}

/** A tree with src/a.ino, src/lib/b.h, notes.txt and an empty folder docs. */
function sample(): BoardTree {
  let t = emptyTree();
  t = tree(createFile(t, 'src/a.ino', 'A'));
  t = tree(createFile(t, 'src/lib/b.h', 'B'));
  t = tree(createFile(t, 'notes.txt', 'N'));
  return tree(createFolder(t, 'docs'));
}

describe('path rules', () => {
  it('accepts normal relative paths', () => {
    for (const p of ['main.ino', 'src/led driver.h', 'a/b/c-d_e+f.cpp', 'README', '.hidden']) expect(pathError(p)).toBeNull();
  });

  it('rejects bad paths with clear messages', () => {
    expect(pathError('')).toMatch(/empty/);
    expect(pathError('/main.ino')).toMatch(/starts with "\/"/);
    expect(pathError('src/')).toMatch(/ends with "\/"/);
    expect(pathError('a//b')).toMatch(/empty folder name/);
    expect(pathError('a/../b')).toMatch(/uses "\.\."/);
    expect(pathError('./a')).toMatch(/uses "\."/);
    expect(pathError('a\\b')).toMatch(/backslash/);
    expect(pathError('a\u0001b')).toMatch(/control character/);
    expect(pathError('a\tb')).toMatch(/control character/);
    expect(pathError('a*b')).toMatch(/letters, digits, spaces/);
    expect(pathError('ünï.ino')).toMatch(/letters, digits, spaces/);
    expect(pathError(' a')).toMatch(/starts or ends with a space/);
    expect(pathError('a.')).toMatch(/ends with "\."/);
    expect(pathError('nul.txt')).toMatch(/reserved device name/);
    expect(pathError('x'.repeat(MAX_PATH_LENGTH + 1))).toMatch(/longer than 200/);
    expect(pathError(Array(MAX_DEPTH + 1).fill('d').join('/'))).toMatch(/levels deep/);
    expect(pathError(Array(MAX_DEPTH).fill('d').join('/'))).toBeNull();
  });
});

describe('file tree operations', () => {
  it('a new board has main.ino with a sketch that says it is source only', () => {
    const t = defaultTree();
    expect(Object.keys(t.files)).toEqual(['main.ino']);
    expect(t.files['main.ino']).toMatch(/void setup\(\)[\s\S]*void loop\(\)/);
    expect(t.files['main.ino']).toMatch(/cannot compile/);
  });

  it('creates files and folders, implying parent folders', () => {
    const t = sample();
    expect(kindOf(t, 'src')).toBe('folder');
    expect(kindOf(t, 'src/lib')).toBe('folder');
    expect(kindOf(t, 'docs')).toBe('folder');
    expect(kindOf(t, 'notes.txt')).toBe('file');
    expect(kindOf(t, 'nothing')).toBeNull();
    expect(listTree(t).map((e) => `${'  '.repeat(e.depth)}${e.name}${e.kind === 'folder' ? '/' : ''}`)).toEqual([
      'docs/', 'src/', '  lib/', '    b.h', '  a.ino', 'notes.txt',
    ]);
    expect(listTree(t).find((e) => e.path === 'src/a.ino')?.size).toBe(1);
  });

  it('refuses to create what exists, also with other letter case', () => {
    const t = sample();
    expect(error(createFile(t, 'notes.txt'))).toMatch(/A file named "notes.txt" already exists/);
    expect(error(createFile(t, 'NOTES.TXT'))).toMatch(/"notes.txt" already exists \(names are not case-sensitive\)/);
    expect(error(createFolder(t, 'SRC'))).toMatch(/A folder named "src" already exists/);
    expect(error(createFile(t, 'src'))).toMatch(/folder named "src" already exists/);
    expect(error(createFile(t, 'notes.txt/x.h'))).toMatch(/"notes.txt" is a file, so "notes.txt\/x.h" cannot be inside it/);
    expect(error(createFile(t, 'Notes.txt/x.h'))).toMatch(/is a file/);
    expect(error(createFile(t, 'a/../b'))).toMatch(/"\.\."/);
  });

  it('reads and writes existing files only', () => {
    let t = sample();
    expect(readFile(t, 'src/a.ino')).toEqual({ ok: true, content: 'A' });
    expect(error(readFile(t, 'src'))).toMatch(/is a folder/);
    expect(error(readFile(t, 'missing.ino'))).toMatch(/There is no file "missing.ino"/);
    t = tree(writeFile(t, 'src/a.ino', 'A2'));
    expect(t.files['src/a.ino']).toBe('A2');
    expect(error(writeFile(t, 'new.ino', 'x'))).toMatch(/There is no file/);
    const same = writeFile(t, 'src/a.ino', 'A2');
    expect(same.ok && same.tree).toBe(t); // no change: the same tree
  });

  it('renames a file, and moves it into another folder', () => {
    let t = sample();
    t = tree(renamePath(t, 'notes.txt', 'docs/notes.md'));
    expect(t.files['docs/notes.md']).toBe('N');
    expect(kindOf(t, 'notes.txt')).toBeNull();
    expect(error(renamePath(t, 'src/a.ino', 'docs/notes.md'))).toMatch(/already exists/);
    expect(error(renamePath(t, 'src/a.ino', 'DOCS/Notes.md'))).toMatch(/not case-sensitive/);
    expect(error(renamePath(t, 'gone.ino', 'x.ino'))).toMatch(/There is no file or folder "gone.ino"/);
    expect(error(renamePath(t, 'src/a.ino', 'bad*name'))).toMatch(/letters, digits/);
  });

  it('allows a rename that only changes letter case', () => {
    const t = tree(renamePath(sample(), 'src/a.ino', 'src/A.ino'));
    expect(Object.keys(t.files)).toContain('src/A.ino');
    expect(Object.keys(t.files)).not.toContain('src/a.ino');
    expect(tree(renamePath(t, 'src', 'Src')).files['Src/lib/b.h']).toBe('B');
  });

  it('renames a folder, moving everything inside it', () => {
    let t = sample();
    t = tree(createFolder(t, 'src/empty'));
    t = tree(renamePath(t, 'src', 'code/main'));
    expect(t.files).toEqual({ 'code/main/a.ino': 'A', 'code/main/lib/b.h': 'B', 'notes.txt': 'N' });
    expect(t.folders).toEqual(['code/main/empty', 'docs']);
    expect(kindOf(t, 'src')).toBeNull();
    expect(error(renamePath(t, 'code', 'code/inner'))).toMatch(/cannot be moved into itself/);
    expect(error(renamePath(t, 'code', 'docs'))).toMatch(/folder named "docs" already exists/);
  });

  it('keeps a folder when its last file is moved out or deleted', () => {
    let t = tree(createFile(emptyTree(), 'lib/x.h', 'x'));
    t = tree(renamePath(t, 'lib/x.h', 'x.h'));
    expect(kindOf(t, 'lib')).toBe('folder');
    t = tree(createFile(t, 'lib/y.h'));
    t = tree(deletePath(t, 'lib/y.h'));
    expect(kindOf(t, 'lib')).toBe('folder');
  });

  it('deletes a file, or a folder with its contents', () => {
    let t = sample();
    t = tree(deletePath(t, 'notes.txt'));
    expect(kindOf(t, 'notes.txt')).toBeNull();
    t = tree(deletePath(t, 'src'));
    expect(t.files).toEqual({});
    expect(t.folders).toEqual(['docs']);
    t = tree(deletePath(t, 'docs'));
    expect(t).toEqual(emptyTree());
    expect(error(deletePath(t, 'docs'))).toMatch(/There is no file or folder "docs"/);
  });

  it('enforces the size and count limits', () => {
    const big = 'x'.repeat(MAX_FILE_BYTES + 1);
    expect(error(createFile(emptyTree(), 'big.txt', big))).toMatch(/at most 512 KB/);
    expect(error(writeFile(defaultTree(), 'main.ino', big))).toMatch(/at most 512 KB/);
    // Multi-byte characters count as their UTF-8 size.
    expect(error(createFile(emptyTree(), 'u.txt', 'é'.repeat(MAX_FILE_BYTES / 2 + 1)))).toMatch(/512 KB/);
    let t = emptyTree();
    for (let i = 0; i < MAX_FILES; i++) t = tree(createFile(t, `f${i}.h`));
    expect(error(createFile(t, 'one-more.h'))).toMatch(/at most 200 files/);
  });

  it('checks a whole tree (for loading) the same way', () => {
    expect(treeError(sample())).toBeNull();
    expect(treeError({ files: { 'A.ino': '', 'a.ino': '' }, folders: [] })).toMatch(/differ only in letter case/);
    expect(treeError({ files: { 'a.ino': '' }, folders: ['A.INO'] })).toMatch(/differ only in letter case/);
    expect(treeError({ files: { a: '', 'a/b': '' }, folders: [] })).toMatch(/"a" is a file/);
    expect(treeError({ files: { '../x': '' }, folders: [] })).toMatch(/"\.\."/);
  });

  it('never lets "__proto__" turn into a prototype', () => {
    const t = tree(createFile(emptyTree(), '__proto__', 'p'));
    expect(Object.keys(t.files)).toEqual(['__proto__']);
    const moved = tree(renamePath(t, '__proto__', 'x/__proto__'));
    expect(moved.files['x/__proto__']).toBe('p');
  });
});
