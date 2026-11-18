import { describe, expect, it } from 'vitest';
import { LABEL_GAP, LABEL_HEIGHT, LABEL_MAX_PX, LABEL_MIN_BOARD_PX, fitText, labelSlot } from './gridlabel';

const view = { width: 1000, height: 600 };
const box = (x: number, y: number, w: number, h = 300) => ({ x, y, w, h });

describe('where the label of a board goes', () => {
  it('sits just above the top-left corner of the board', () => {
    expect(labelSlot(box(100, 200, 500), view)).toEqual({ x: 100, y: 200 - LABEL_GAP - LABEL_HEIGHT, maxWidth: LABEL_MAX_PX });
  });

  it('is as wide as the board at most, and about 200 px for a big board', () => {
    expect(labelSlot(box(100, 200, 120), view)?.maxWidth).toBe(120);
    expect(labelSlot(box(100, 200, 5000), view)?.maxWidth).toBe(LABEL_MAX_PX);
  });

  it('is hidden while the board is tiny on screen', () => {
    expect(labelSlot(box(100, 200, LABEL_MIN_BOARD_PX - 1), view)).toBeNull();
    expect(labelSlot(box(100, 200, LABEL_MIN_BOARD_PX), view)).not.toBeNull();
  });

  it('is hidden when the board is fully off screen, shown while any part of it is in view', () => {
    expect(labelSlot(box(-600, 100, 500), view)).toBeNull(); // left
    expect(labelSlot(box(1000, 100, 500), view)).toBeNull(); // right
    expect(labelSlot(box(100, -400, 500), view)).toBeNull(); // above
    expect(labelSlot(box(100, 600, 500), view)).toBeNull(); // below
    expect(labelSlot(box(-300, 100, 500), view)).not.toBeNull();
    expect(labelSlot(box(900, 500, 500), view)).not.toBeNull();
  });

  it('follows the board when it moves (it is computed from the box every frame)', () => {
    const a = labelSlot(box(100, 200, 500), view);
    const b = labelSlot(box(130, 250, 500), view);
    expect(b && a && [b.x - a.x, b.y - a.y]).toEqual([30, 50]);
  });
});

describe('shortening a name to the pill', () => {
  const measure = (s: string): number => [...s].length * 7; // 7 px per character

  it('leaves a name that fits alone', () => {
    expect(fitText('Blinker', 100, measure)).toBe('Blinker');
    expect(fitText('1234567890', 70, measure)).toBe('1234567890'); // exactly fits
  });

  it('cuts the rest and ends with an ellipsis, within the width', () => {
    const text = fitText('A very long board name indeed', 70, measure);
    expect(text).toBe('A very lo…');
    expect(measure(text)).toBeLessThanOrEqual(70);
    expect(text.endsWith('…')).toBe(true);
    expect(text.length).toBeGreaterThan(3);
  });

  it('does not leave a space before the ellipsis', () => {
    expect(fitText('abc defghij', 7 * 5, measure)).toBe('abc…');
  });

  it('never splits an emoji, and copes with a width that fits nothing', () => {
    const text = fitText('🚨🚨🚨🚨🚨🚨', 7 * 4, measure);
    expect(text).toBe('🚨🚨🚨…');
    expect(fitText('abcdef', 3, measure)).toBe('…');
  });
});
