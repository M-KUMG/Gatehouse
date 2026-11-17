import { describe, expect, it } from 'vitest';
import {
  MANIFEST_TAB, NO_TABS, READ_ONLY_NOTE, activateTab, closeTab, isVirtualTab, moveTab, openMode, openTab, pruneTabs, renameTabs, tabLabels,
  type TabFile, type TabsState,
} from './editortabs';

const f = (boardId: string, path: string): TabFile => ({ boardId, path });
const paths = (s: TabsState): string[] => s.tabs.map((t) => `${t.boardId}:${t.path}`);
const open = (...files: TabFile[]): TabsState => files.reduce(openTab, NO_TABS);

describe('openTab / activateTab', () => {
  it('adds a tab at the end and brings it to the front', () => {
    const s = open(f('a', 'x.ino'), f('a', 'y.h'));
    expect(paths(s)).toEqual(['a:x.ino', 'a:y.h']);
    expect(s.active).toEqual(f('a', 'y.h'));
  });

  it('does not open the same file twice, it just activates it; order stays', () => {
    const s = openTab(open(f('a', 'x.ino'), f('a', 'y.h')), f('a', 'x.ino'));
    expect(paths(s)).toEqual(['a:x.ino', 'a:y.h']);
    expect(s.active).toEqual(f('a', 'x.ino'));
  });

  it('treats the same path on two boards as two files', () => {
    expect(open(f('a', 'main.ino'), f('b', 'main.ino')).tabs).toHaveLength(2);
  });

  it('activates an open tab and ignores unknown files', () => {
    const s = open(f('a', 'x.ino'), f('a', 'y.h'));
    expect(activateTab(s, f('a', 'x.ino')).active).toEqual(f('a', 'x.ino'));
    expect(activateTab(s, f('a', 'nope.h'))).toBe(s);
  });
});

describe('closeTab', () => {
  const s = open(f('a', '1'), f('a', '2'), f('a', '3'));

  it('closing a background tab keeps the front tab', () => {
    const r = closeTab(s, f('a', '1'));
    expect(paths(r)).toEqual(['a:2', 'a:3']);
    expect(r.active).toEqual(f('a', '3'));
  });

  it('closing the front tab activates its right neighbour, else the left one', () => {
    const mid = activateTab(s, f('a', '2'));
    expect(closeTab(mid, f('a', '2')).active).toEqual(f('a', '3'));
    expect(closeTab(s, f('a', '3')).active).toEqual(f('a', '2'));
  });

  it('closing the last tab leaves nothing open; unknown files change nothing', () => {
    expect(closeTab(open(f('a', '1')), f('a', '1'))).toEqual(NO_TABS);
    expect(closeTab(s, f('a', 'zz'))).toBe(s);
  });
});

describe('renameTabs / moveTab', () => {
  it('a renamed file keeps its place and stays in front', () => {
    const s = renameTabs(open(f('a', 'x.ino'), f('a', 'y.h')), 'a', 'y.h', 'z.h');
    expect(paths(s)).toEqual(['a:x.ino', 'a:z.h']);
    expect(s.active).toEqual(f('a', 'z.h'));
  });

  it('a renamed folder moves every tab inside it, only on its own board', () => {
    const s = renameTabs(open(f('a', 'lib/x.h'), f('a', 'libs/y.h'), f('b', 'lib/x.h'), f('a', 'lib')), 'a', 'lib', 'src');
    expect(paths(s)).toEqual(['a:src/x.h', 'a:libs/y.h', 'b:lib/x.h', 'a:src']);
  });

  it('moves one tab to another path', () => {
    const s = moveTab(open(f('a', 'x'), f('a', 'y')), f('a', 'y'), 'w');
    expect(paths(s)).toEqual(['a:x', 'a:w']);
    expect(s.active).toEqual(f('a', 'w'));
    expect(moveTab(s, f('a', 'gone'), 'q')).toBe(s);
  });
});

