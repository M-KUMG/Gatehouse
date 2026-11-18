import { describe, expect, it } from 'vitest';
import { canonical, listTree } from '../project/filetree';
import {
  BOARDS_ID, MANIFEST_ID, PROJECT_ROOT, boardRenameHint, horizontalMove, lockReason, moveSelection, newItemTarget, projectNodes, reconcile,
  resolveActiveBoard, rowId, rowOps, selectionAfterDelete, visibleRows, type BoardNode, type RowKind,
} from './projectrows';

const uno1: BoardNode = {
  boardId: 'uno-1',
  label: 'Arduino Uno #1',
  entries: listTree(canonical({ 'main.ino': '', 'lib/led.h': '', 'lib/deep/x.c': '' }, ['empty'])),
};
const uno2: BoardNode = { boardId: 'uno-2', label: 'Arduino Uno #2', entries: listTree(canonical({ 'main.ino': '' }, [])) };
const ids = (rows: { id: string }[]): string[] => rows.map((r) => r.id);
const all = (boards: BoardNode[], collapsed: string[] = [], active: string | null = null) =>
  visibleRows(projectNodes('My robot', boards), new Set(collapsed), active);

describe('the project tree', () => {
  it('starts with the project, gatehouse.json and boards, then every board with its files', () => {
    const rows = all([uno1, uno2]);
    expect(ids(rows)).toEqual([
      '', 'gatehouse.json', 'boards',
      'boards/uno-1', 'boards/uno-1/empty', 'boards/uno-1/lib', 'boards/uno-1/lib/deep', 'boards/uno-1/lib/deep/x.c',
      'boards/uno-1/lib/led.h', 'boards/uno-1/main.ino',
      'boards/uno-2', 'boards/uno-2/main.ino',
    ]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 2, 3, 3, 4, 5, 4, 3, 2, 3]);
    expect(rows[0]).toMatchObject({ kind: 'project', name: 'My robot', expanded: true });
    expect(rows[1]).toMatchObject({ kind: 'manifest', name: 'gatehouse.json' });
    expect(rows[2]).toMatchObject({ kind: 'boards', name: 'boards', expanded: true });
  });

  it('shows the board label with the folder id as quieter text, and the paths for the other windows', () => {
    const board = all([uno1, uno2])[3];
    expect(board).toMatchObject({ kind: 'board', name: 'Arduino Uno #1', secondary: 'uno-1', boardId: 'uno-1', path: '' });
    const file = all([uno1]).find((r) => r.id === 'boards/uno-1/lib/led.h');
    expect(file).toMatchObject({ kind: 'file', name: 'led.h', boardId: 'uno-1', path: 'lib/led.h' });
  });

  it('lists boards in natural board id order whatever order they come in (uno-1, uno-2, uno-10)', () => {
    const uno10: BoardNode = { boardId: 'uno-10', label: 'Arduino Uno #10', entries: [] };
    const rows = all([uno10, uno2, uno1]).filter((r) => r.kind === 'board');
    expect(rows.map((r) => r.id)).toEqual(['boards/uno-1', 'boards/uno-2', 'boards/uno-10']);
    expect(rows.map((r) => r.name)).toEqual(['Arduino Uno #1', 'Arduino Uno #2', 'Arduino Uno #10']);
  });

  it('shows a custom name as the row name, still with the folder id as quieter text and the same order', () => {
    const named: BoardNode = { boardId: 'uno-10', label: 'Alarm', entries: [] };
    const first: BoardNode = { ...uno2, label: 'Zebra' };
    const rows = all([named, first, uno1]).filter((r) => r.kind === 'board');
    expect(rows.map((r) => r.id)).toEqual(['boards/uno-1', 'boards/uno-2', 'boards/uno-10']); // not by name
    expect(rows.map((r) => r.name)).toEqual(['Arduino Uno #1', 'Zebra', 'Alarm']);
    expect(rows.map((r) => r.secondary)).toEqual(['uno-1', 'uno-2', 'uno-10']);
  });

  it('flags only the active board', () => {
    const rows = all([uno1, uno2], [], 'uno-2');
    expect(rows.filter((r) => r.active).map((r) => r.id)).toEqual(['boards/uno-2']);
    expect(all([uno1, uno2]).some((r) => r.active)).toBe(false);
  });

  it('an empty project still has the project, gatehouse.json and an empty boards folder', () => {
    expect(ids(all([]))).toEqual(['', 'gatehouse.json', 'boards']);
  });

  it('hides what is inside collapsed rows, at any depth, other boards stay', () => {
    expect(ids(all([uno1, uno2], ['boards/uno-1/lib']))).not.toContain('boards/uno-1/lib/led.h');
    expect(ids(all([uno1, uno2], ['boards/uno-1/lib']))).toContain('boards/uno-1/main.ino');
    expect(ids(all([uno1, uno2], ['boards/uno-1']))).toEqual(['', 'gatehouse.json', 'boards', 'boards/uno-1', 'boards/uno-2', 'boards/uno-2/main.ino']);
    expect(ids(all([uno1, uno2], ['boards']))).toEqual(['', 'gatehouse.json', 'boards']);
    expect(ids(all([uno1], ['']))).toEqual(['']);
    expect(all([uno1], ['boards/uno-1']).find((r) => r.id === 'boards/uno-1')?.expanded).toBe(false);
  });

  it('does not mistake a sibling with the same prefix for contents', () => {
    const a: BoardNode = { boardId: 'uno-1', label: 'A', entries: listTree(canonical({}, ['lib', 'lib2'])) };
    expect(ids(all([a], ['boards/uno-1/lib']))).toEqual(['', 'gatehouse.json', 'boards', 'boards/uno-1', 'boards/uno-1/lib', 'boards/uno-1/lib2']);
  });

  it('builds row ids', () => {
    expect(rowId('uno-1', '')).toBe('boards/uno-1');
    expect(rowId('uno-1', 'lib/a.h')).toBe('boards/uno-1/lib/a.h');
  });
});

