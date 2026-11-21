// Tests for electron/windowstate.cjs (window size, position and the unsaved-changes title).
// No Electron: a fake file system and plain numbers. vitest picks it up by its
// default *.test.* pattern, so `npm test` runs it.

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const W = require('./windowstate.cjs');

const screen = { x: 0, y: 0, width: 1920, height: 1040 };

describe('sanitizeBounds size', () => {
  it('uses the default size when nothing is saved', () => {
    expect(W.sanitizeBounds(null, [screen])).toEqual({ width: W.DEFAULT_SIZE.width, height: W.DEFAULT_SIZE.height });
  });

  it('keeps a saved size that fits', () => {
    expect(W.sanitizeBounds({ width: 1500, height: 900 }, [screen])).toEqual({ width: 1500, height: 900 });
  });

  it('never goes below the minimum or above the biggest screen', () => {
    const small = W.sanitizeBounds({ width: 200, height: 100 }, [screen]);
    expect(small).toEqual({ width: W.MIN_SIZE.width, height: W.MIN_SIZE.height });
    const huge = W.sanitizeBounds({ width: 9000, height: 9000 }, [screen]);
    expect(huge).toEqual({ width: 1920, height: 1040 });
  });

  it('shrinks the default to a small laptop screen', () => {
    const laptop = { x: 0, y: 0, width: 1366, height: 728 };
    expect(W.sanitizeBounds(null, [laptop])).toEqual({ width: 1360, height: 728 });
  });

  it('ignores junk values', () => {
    expect(W.sanitizeBounds({ width: 'wide', height: NaN }, [screen])).toEqual({ width: W.DEFAULT_SIZE.width, height: W.DEFAULT_SIZE.height });
    expect(W.sanitizeBounds('nope', [screen]).width).toBe(W.DEFAULT_SIZE.width);
  });
});

describe('sanitizeBounds position', () => {
  it('keeps a position that is on a screen', () => {
    expect(W.sanitizeBounds({ width: 1200, height: 800, x: 100, y: 50 }, [screen])).toEqual({ width: 1200, height: 800, x: 100, y: 50 });
  });

  it('drops a position that is off every screen (e.g. a monitor was unplugged)', () => {
    const out = W.sanitizeBounds({ width: 1200, height: 800, x: 4000, y: 100 }, [screen]);
    expect(out).toEqual({ width: 1200, height: 800 });
    expect('x' in out).toBe(false);
  });

  it('drops a position that only just touches the screen edge', () => {
    expect('x' in W.sanitizeBounds({ width: 1200, height: 800, x: 1900, y: 100 }, [screen])).toBe(false);
  });

  it('accepts a position on a second screen', () => {
    const second = { x: 1920, y: 0, width: 1920, height: 1040 };
    expect(W.sanitizeBounds({ width: 1200, height: 800, x: 2200, y: 60 }, [screen, second]).x).toBe(2200);
  });

  it('works with no screen information', () => {
    expect(W.sanitizeBounds({ width: 1000, height: 700, x: 10, y: 10 }, []).x).toBe(10);
  });
});

describe('loadState and saveState', () => {
  const fakeFs = (files = {}) => ({
    files,
    readFileSync(file) {
      if (!(file in files)) throw new Error('ENOENT');
      return files[file];
    },
    writeFileSync(file, text) {
      files[file] = text;
    },
  });

  it('round-trips the state', () => {
    const fs = fakeFs();
    expect(W.saveState('state.json', { bounds: { width: 1000, height: 700, x: 5, y: 6 }, maximized: true }, fs)).toBe(true);
    expect(W.loadState('state.json', fs)).toEqual({ bounds: { width: 1000, height: 700, x: 5, y: 6 }, maximized: true });
  });

  it('starts fresh when the file is missing or broken', () => {
    expect(W.loadState('state.json', fakeFs())).toEqual({ bounds: null, maximized: false });
    expect(W.loadState('state.json', fakeFs({ 'state.json': '{oops' }))).toEqual({ bounds: null, maximized: false });
    expect(W.loadState('state.json', fakeFs({ 'state.json': '7' }))).toEqual({ bounds: null, maximized: false });
  });

  it('survives a disk that cannot be written', () => {
    const fs = { writeFileSync() { throw new Error('EROFS'); } };
    expect(W.saveState('state.json', { bounds: null, maximized: false }, fs)).toBe(false);
  });
});

describe('the unsaved-changes title', () => {
  it('knows the dot in front of the title', () => {
    expect(W.isDirtyTitle('● My circuit · Gatehouse')).toBe(true);
    expect(W.isDirtyTitle('My circuit · Gatehouse')).toBe(false);
    expect(W.isDirtyTitle(undefined)).toBe(false);
  });

  it('reads the project name out of the title', () => {
    expect(W.projectNameFromTitle('● My circuit · Gatehouse')).toBe('My circuit');
    expect(W.projectNameFromTitle('Untitled · Gatehouse')).toBe('Untitled');
    expect(W.projectNameFromTitle('Odd · name · Gatehouse')).toBe('Odd · name');
    expect(W.projectNameFromTitle(null)).toBe('');
  });
});
