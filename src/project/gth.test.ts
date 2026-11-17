import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createBoardFile, createBoardFolder } from './boardfiles';
import { projectFromBytes, projectToGth } from './diskfile';
import { fileNameFor, projectNameFromFile, safeBaseName } from './filename';
import { ProjectError, stringifyProject } from './format';
import { decodeGth, encodeGth, MAX_ENTRIES } from './gth';
import { Project } from './project';
import { toFileMap, type FileMap } from './storage';

/** A project with a resistor and one Uno whose tree has a few extra entries. */
function sample(): Project {
  const p = new Project();
  p.scene.add({ typeId: 'resistor', col: 0, row: 0, rotation: 0 });
  const boardId = p.scene.add({ typeId: 'uno', col: 10, row: 0, rotation: 0 }).boardId!;
  expect(createBoardFile(p, boardId, 'lib/led.h', '// héllo ✓\n#define LED 13\n').ok).toBe(true);
  expect(createBoardFolder(p, boardId, 'empty dir').ok).toBe(true);
  return p;
}

const sampleMap = (): FileMap => toFileMap(sample().serialize());

/** A zip of `files` (path -> text or raw bytes). */
function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  const z: Zippable = {};
  for (const [path, data] of Object.entries(files)) z[path] = typeof data === 'string' ? strToU8(data) : data;
  return zipSync(z, { level: 0 });
}

function errorOf(load: () => unknown): string {
  try {
    load();
  } catch (e) {
    expect(e).toBeInstanceOf(ProjectError);
    return (e as Error).message;
  }
  throw new Error('expected a ProjectError');
}

/** Set every central-directory "uncompressed size" in a zip to `size`. */
function declareSize(bytes: Uint8Array, size: number): Uint8Array {
  const out = bytes.slice();
  const view = new DataView(out.buffer);
  for (let i = 0; i + 46 <= out.length; i++) if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, size, true);
  return out;
}

describe('.gth files', () => {
  it('round-trips a project through .gth bytes', () => {
    const file = { ...sample().serialize(), name: 'My robot' };
    const bytes = projectToGth(file);
    const read = projectFromBytes('My robot.gth', bytes);
    expect(read.legacy).toBe(false);
    expect(read.file).toEqual(file);
  });

  it('puts everything under one folder named after the project', () => {
    const names = Object.keys(unzipSync(encodeGth('my-robot', sampleMap()))).sort();
    expect(names).toEqual(['my-robot/boards/uno-1/lib/led.h', 'my-robot/boards/uno-1/main.ino', 'my-robot/gatehouse.json']);
    expect(Object.keys(unzipSync(encodeGth('a/b:c?', { 'gatehouse.json': '{}' })))).toEqual(['a_b_c_/gatehouse.json']);
  });

  it('writes the same bytes for the same project', () => {
    const map = sampleMap();
    const a = encodeGth('p', map);
    const b = encodeGth('p', Object.fromEntries(Object.entries(map).reverse()));
    expect(b).toEqual(a);
  });

  it('opens files at the zip root and under any single top-level folder', () => {
    const map = sampleMap();
    expect(decodeGth(zip(map))).toEqual({ fileMap: map });
    const nested = Object.fromEntries(Object.entries(map).map(([k, v]) => [`Other Name/${k}`, v]));
    expect(decodeGth(zip(nested))).toEqual({ folder: 'Other Name', fileMap: map });
    const named = projectFromBytes('blink.gth', zip(nested)).file;
    expect(named.name).toBe('blink');
  });

  it('ignores directory entries and zip-tool junk', () => {
    const map = sampleMap();
    const junk = { 'p/': new Uint8Array(), 'p/.DS_Store': 'x', '__MACOSX/p/._main.ino': 'x', 'p/boards/Thumbs.db': 'x' };
    const nested = Object.fromEntries(Object.entries(map).map(([k, v]) => [`p/${k}`, v]));
    expect(decodeGth(zip({ ...junk, ...nested })).fileMap).toEqual(map);
  });

  it('still opens the older single JSON files, and marks them legacy', () => {
    const v3 = { ...sample().serialize(), name: 'x' };
    const read = projectFromBytes('blink.gatehouse.json', strToU8(stringifyProject(v3)));
    expect(read.legacy).toBe(true);
    expect(read.file).toEqual({ ...v3, name: 'blink' });
    const v1 = '{"format":"gatehouse-project","version":1,"name":"old","parts":[],"wires":[]}';
    expect(projectFromBytes('old.json', strToU8(v1)).file.parts).toEqual([]);
  });

  it('derives the project name from the file name', () => {
    expect(projectNameFromFile('my-robot.gth')).toBe('my-robot');
    expect(projectNameFromFile('Blink.GTH')).toBe('Blink');
    expect(projectNameFromFile('blink.gatehouse.json')).toBe('blink');
    expect(projectNameFromFile('blink.json')).toBe('blink');
    expect(projectNameFromFile('.gth')).toBe('.gth');
    expect(fileNameFor('my robot')).toBe('my robot.gth');
    expect(fileNameFor('  ')).toBe('project.gth');
    expect(safeBaseName('a. ')).toBe('a');
  });
});