describe('the active board', () => {
  const boards = [{ boardId: 'uno-1', partId: 4 }, { boardId: 'uno-2', partId: 9 }];
  it('is the board the grid selection (or the last one) points to', () => {
    expect(resolveActiveBoard(boards, 9)).toBe('uno-2');
    expect(resolveActiveBoard(boards, 4)).toBe('uno-1');
  });
  it('falls back to the first board, and to none', () => {
    expect(resolveActiveBoard(boards, null)).toBe('uno-1');
    expect(resolveActiveBoard(boards, 77)).toBe('uno-1');
    expect(resolveActiveBoard([], 1)).toBeNull();
  });
});

describe('which operations are allowed on which row', () => {
  const kinds: RowKind[] = ['project', 'manifest', 'boards', 'board', 'folder', 'file'];

  it('only files and folders inside a board can be deleted; board rows can be renamed too (display name)', () => {
    for (const k of kinds) {
      const inside = k === 'folder' || k === 'file';
      expect(rowOps(k).rename, k).toBe(inside || k === 'board');
      expect(rowOps(k).remove, k).toBe(inside);
      expect(lockReason(k, 'rename') === null, k).toBe(inside || k === 'board');
      expect(lockReason(k, 'delete') === null, k).toBe(inside);
    }
  });

  it('files open, foldable rows fold, board contents take dropped files', () => {
    expect(kinds.filter((k) => rowOps(k).open)).toEqual(['manifest', 'file']);
    expect(kinds.filter((k) => rowOps(k).fold)).toEqual(['project', 'boards', 'board', 'folder']);
    expect(kinds.filter((k) => rowOps(k).acceptsDrop)).toEqual(['board', 'folder', 'file']);
    expect(rowOps(null)).toEqual({ open: false, rename: false, remove: false, fold: false, acceptsDrop: false });
  });

  it('explains why a row is locked', () => {
    expect(lockReason('manifest', 'delete')).toMatch(/generated from the circuit.*deleted/);
    expect(lockReason('manifest', 'rename')).toMatch(/generated from the circuit.*renamed/);
    expect(lockReason('board', 'delete')).toMatch(/cannot be deleted.*on the grid/);
    expect(lockReason('boards', 'rename')).toMatch(/boards folder cannot be renamed/);
    expect(lockReason('project', 'delete')).toMatch(/project root cannot be deleted/);
  });

  it('the Rename button of a board row says that only the display name changes', () => {
    expect(boardRenameHint('uno-3')).toMatch(/display name only.*"uno-3" keeps its name/);
  });
});

