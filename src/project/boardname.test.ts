import { describe, expect, it } from 'vitest';
import { boardLabel, boardLabelWithId, customBoardName, defaultBoardLabel } from '../parts';
import { listBoards, renameBoard } from './boardfiles';
import { MAX_BOARD_NAME_LENGTH, normalizeBoardName } from './boardname';
import { projectFromBytes, projectToGth } from './diskfile';
import { ProjectError, stringifyProject } from './format';
import { COALESCE_MS } from './history';
import { Project } from './project';
import { readProject } from './read';
import { UndoManager } from './undo';

const ok = (name: string | null) => ({ ok: true, name });

describe('normalizeBoardName', () => {
  it('trims and collapses inner white space to one space', () => {
    expect(normalizeBoardName('  Front   door   alarm  ')).toEqual(ok('Front door alarm'));
  });

  it('empty or blank means "use the default name"', () => {
    expect(normalizeBoardName('')).toEqual(ok(null));
    expect(normalizeBoardName('   ')).toEqual(ok(null));
    expect(normalizeBoardName(' 　')).toEqual(ok(null)); // other white space too
  });

  it('allows 40 characters, refuses 41 (counted after cleaning up)', () => {
    expect(normalizeBoardName('a'.repeat(MAX_BOARD_NAME_LENGTH))).toEqual(ok('a'.repeat(40)));
    const tooLong = normalizeBoardName('a'.repeat(41));
    expect(tooLong.ok).toBe(false);
    expect(tooLong.ok ? '' : tooLong.error).toMatch(/at most 40 characters \(this one has 41\)/);
    expect(normalizeBoardName(`  ${'a'.repeat(40)}  `)).toEqual(ok('a'.repeat(40)));
    expect(normalizeBoardName(`${'a'.repeat(20)}      ${'b'.repeat(19)}`).ok).toBe(true); // 40 once the run is one space
  });

  it('refuses control characters and line breaks, with a message', () => {
    for (const bad of ['a\nb', 'a\r\nb', 'tab\there', 'nul\u0000', 'esc\u001b[0m', 'del\u007f', 'c1\u0085', 'sep x', 'para x', 'trailing\n']) {
      const r = normalizeBoardName(bad);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      expect(r.ok ? '' : r.error).toMatch(/control characters or line breaks/);
    }
  });

  it('allows letters of any script, digits and punctuation, and counts an emoji once', () => {
    for (const fine of ['Büro-Alarm #2', 'Ünïcödé', '日本語のボード', 'Плата №3', 'LED: 13 (blink!) + "x" & <y>', '🚨 Alarm']) {
      expect(normalizeBoardName(fine), fine).toEqual(ok(fine));
    }
    expect(normalizeBoardName('🚨'.repeat(40)).ok).toBe(true);
    expect(normalizeBoardName('🚨'.repeat(41)).ok).toBe(false);
  });

  it('does not throw for any input', () => {
    expect(() => normalizeBoardName('\ud800')).not.toThrow(); // a lone surrogate
  });
});

describe('board labels', () => {
  const plain = { typeId: 'uno', boardId: 'uno-2' };
  const named = { ...plain, state: { name: 'Blinker' } };

  it('boardLabel is the custom name when set, else the default', () => {
    expect(boardLabel(plain)).toBe('Arduino Uno #2');
    expect(boardLabel(named)).toBe('Blinker');
    expect(boardLabel({ ...plain, state: {} })).toBe('Arduino Uno #2');
    expect(boardLabel({ ...plain, state: { name: '' } })).toBe('Arduino Uno #2');
    expect(defaultBoardLabel(named)).toBe('Arduino Uno #2');
    expect(customBoardName(named)).toBe('Blinker');
    expect(customBoardName(plain)).toBeUndefined();
  });

  it('boardLabelWithId (the Serial console list) adds the folder id after a custom name only', () => {
    expect(boardLabelWithId(named)).toBe('Blinker (uno-2)');
    expect(boardLabelWithId(plain)).toBe('Arduino Uno #2');
  });
});

const add = (p: Project, typeId = 'uno', col = 0) => p.scene.add({ typeId, col, row: 0, rotation: 0 });