describe('.gth errors', () => {
  const map = sampleMap();

  it('rejects files that are not zips', () => {
    expect(errorOf(() => projectFromBytes('x.gth', strToU8('hello')))).toMatch(/not a zip archive/);
    expect(errorOf(() => decodeGth(strToU8('hello')))).toMatch(/not a .gth/);
    const truncated = encodeGth('p', map).slice(0, 60);
    expect(errorOf(() => decodeGth(truncated))).toMatch(/damaged/);
  });

  it('needs gatehouse.json at the top or in one folder', () => {
    expect(errorOf(() => decodeGth(zip({ 'boards/uno-1/main.ino': '' })))).toMatch(/no gatehouse.json/);
    expect(errorOf(() => decodeGth(zip({ 'a/b/gatehouse.json': '{}' })))).toMatch(/no gatehouse.json/);
    expect(errorOf(() => decodeGth(zip({ 'a/gatehouse.json': '{}', 'b/x': '' })))).toMatch(/no gatehouse.json/);
  });

  it('rejects files for unknown boards and files outside boards/', () => {
    expect(errorOf(() => projectFromBytes('p.gth', zip({ ...map, 'boards/uno-9/x.ino': '' })))).toMatch(/board "uno-9", which is not a board/);
    expect(errorOf(() => projectFromBytes('p.gth', zip({ ...map, 'notes.txt': '' })))).toMatch(/Unexpected file "notes.txt"/);
  });

  it('rejects unsafe paths', () => {
    expect(errorOf(() => decodeGth(zip({ ...map, 'boards/../../evil': '' })))).toMatch(/outside the project folder/);
    expect(errorOf(() => decodeGth(zip({ ...map, '/etc/passwd': '' })))).toMatch(/absolute path/);
    expect(errorOf(() => decodeGth(zip({ ...map, 'C:/x': '' })))).toMatch(/absolute path/);
    expect(errorOf(() => decodeGth(zip({ ...map, 'boards\\uno-1\\x': '' })))).toMatch(/uses "\\"/);
    expect(errorOf(() => decodeGth(zip({ ...map, 'boards/uno-1/a\u0001': '' })))).toMatch(/control characters/);
    expect(errorOf(() => decodeGth(zip({ ...map, 'boards//x': '' })))).toMatch(/empty or "\."/);
  });

  it('rejects names that collide, exactly or by case', () => {
    expect(errorOf(() => decodeGth(zip({ ...map, 'boards/uno-1/MAIN.ino': '' })))).toMatch(/differ only in case/);
    // fflate will not write a name twice, so rename "a/y.txt" to "a/x.txt" in the bytes.
    const twice = zip({ 'a/x.txt': '1', 'a/y.txt': '2' });
    for (let i = 0; i < twice.length; i++) if (twice[i] === 0x79 && twice[i + 1] === 0x2e) twice[i] = 0x78; // "y." -> "x."
    expect(errorOf(() => decodeGth(twice))).toMatch(/holds "a\/x.txt" twice/);
  });

  it('rejects too many entries', () => {
    const many: Record<string, string> = { ...map };
    for (let i = 0; i < MAX_ENTRIES; i++) many[`boards/uno-1/f${i}.h`] = '';
    expect(errorOf(() => decodeGth(zip(many)))).toMatch(/more than 5000 entries/);
  });

  it('rejects oversized entries before inflating them', () => {
    const big = zipSync({ ...Object.fromEntries(Object.entries(map).map(([k, v]) => [k, strToU8(v)])), 'boards/uno-1/big.h': strToU8('x'.repeat(600 * 1024)) });
    expect(big.length).toBeLessThan(10_000); // highly compressible
    expect(errorOf(() => decodeGth(big))).toMatch(/"boards\/uno-1\/big.h" is 600 KB; a file can be at most 512 KB/);
    // A lying directory that claims a huge size is refused without allocating it.
    expect(errorOf(() => decodeGth(declareSize(zip({ 'gatehouse.json': '{}' }), 0xfffffff0)))).toMatch(/at most 16384 KB/);
    const lots: Record<string, string> = { 'gatehouse.json': '{}' };
    for (let i = 0; i < 200; i++) lots[`boards/b/f${i}`] = 'x';
    expect(errorOf(() => decodeGth(declareSize(zip(lots), 500 * 1024)))).toMatch(/unpacks to more than 64 MB/);
  });

  it('rejects entries that are not UTF-8 text', () => {
    expect(errorOf(() => decodeGth(zip({ ...map, 'boards/uno-1/x.bin': new Uint8Array([0xff, 0xfe, 0x41]) })))).toMatch(/not valid UTF-8/);
    expect(errorOf(() => decodeGth(zip({ ...map, 'boards/uno-1/x.bin': new Uint8Array([0x41, 0, 0x42]) })))).toMatch(/not a text file/);
  });

  it('reports bad project content inside a valid zip', () => {
    expect(errorOf(() => projectFromBytes('p.gth', zip({ ...map, 'gatehouse.json': 'nope' })))).toMatch(/not valid JSON/);
  });
});
