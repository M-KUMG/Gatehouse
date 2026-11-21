import { describe, expect, it } from 'vitest';
import { centreOnCell, freeSpot } from './placing';

describe('centreOnCell', () => {
  it('puts the middle of the part on the cell, snapped to the grid', () => {
    expect(centreOnCell({ col: 10, row: 8 }, { cols: 4, rows: 2 })).toEqual({ col: 8, row: 7 });
  });

  it('rounds fractional cells', () => {
    expect(centreOnCell({ col: 10.4, row: 8.6 }, { cols: 3, rows: 3 })).toEqual({ col: 9, row: 7 });
  });
});

describe('freeSpot', () => {
  it('keeps the start when it is free', () => {
    expect(freeSpot({ col: 3, row: 4 }, () => false)).toEqual({ col: 3, row: 4 });
  });

  it('steps down and right past taken spots', () => {
    const taken = new Set(['3,4', '4,5']);
    expect(freeSpot({ col: 3, row: 4 }, (c, r) => taken.has(`${c},${r}`))).toEqual({ col: 5, row: 6 });
  });

  it('gives up after maxSteps instead of looping forever', () => {
    expect(freeSpot({ col: 0, row: 0 }, () => true, 5)).toEqual({ col: 5, row: 5 });
  });
});
