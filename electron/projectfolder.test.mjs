// Tests for electron/projectfolder.cjs (a project as a real folder) on a temporary directory.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const F = require('./projectfolder.cjs');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-folder-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const project = (extra = {}) => ({
  'gatehouse.json': '{"name":"p"}\n',
  'boards/uno-1/main.ino': 'void setup(){}',
  'boards/uno-1/src/a.h': '#define A 1',
  ...extra,
});

describe('writeFolder / readFolder', () => {
  it('round-trips a project, creating folders', () => {
    const target = path.join(dir, 'new', 'proj');
    F.writeFolder(target, project());
    expect(F.readFolder(target)).toEqual(project());
  });

  it('replaces changed files, deletes removed ones and the folders they leave empty, keeps foreign files', () => {
    F.writeFolder(dir, project());
    fs.writeFileSync(path.join(dir, 'README.md'), 'mine');
    F.writeFolder(dir, { 'gatehouse.json': '{"name":"q"}\n', 'boards/uno-1/main.ino': 'new' });
    expect(F.readFolder(dir)).toEqual({ 'gatehouse.json': '{"name":"q"}\n', 'boards/uno-1/main.ino': 'new' });
    expect(fs.existsSync(path.join(dir, 'boards/uno-1/src'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'README.md'), 'utf8')).toBe('mine');
  });

  it('leaves no temporary files behind', () => {
    F.writeFolder(dir, project());
    const all = fs.readdirSync(dir, { recursive: true });
    expect(all.some((n) => String(n).endsWith('.tmp'))).toBe(false);
  });

  it('refuses paths outside the layout, traversal, Windows device names and a missing manifest', () => {
    for (const bad of ['../x', 'boards/../x', 'boards/uno-1/../../x', '/abs', 'other.txt', 'boards/x', 'boards/uno-1/nul.txt', 'boards/uno-1/a:b', 'boards/uno-1/a\\b', 'boards//a/b', 'boards/uno-1/trail.']) {
      expect(() => F.writeFolder(dir, { 'gatehouse.json': '{}', [bad]: 'x' }), bad).toThrow(F.FolderError);
    }
    expect(() => F.writeFolder(dir, { 'boards/uno-1/a': 'x' })).toThrow(/manifest/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('reads only the manifest and boards/, ignoring other files', () => {
    F.writeFolder(dir, project());
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    fs.mkdirSync(path.join(dir, '.git'));
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref');
    expect(Object.keys(F.readFolder(dir)).sort()).toEqual(Object.keys(project()).sort());
  });

  it('refuses a folder without a manifest, a binary file and an oversized file', () => {
    expect(() => F.readFolder(dir)).toThrow(/not a Gatehouse project/);
    F.writeFolder(dir, project());
    fs.writeFileSync(path.join(dir, 'boards/uno-1/bin.dat'), Buffer.from([0xff, 0xfe, 0x00, 0x80]));
    expect(() => F.readFolder(dir)).toThrow(/not a text file/);
    fs.writeFileSync(path.join(dir, 'boards/uno-1/bin.dat'), Buffer.alloc(9 * 1024 * 1024, 97));
    expect(() => F.readFolder(dir)).toThrow(/too large/);
  });

  it('does not follow symlinks (skipped when the system allows making them)', () => {
    F.writeFolder(dir, project());
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    try {
      fs.symlinkSync(outside, path.join(dir, 'boards', 'link'), 'junction');
    } catch {
      fs.rmSync(outside, { recursive: true, force: true });
      return;
    }
    expect(Object.keys(F.readFolder(dir))).not.toContain('boards/link/secret.txt');
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

describe('inspectFolder', () => {
  it('tells an empty folder, a project and another folder apart', () => {
    expect(F.inspectFolder(dir)).toBe('empty');
    fs.writeFileSync(path.join(dir, 'x.txt'), '1');
    expect(F.inspectFolder(dir)).toBe('other');
    F.writeFolder(dir, project());
    expect(F.inspectFolder(dir)).toBe('project');
  });
  it('calls a folder that does not exist yet new, and refuses a file', () => {
    expect(F.inspectFolder(path.join(dir, 'nope'))).toBe('new');
    fs.writeFileSync(path.join(dir, 'f.txt'), '1');
    expect(() => F.inspectFolder(path.join(dir, 'f.txt'))).toThrow(F.FolderError);
  });
});

describe('with the real project format', () => {
  it('a project saved to a folder and read back is the same project', async () => {
    const { Project } = await import('../src/project/project');
    const { fromFileMap, toFileMap } = await import('../src/project/storage');
    const p = new Project();
    p.scene.add({ typeId: 'resistor', col: 2, row: 3, rotation: 0, state: { value: 330 } });
    p.scene.add({ typeId: 'uno', col: 10, row: 3, rotation: 0 });
    const file = { ...p.serialize(), name: 'demo', savedAt: '2026-11-21T00:00:00.000Z' };
    F.writeFolder(dir, toFileMap(file));
    const back = fromFileMap(F.readFolder(dir));
    expect(back).toEqual({ ...file, name: 'demo' });
    expect(Object.keys(F.readFolder(dir)).some((k) => k.startsWith('boards/'))).toBe(true);
  });
});