describe('renameBoard', () => {
  it('sets, changes and removes the name by part id or by boardId; the folder id never changes', () => {
    const p = new Project();
    const a = add(p);
    const b = add(p, 'uno', 30);
    expect(renameBoard(p, a.id, '  Front   door ')).toEqual({ ok: true });
    expect(a.state).toEqual({ name: 'Front door' });
    expect(renameBoard(p, 'uno-2', 'Back door')).toEqual({ ok: true });
    expect(b.state).toEqual({ name: 'Back door' });
    expect(renameBoard(p, a.id, 'Gate')).toEqual({ ok: true });
    expect(a.state?.name).toBe('Gate');
    expect(a.boardId).toBe('uno-1');
    expect(Object.keys(p.scene.files)).toEqual(['uno-1', 'uno-2']);
    expect(renameBoard(p, a.id, '   ')).toEqual({ ok: true });
    expect(a.state).toBeUndefined(); // nothing else was in the state
    expect(boardLabel(a)).toBe('Arduino Uno #1');
  });

  it('keeps other state fields when the name goes away', () => {
    const p = new Project();
    const a = add(p);
    a.state = { name: 'X', closed: true };
    expect(renameBoard(p, a.id, '')).toEqual({ ok: true });
    expect(a.state).toEqual({ closed: true });
  });

  it('typing the default label back removes the custom name', () => {
    const p = new Project();
    const a = add(p);
    renameBoard(p, a.id, 'Blinker');
    expect(renameBoard(p, a.id, 'Arduino Uno #1')).toEqual({ ok: true });
    expect(a.state).toBeUndefined();
  });

  it('returns an error (no throw, no change) for a bad name or an unknown board', () => {
    const p = new Project();
    const a = add(p);
    renameBoard(p, a.id, 'Keep');
    const tooLong = renameBoard(p, a.id, 'x'.repeat(41));
    expect(tooLong.ok).toBe(false);
    expect(renameBoard(p, a.id, 'a\nb')).toMatchObject({ ok: false });
    expect(a.state).toEqual({ name: 'Keep' });
    expect(renameBoard(p, 'uno-9', 'x')).toMatchObject({ ok: false, error: expect.stringContaining('uno-9') });
    expect(renameBoard(p, 999, 'x')).toMatchObject({ ok: false });
    const r = add(p, 'resistor');
    expect(renameBoard(p, r.id, 'x')).toMatchObject({ ok: false }); // not a board
    expect(r.state).toEqual({ value: 220 });
  });

  it('allows two boards with the same name', () => {
    const p = new Project();
    const a = add(p);
    const b = add(p);
    expect(renameBoard(p, a.id, 'Same').ok && renameBoard(p, b.id, 'Same').ok).toBe(true);
    expect(listBoards(p).map((x) => x.label)).toEqual(['Same', 'Same']);
    expect(listBoards(p).map((x) => x.labelWithId)).toEqual(['Same (uno-1)', 'Same (uno-2)']);
  });

  it('tells the project at once (unsaved marker), and does nothing for an unchanged name', () => {
    const p = new Project();
    const a = add(p);
    p.markSaved();
    let changes = 0;
    p.onChange(() => changes++);
    renameBoard(p, a.id, 'Blinker');
    expect(changes).toBe(1);
    expect(p.dirty).toBe(true);
    renameBoard(p, a.id, 'Blinker');
    expect(changes).toBe(1);
  });

  it('listBoards keeps the folder-id order whatever the names are', () => {
    const p = new Project();
    const ids = [0, 1, 2].map((i) => add(p, 'uno', i * 30));
    renameBoard(p, ids[0].id, 'Zulu');
    renameBoard(p, ids[2].id, 'Alpha');
    const boards = listBoards(p);
    expect(boards.map((b) => b.boardId)).toEqual(['uno-1', 'uno-2', 'uno-3']);
    expect(boards.map((b) => b.label)).toEqual(['Zulu', 'Arduino Uno #2', 'Alpha']);
    expect(boards.map((b) => b.defaultLabel)).toEqual(['Arduino Uno #1', 'Arduino Uno #2', 'Arduino Uno #3']);
  });
});

