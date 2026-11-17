import { describe, expect, it } from 'vitest';
import {
  boardTree, createBoardFile, createBoardFolder, deleteBoardPath, listBoardFiles, listBoards, readBoardFile, renameBoardPath,
  writeBoardFile,
} from './boardfiles';
import { DEFAULT_SKETCH, defaultTree } from './filetree';
import { ProjectError, stringifyProject } from './format';
import { COALESCE_MS } from './history';
import { migrate } from './migrate';
import { Project } from './project';
import { readProject, readProjectDocument } from './read';
import { MemoryStorage, fromFileMap, toFileMap, writeFileMap } from './storage';
import { UndoManager } from './undo';

/** A hand-written v2 file with two boards between other parts. */
const V2_FIXTURE = `{
  "format": "gatehouse-project",
  "version": 2,
  "name": "Two boards",
  "parts": [
    { "id": 1, "typeId": "battery9v", "col": 0, "row": 0, "rotation": 0 },
    { "id": 2, "typeId": "uno", "col": 10, "row": 0, "rotation": 0 },
    { "id": 3, "typeId": "resistor", "col": 0, "row": 10, "rotation": 0, "state": { "value": 220 } },
    { "id": 4, "typeId": "uno", "col": 40, "row": 0, "rotation": 90 }
  ],
  "wires": [
    { "id": 5, "from": { "partId": 1, "pinId": "pos" }, "to": { "partId": 3, "pinId": "a" }, "waypoints": [] }
  ],
  "junctions": []
}`;

const add = (p: Project, typeId: string, col = 0) => p.scene.add({ typeId, col, row: 0, rotation: 0 });

