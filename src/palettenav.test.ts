import { describe, expect, it } from 'vitest';
import { isNavKey, moveIndex } from './palettenav';

describe('moveIndex in a two-column grid of 5 tiles', () => {
  // 0 1
  // 2 3
  // 4
  it('moves right and left within a row, staying put at the row ends', () => {
    expect(moveIndex(0, 'ArrowRight', 5, 2)).toBe(1);
    expect(moveIndex(1, 'ArrowRight', 5, 2)).toBe(1);
    expect(moveIndex(1, 'ArrowLeft', 5, 2)).toBe(0);
    expect(moveIndex(0, 'ArrowLeft', 5, 2)).toBe(0);
    expect(moveIndex(4, 'ArrowRight', 5, 2)).toBe(4); // nothing to the right of the last tile
  });

  it('moves down and up by a row', () => {
    expect(moveIndex(0, 'ArrowDown', 5, 2)).toBe(2);
    expect(moveIndex(2, 'ArrowDown', 5, 2)).toBe(4);
    expect(moveIndex(3, 'ArrowUp', 5, 2)).toBe(1);
  });

  it('goes to the last tile when down lands in the gap of a short last row', () => {
    expect(moveIndex(3, 'ArrowDown', 5, 2)).toBe(4);
  });

  it('leaves the grid up from the first row and down from the last row', () => {
    expect(moveIndex(1, 'ArrowUp', 5, 2)).toBeNull();
    expect(moveIndex(4, 'ArrowDown', 5, 2)).toBeNull();
  });

  it('jumps to the ends with Home and End', () => {
    expect(moveIndex(3, 'Home', 5, 2)).toBe(0);
    expect(moveIndex(0, 'End', 5, 2)).toBe(4);
  });
});

describe('moveIndex in one column (section headers)', () => {
  it('steps up and down and ignores left and right', () => {
    expect(moveIndex(1, 'ArrowDown', 4, 1)).toBe(2);
    expect(moveIndex(1, 'ArrowUp', 4, 1)).toBe(0);
    expect(moveIndex(1, 'ArrowLeft', 4, 1)).toBe(1);
    expect(moveIndex(1, 'ArrowRight', 4, 1)).toBe(1);
  });

  it('leaves the list at its ends', () => {
    expect(moveIndex(0, 'ArrowUp', 4, 1)).toBeNull();
    expect(moveIndex(3, 'ArrowDown', 4, 1)).toBeNull();
  });
});

describe('edge cases', () => {
  it('returns null for an empty list', () => {
    expect(moveIndex(0, 'ArrowDown', 0, 2)).toBeNull();
  });

  it('recognises navigation keys only', () => {
    expect(isNavKey('ArrowUp')).toBe(true);
    expect(isNavKey('Home')).toBe(true);
    expect(isNavKey('Enter')).toBe(false);
    expect(isNavKey('a')).toBe(false);
  });
});