describe('renaming and undo', () => {
  function setup() {
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

  it('a rename is one undo step, and redo brings it back', () => {
    const { p, undo, tick } = setup();
    const id = add(p).id;
    tick();
    renameBoard(p, id, 'Blinker');
    tick();
    expect(p.scene.find(id)?.state?.name).toBe('Blinker');
    expect(undo.undo()).toBe(true);
    expect(p.scene.find(id)?.state?.name).toBeUndefined();
    expect(boardLabel(p.scene.find(id)!)).toBe('Arduino Uno #1');
    expect(undo.undo()).toBe(true); // the step before: placing the board
    expect(p.scene.find(id)).toBeUndefined();
    expect(undo.redo()).toBe(true);
    expect(undo.redo()).toBe(true);
    expect(p.scene.find(id)?.state?.name).toBe('Blinker');
    expect(undo.canRedo).toBe(false);
  });

  it('removing the name is a step of its own', () => {
    const { p, undo, tick } = setup();
    const id = add(p).id;
    renameBoard(p, id, 'Blinker');
    tick();
    renameBoard(p, id, '');
    tick();
    expect(undo.undo()).toBe(true);
    expect(p.scene.find(id)?.state?.name).toBe('Blinker');
  });
});

describe('duplicating a board', () => {
  it('copies the name; the copy gets a new folder id', () => {
    const p = new Project();
    const a = add(p);
    renameBoard(p, a.id, 'Blinker');
    const copy = p.scene.insert(p.scene.snapshot(new Set([a.id])), 30, 0).parts[0];
    expect(copy.boardId).toBe('uno-2');
    expect(copy.state).toEqual({ name: 'Blinker' });
    expect(copy.state).not.toBe(a.state);
    renameBoard(p, copy.id, 'Other');
    expect(a.state?.name).toBe('Blinker'); // independent copies
  });
});

describe('saving and opening a named board', () => {
  function named(): Project {
    const p = new Project();
    add(p, 'resistor');
    renameBoard(p, add(p, 'uno', 10).id, 'Büro  Alarm 🚨');
    add(p, 'uno', 40);
    return p;
  }

  it('round-trips through JSON', () => {
    const file = named().serialize();
    const text = stringifyProject(file);
    expect(text).toContain('"name": "Büro Alarm 🚨"');
    expect(readProject(text)).toEqual(file);
    expect(readProject(text).parts.map((x) => x.state?.name)).toEqual([undefined, 'Büro Alarm 🚨', undefined]);
  });

  it('round-trips through .gth bytes', () => {
    const file = { ...named().serialize(), name: 'My robot' };
    const read = projectFromBytes('My robot.gth', projectToGth(file));
    expect(read.file).toEqual(file);
    const p = new Project();
    p.load(read.file);
    expect(listBoards(p).map((b) => b.label)).toEqual(['Büro Alarm 🚨', 'Arduino Uno #2']);
  });
});

describe('validating `name`', () => {
  /** The named project as a document, changed by `edit`, read back. */
  function readEdited(edit: (parts: any[]) => void): () => unknown {
    const p = new Project();
    add(p, 'resistor');
    renameBoard(p, add(p, 'uno', 10).id, 'Blinker');
    const doc = JSON.parse(stringifyProject(p.serialize()));
    edit(doc.parts);
    return () => readProject(JSON.stringify(doc));
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

  it('accepts a name on a board, and cleans up its white space', () => {
    expect(readEdited(() => undefined)()).toBeTruthy();
    const file = readEdited((parts) => {
      parts[1].state.name = '  Two   words ';
    })() as { parts: { state?: { name?: string } }[] };
    expect(file.parts[1].state?.name).toBe('Two words');
  });

  it('rejects a name on a part that is not a board', () => {
    const msg = errorOf(readEdited((parts) => {
      parts[0].state.name = 'Mine';
    }));
    expect(msg).toBe('parts[0].state.name is only allowed on boards, but a resistor part is not a board.');
  });

  it('rejects a name that is not text', () => {
    for (const bad of [5, true, null, ['x'], { a: 1 }]) {
      const msg = errorOf(readEdited((parts) => {
        parts[1].state.name = bad;
      }));
      expect(msg).toMatch(/^parts\[1\]\.state\.name must be text/);
    }
  });

  it('rejects a name that is too long or has control characters or is empty', () => {
    expect(errorOf(readEdited((parts) => {
      parts[1].state.name = 'x'.repeat(41);
    }))).toMatch(/parts\[1\]\.state\.name is not a valid board name\. .*at most 40 characters/);
    expect(errorOf(readEdited((parts) => {
      parts[1].state.name = 'line\nbreak';
    }))).toMatch(/not a valid board name\. .*control characters or line breaks/);
    expect(errorOf(readEdited((parts) => {
      parts[1].state.name = '   ';
    }))).toMatch(/parts\[1\]\.state\.name must not be empty/);
  });

  it('still rejects other unknown state fields', () => {
    expect(errorOf(readEdited((parts) => {
      parts[1].state.label = 'x';
    }))).toMatch(/unknown field "label"/);
  });
});