/** A project with one Uno whose tree has a few extra entries. */
function withBoard(): { p: Project; boardId: string } {
  const p = new Project();
  add(p, 'resistor');
  const boardId = add(p, 'uno', 10).boardId!;
  expect(createBoardFile(p, boardId, 'lib/led.h', '#define LED 13\n').ok).toBe(true);
  expect(createBoardFolder(p, boardId, 'empty dir').ok).toBe(true);
  return { p, boardId };
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

/** The withBoard project as a document, changed by `edit`, read back. */
function readEdited(edit: (doc: any) => void): () => unknown {
  const doc = JSON.parse(stringifyProject(withBoard().p.serialize()));
  edit(doc);
  return () => readProject(JSON.stringify(doc));
}

describe('board identity', () => {
  it('gives boards (only) a boardId and the default tree', () => {
    const p = new Project();
    const r = add(p, 'resistor');
    const a = add(p, 'uno');
    const b = add(p, 'uno');
    expect(r.boardId).toBeUndefined();
    expect([a.boardId, b.boardId]).toEqual(['uno-1', 'uno-2']);
    expect(p.scene.files).toEqual({ 'uno-1': defaultTree(), 'uno-2': defaultTree() });
    expect(Object.keys(a)).toEqual(['id', 'typeId', 'boardId', 'col', 'row', 'rotation']);
  });

  it('never reuses a boardId, also after deleting, undoing, saving and opening', () => {
    const p = new Project();
    add(p, 'uno');
    const second = add(p, 'uno');
    p.scene.remove(second.id);
    expect(p.scene.files['uno-2']).toBeUndefined(); // its files went with it
    expect(add(p, 'uno').boardId).toBe('uno-3');
    const reopened = new Project();
    reopened.load(readProject(stringifyProject(p.serialize())));
    expect(reopened.serialize().boardCounters).toEqual({ uno: 3 });
    const all = reopened.scene.parts.map((x) => x.id);
    reopened.scene.removeMany(all, []);
    expect(add(reopened, 'uno').boardId).toBe('uno-4');
  });

  it('duplicating a board gives the copy a new boardId and a copy of its files', () => {
    const { p, boardId } = withBoard();
    const board = p.scene.parts.find((x) => x.boardId === boardId)!;
    // As Selection.duplicate does it.
    const copy = p.scene.insert(p.scene.snapshot(new Set([board.id])), 1, 1).parts[0];
    expect(copy.boardId).toBe('uno-2');
    expect(p.scene.files['uno-2']).toEqual(p.scene.files[boardId]);
    expect(p.scene.files['uno-2']).not.toBe(p.scene.files[boardId]);
    writeBoardFile(p, 'uno-2', 'main.ino', 'changed');
    expect(readBoardFile(p, boardId, 'main.ino')).toEqual({ ok: true, content: DEFAULT_SKETCH });
  });
});

describe('board files API', () => {
  it('lists boards with labels and their files', () => {
    const { p, boardId } = withBoard();
    expect(listBoards(p)).toEqual([{ boardId, partId: 2, typeId: 'uno', label: 'Arduino Uno #2' }]);
    expect(listBoardFiles(p, boardId)?.map((e) => e.path)).toEqual(['empty dir', 'lib', 'lib/led.h', 'main.ino']);
    expect(boardTree(p, 'uno-9')).toBeNull();
    expect(createBoardFile(p, 'uno-9', 'x.ino')).toEqual({ ok: false, error: 'There is no board "uno-9" in this project.' });
  });

  it('changes notify, mark the project dirty and can be renamed and deleted', () => {
    const { p, boardId } = withBoard();
    p.markSaved('Saved');
    let calls = 0;
    p.onChange(() => calls++);
    expect(renameBoardPath(p, boardId, 'lib', 'include').ok).toBe(true);
    expect(p.dirty).toBe(true);
    expect(calls).toBe(1);
    expect(readBoardFile(p, boardId, 'include/led.h')).toEqual({ ok: true, content: '#define LED 13\n' });
    expect(deleteBoardPath(p, boardId, 'include').ok).toBe(true);
    expect(createBoardFile(p, boardId, 'MAIN.INO').ok).toBe(false); // case-insensitive duplicate
    expect(calls).toBe(2); // failures change nothing
    expect(boardTree(p, boardId)?.folders).toEqual(['empty dir']);
  });
});

describe('project format v3', () => {
  it('migrates a v2 file: boards get ids in order and the default tree, other parts untouched', () => {
    const v2 = JSON.parse(V2_FIXTURE);
    const out = migrate(v2);
    expect(out.version).toBe(3);
    expect(out.parts).toEqual([v2.parts[0], { ...v2.parts[1], boardId: 'uno-1' }, v2.parts[2], { ...v2.parts[3], boardId: 'uno-2' }]);
    expect(out.files).toEqual({ 'uno-1': defaultTree(), 'uno-2': defaultTree() });
    expect(out.boardCounters).toEqual({ uno: 2 });
    const p = new Project();
    p.load(readProject(V2_FIXTURE));
    expect(add(p, 'uno').boardId).toBe('uno-3');
  });

  it('round-trips: serialize -> text -> load -> serialize is unchanged', () => {
    const first = withBoard().p.serialize();
    const b = new Project();
    b.load(readProject(stringifyProject(first)));
    expect(stringifyProject(b.serialize())).toBe(stringifyProject(first));
    expect(b.dirty).toBe(false);
  });

  it('rejects broken board data with clear messages', () => {
    expect(errorOf(readEdited((d) => delete d.parts[1].boardId))).toMatch(/parts\[1\] is a board but has no "boardId"/);
    expect(errorOf(readEdited((d) => (d.parts[0].boardId = 'res-1')))).toMatch(/parts\[0\] has a "boardId", but a resistor part is not a board/);
    expect(errorOf(readEdited((d) => (d.parts[1].boardId = 'Uno 1')))).toMatch(/boardId must look like "uno-1"/);
    expect(
      errorOf(readEdited((d) => d.parts.push({ ...d.parts[1], id: 50 }))),
    ).toMatch(/parts\[2\]\.boardId "uno-1" is also used by parts\[1\]/);
    expect(errorOf(readEdited((d) => (d.files['uno-7'] = { files: {}, folders: [] })))).toMatch(
      /"files" has files for board "uno-7", which is not a board in this project/,
    );
    expect(errorOf(readEdited((d) => delete d.files['uno-1']))).toMatch(/parts\[1\] \(board "uno-1"\) has no entry in "files"/);
    expect(errorOf(readEdited((d) => (d.files['uno-1'].files['../evil'] = '')))).toMatch(/files\["uno-1"\]: .*"\.\."/);
    expect(errorOf(readEdited((d) => (d.files['uno-1'].files['MAIN.ino'] = '')))).toMatch(/differ only in letter case/);
    expect(errorOf(readEdited((d) => (d.files['uno-1'].files['main.ino'] = 'x'.repeat(600 * 1024))))).toMatch(/at most 512 KB/);
    expect(errorOf(readEdited((d) => (d.files['uno-1'].files['main.ino'] = 5)))).toMatch(/must be text/);
    expect(errorOf(readEdited((d) => (d.boardCounters.uno = -1)))).toMatch(/boardCounters\.uno must be a whole number/);
  });
});

describe('folder layout (storage seam)', () => {
  it('maps a project to gatehouse.json plus boards/<boardId>/<path> and back', async () => {
    const file = withBoard().p.serialize();
    const map = toFileMap(file);
    expect(Object.keys(map).sort()).toEqual(['boards/uno-1/lib/led.h', 'boards/uno-1/main.ino', 'gatehouse.json']);
    const manifest = JSON.parse(map['gatehouse.json']);
    expect(manifest.files).toBeUndefined();
    expect(manifest.boards).toEqual([{ boardId: 'uno-1', folders: ['empty dir'] }]);
    expect(fromFileMap(map)).toEqual(readProjectDocument(file));

    const storage = new MemoryStorage({ 'boards/uno-1/stale.h': 'old' });
    await writeFileMap(storage, map);
    expect(await storage.list()).toEqual(Object.keys(map).sort());
    expect(fromFileMap(await storage.readAll())).toEqual(file);
  });

  it('validates the folder layout the same way', () => {
    const map = toFileMap(withBoard().p.serialize());
    expect(errorOf(() => fromFileMap({ ...map, 'boards/uno-5/x.ino': '' }))).toMatch(/board "uno-5", which is not a board/);
    expect(errorOf(() => fromFileMap({ ...map, 'stray.txt': '' }))).toMatch(/Unexpected file "stray.txt"/);
    expect(errorOf(() => fromFileMap({ ...map, 'boards/uno-1/A/../b': '' }))).toMatch(/"\.\."/);
    expect(errorOf(() => fromFileMap({ 'boards/uno-1/main.ino': '' }))).toMatch(/no gatehouse.json/);
  });
});

describe('undo / redo of board files', () => {
  function setup(): { p: Project; undo: UndoManager; tick: () => void } {
    const p = new Project();
    let time = 0;
    const undo = new UndoManager(p, { busy: () => false, beforeRestore: () => undefined, afterRestore: () => undefined }, () => time);
    const tick = (): void => {
      time += COALESCE_MS * 10;
      p.checkForChanges();
      undo.settle();
    };
    return { p, undo, tick };
  }

  it('a file change is one undoable step', () => {
    const { p, undo, tick } = setup();
    const boardId = add(p, 'uno').boardId!;
    tick();
    writeBoardFile(p, boardId, 'main.ino', 'void setup() {}\n');
    tick();
    expect(undo.undo()).toBe(true);
    expect(readBoardFile(p, boardId, 'main.ino')).toEqual({ ok: true, content: DEFAULT_SKETCH });
    expect(undo.redo()).toBe(true);
    expect(readBoardFile(p, boardId, 'main.ino')).toEqual({ ok: true, content: 'void setup() {}\n' });
  });

  it('deleting a board removes its tree; undo brings both back, and new boards still get new ids', () => {
    const { p, undo, tick } = setup();
    const board = add(p, 'uno');
    tick();
    createBoardFile(p, 'uno-1', 'extra.h', 'x');
    tick();
    p.scene.remove(board.id);
    tick();
    expect(p.scene.files).toEqual({});
    expect(undo.undo()).toBe(true);
    expect(p.scene.parts.map((x) => x.boardId)).toEqual(['uno-1']);
    expect(readBoardFile(p, 'uno-1', 'extra.h')).toEqual({ ok: true, content: 'x' });
    expect(undo.redo()).toBe(true);
    expect(p.scene.files).toEqual({});
    expect(undo.undo()).toBe(true);
    expect(add(p, 'uno').boardId).toBe('uno-2');
  });
});
