import { describe, expect, it } from 'vitest';
import { boardLabel } from '../parts';
import { listBoards } from './boardfiles';
import { compareBoardIds } from './boardidparse';
import { Project } from './project';

describe('board ids in natural order', () => {
  it('sort by type slug, then by the number', () => {
    const ids = ['uno-10', 'uno-2', 'pico-3', 'uno-1', 'nano-1'];
    expect([...ids].sort(compareBoardIds)).toEqual(['nano-1', 'pico-3', 'uno-1', 'uno-2', 'uno-10']);
  });

  it('put anything that is not a board id last', () => {
    expect(['zzz', 'uno-2', 'abc', 'uno-1'].sort(compareBoardIds)).toEqual(['uno-1', 'uno-2', 'abc', 'zzz']);
    expect(compareBoardIds('uno-1', 'uno-1')).toBe(0);
  });
});

describe('board labels', () => {
  it('take the number from the board id, not the part id', () => {
    expect(boardLabel({ typeId: 'uno', boardId: 'uno-2' })).toBe('Arduino Uno #2');
    expect(boardLabel({ typeId: 'uno', boardId: 'uno-10' })).toBe('Arduino Uno #10');
  });

  it('are just the type name when there is no board id yet', () => {
    expect(boardLabel({ typeId: 'uno' })).toBe('Arduino Uno');
    expect(boardLabel({ typeId: 'nope', boardId: 'uno-1' })).toBe('Board #1');
  });

  it('listBoards: fixed order and counter labels, however the parts were reordered', () => {
    const p = new Project();
    for (let i = 0; i < 3; i++) p.scene.add({ typeId: 'uno', col: i * 25, row: 0, rotation: 0 });
    const [a, , c] = p.scene.parts;
    p.scene.bringToFront(a.id); // draw order is now uno-2, uno-3, uno-1
    p.scene.bringToFront(c.id);
    expect(p.scene.parts.map((x) => x.boardId)).not.toEqual(['uno-1', 'uno-2', 'uno-3']);
    const boards = listBoards(p);
    expect(boards.map((b) => b.boardId)).toEqual(['uno-1', 'uno-2', 'uno-3']);
    expect(boards.map((b) => b.label)).toEqual(['Arduino Uno #1', 'Arduino Uno #2', 'Arduino Uno #3']);
  });
});
