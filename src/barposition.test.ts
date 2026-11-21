import { describe, expect, it } from 'vitest';
import { clampPosition, keyStep, parsePosition, parseSavedPositions } from './barposition';

const area = { width: 800, height: 500 };
const bar = { width: 200, height: 36 };

describe('clampPosition', () => {
  it('leaves a position that fits alone', () => {
    expect(clampPosition({ left: 100, top: 80 }, bar, area)).toEqual({ left: 100, top: 80 });
  });

  it('keeps the bar inside on every side, with a margin', () => {
    expect(clampPosition({ left: -50, top: -20 }, bar, area)).toEqual({ left: 4, top: 4 });
    expect(clampPosition({ left: 900, top: 700 }, bar, area)).toEqual({ left: 800 - 200 - 4, top: 500 - 36 - 4 });
  });

  it('pins to the top-left when the bar is bigger than the area', () => {
    expect(clampPosition({ left: 300, top: 300 }, { width: 900, height: 600 }, area)).toEqual({ left: 4, top: 4 });
  });

  it('rounds to whole pixels', () => {
    expect(clampPosition({ left: 10.6, top: 20.2 }, bar, area)).toEqual({ left: 11, top: 20 });
  });
});

describe('saved positions', () => {
  it('accepts two finite numbers only', () => {
    expect(parsePosition({ left: 5, top: 9 })).toEqual({ left: 5, top: 9 });
    expect(parsePosition({ left: '5', top: 9 })).toBeNull();
    expect(parsePosition({ left: 5 })).toBeNull();
    expect(parsePosition({ left: NaN, top: 1 })).toBeNull();
    expect(parsePosition(null)).toBeNull();
    expect(parsePosition(7)).toBeNull();
  });

  it('reads good entries and drops bad ones', () => {
    const text = JSON.stringify({ file: { left: 1, top: 2 }, transport: { left: 'x', top: 3 }, junk: 5 });
    expect(parseSavedPositions(text)).toEqual({ file: { left: 1, top: 2 } });
  });

  it('gives an empty record for missing or broken text', () => {
    expect(parseSavedPositions(null)).toEqual({});
    expect(parseSavedPositions('')).toEqual({});
    expect(parseSavedPositions('{not json')).toEqual({});
    expect(parseSavedPositions('[1,2]')).toEqual({});
  });
});

describe('keyStep', () => {
  it('is 10 px, or 40 with Shift', () => {
    expect(keyStep(false)).toBe(10);
    expect(keyStep(true)).toBe(40);
  });
});