describe('newItemTarget', () => {
  const rows = all([uno1, uno2]);
  const at = (id: string) => rows.find((r) => r.id === id) ?? null;

  it('is the selected folder or board folder; a selected file uses its board folder', () => {
    expect(newItemTarget(at('boards/uno-1/lib'), 'uno-2')).toEqual({ boardId: 'uno-1', parent: 'lib', parentId: 'boards/uno-1/lib', redirected: false });
    expect(newItemTarget(at('boards/uno-2'), 'uno-1')).toEqual({ boardId: 'uno-2', parent: '', parentId: 'boards/uno-2', redirected: false });
    expect(newItemTarget(at('boards/uno-1/lib/led.h'), 'uno-2')).toMatchObject({ boardId: 'uno-1', parent: '' });
  });

  it('goes to the active board for the project, gatehouse.json and boards, and says so', () => {
    for (const id of [PROJECT_ROOT, MANIFEST_ID, BOARDS_ID]) {
      expect(newItemTarget(at(id), 'uno-2'), id).toEqual({ boardId: 'uno-2', parent: '', parentId: 'boards/uno-2', redirected: true });
    }
    expect(newItemTarget(null, 'uno-2')).toMatchObject({ boardId: 'uno-2', redirected: false });
  });

  it('is nothing when there is no board to put it in', () => {
    expect(newItemTarget(at(PROJECT_ROOT), null)).toBeNull();
    expect(newItemTarget(null, null)).toBeNull();
  });
});

describe('keyboard moves', () => {
  const rows = all([uno1, uno2], ['boards/uno-1/lib/deep', 'boards/uno-2']);

  it('moves the selection across boards and clamps at the ends', () => {
    expect(moveSelection(rows, 'boards/uno-1/main.ino', 1)).toBe('boards/uno-2');
    expect(moveSelection(rows, PROJECT_ROOT, -1)).toBe(PROJECT_ROOT);
    expect(moveSelection(rows, 'boards/uno-2', 1)).toBe('boards/uno-2');
    expect(moveSelection(rows, null, 1)).toBe(PROJECT_ROOT);
    expect(moveSelection(rows, null, -1)).toBe('boards/uno-2');
    expect(moveSelection([], null, 1)).toBeNull();
  });

  it('Left collapses an open row, else goes to the parent', () => {
    expect(horizontalMove(rows, 'boards', 'left')).toEqual({ kind: 'collapse', id: 'boards' });
    expect(horizontalMove(rows, 'boards/uno-1/lib/led.h', 'left')).toEqual({ kind: 'select', id: 'boards/uno-1/lib' });
    expect(horizontalMove(rows, 'gatehouse.json', 'left')).toEqual({ kind: 'select', id: PROJECT_ROOT });
    expect(horizontalMove(rows, 'boards/uno-2', 'left')).toEqual({ kind: 'select', id: 'boards' });
    expect(horizontalMove(rows, PROJECT_ROOT, 'left')).toEqual({ kind: 'collapse', id: PROJECT_ROOT });
  });

  it('Right expands a closed row, else goes to the first child', () => {
    expect(horizontalMove(rows, 'boards/uno-2', 'right')).toEqual({ kind: 'expand', id: 'boards/uno-2' });
    expect(horizontalMove(rows, 'boards/uno-1', 'right')).toEqual({ kind: 'select', id: 'boards/uno-1/empty' });
    expect(horizontalMove(rows, 'boards', 'right')).toEqual({ kind: 'select', id: 'boards/uno-1' });
    expect(horizontalMove(rows, 'boards/uno-1/empty', 'right')).toBeNull();
    expect(horizontalMove(rows, 'gatehouse.json', 'right')).toBeNull();
  });

  it('Left on the project row, already collapsed, goes nowhere', () => {
    expect(horizontalMove(all([uno1], ['']), PROJECT_ROOT, 'left')).toBeNull();
  });
});

describe('after changes', () => {
  const rows = all([uno1, uno2]);

  it('selects what takes the place of a deleted item, else the one before', () => {
    expect(selectionAfterDelete(rows, 'boards/uno-1/lib/deep')).toBe('boards/uno-1/lib/led.h');
    expect(selectionAfterDelete(rows, 'boards/uno-2/main.ino')).toBe('boards/uno-2');
  });

  it('keeps collapsed rows and the selection that still exist', () => {
    const nodes = projectNodes('p', [uno2]);
    const kept = reconcile(nodes, new Set(['boards', 'boards/uno-1', 'boards/uno-2/gone']), 'boards/uno-1/lib/x.h');
    expect([...kept.collapsed]).toEqual(['boards']);
    expect(kept.selected).toBe('boards'); // the board is gone: nearest surviving parent
    expect(reconcile(nodes, new Set(), 'boards/uno-2/main.ino').selected).toBe('boards/uno-2/main.ino');
    expect(reconcile(nodes, new Set(), 'zzz').selected).toBe(PROJECT_ROOT);
    expect(reconcile(nodes, new Set(), null).selected).toBeNull();
    expect(reconcile(nodes, new Set(['gatehouse.json']), null).collapsed.size).toBe(0); // files do not fold
  });
});