describe('pruneTabs (deleted files and boards)', () => {
  it('drops the tabs of a deleted board', () => {
    const s = pruneTabs(open(f('a', 'x'), f('b', 'x'), f('a', 'y')), (t) => t.boardId !== 'b');
    expect(paths(s)).toEqual(['a:x', 'a:y']);
  });

  it('a front tab that goes passes the front to the nearest survivor on its right, else left', () => {
    const s = open(f('a', '1'), f('a', '2'), f('a', '3'));
    expect(pruneTabs(activateTab(s, f('a', '2')), (t) => t.path !== '2').active).toEqual(f('a', '3'));
    expect(pruneTabs(s, (t) => t.path !== '3').active).toEqual(f('a', '2'));
    expect(pruneTabs(s, () => false)).toEqual(NO_TABS);
  });

  it('changes nothing when every file is still there', () => {
    const s = open(f('a', 'x'));
    expect(pruneTabs(s, () => true)).toBe(s);
  });
});

describe('tabLabels', () => {
  const names: Record<string, string> = { a: 'Arduino Uno #1', b: 'Arduino Uno #2' };
  const board = (id: string): string => names[id];

  it('shows only the file name when names are unique; the tooltip names board and path', () => {
    const [x, h] = tabLabels([f('a', 'main.ino'), f('a', 'lib/led.h')], board);
    expect(x).toMatchObject({ name: 'main.ino', board: null, title: 'Arduino Uno #1: main.ino' });
    expect(h).toMatchObject({ name: 'led.h', board: null, title: 'Arduino Uno #1: lib/led.h' });
  });

  it('adds the board when two open files share a name', () => {
    const labels = tabLabels([f('a', 'main.ino'), f('b', 'main.ino'), f('a', 'x.h')], board);
    expect(labels.map((l) => l.board)).toEqual(['Arduino Uno #1', 'Arduino Uno #2', null]);
  });

  it('also disambiguates the same name in different folders', () => {
    const labels = tabLabels([f('a', 'lib/a.h'), f('a', 'src/a.h')], board);
    expect(labels.map((l) => l.board)).toEqual(['Arduino Uno #1', 'Arduino Uno #1']);
    expect(labels[0].title).toBe('Arduino Uno #1: lib/a.h');
  });
});

describe('the generated gatehouse.json (a virtual, read-only file)', () => {
  it('belongs to the project, not to a board', () => {
    expect(isVirtualTab(MANIFEST_TAB)).toBe(true);
    expect(isVirtualTab(f('uno-1', 'gatehouse.json'))).toBe(false);
  });

  it('opens read-only; board files edit; binary kinds and unknown project files are refused', () => {
    expect(openMode(MANIFEST_TAB)).toBe('read-only');
    expect(openMode(f('uno-1', 'main.ino'))).toBe('edit');
    expect(openMode(f('uno-1', 'gatehouse.json'))).toBe('edit'); // a board's own file of that name is ordinary
    expect(openMode(f('uno-1', 'firmware.hex'))).toBe('refuse');
    expect(openMode({ boardId: '', path: 'other.json' })).toBe('refuse');
  });

  it('is a tab like the others (opens once, closes, survives board renames and prunes)', () => {
    const s = open(f('a', 'x.ino'), MANIFEST_TAB, MANIFEST_TAB);
    expect(s.tabs).toHaveLength(2);
    expect(s.active).toEqual(MANIFEST_TAB);
    expect(renameTabs(s, 'a', 'x.ino', 'y.ino').tabs[1]).toEqual(MANIFEST_TAB);
    expect(pruneTabs(s, (t) => t.boardId === '').tabs).toEqual([MANIFEST_TAB]);
    expect(closeTab(s, MANIFEST_TAB).active).toEqual(f('a', 'x.ino'));
  });

  it('gets a lock label with the read-only tooltip and never a board name', () => {
    const labels = tabLabels([MANIFEST_TAB, f('a', 'gatehouse.json')], (id) => (id === 'a' ? 'Arduino Uno #1' : 'x'));
    expect(labels[0]).toMatchObject({ name: 'gatehouse.json', board: null, readOnly: true, title: `gatehouse.json: ${READ_ONLY_NOTE}` });
    expect(READ_ONLY_NOTE).toBe('Generated from the circuit: read only');
    expect(labels[1]).toMatchObject({ readOnly: false, board: 'Arduino Uno #1' });
  });
});
