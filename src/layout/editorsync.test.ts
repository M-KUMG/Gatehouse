import { describe, expect, it } from 'vitest';
import { findMoved, minimalChange, normalizeEol } from './editorsync';

function apply(before: string, c: { from: number; to: number; insert: string } | null): string {
  return c ? before.slice(0, c.from) + c.insert + before.slice(c.to) : before;
}

const SMILE = '\u{1F600}';
const GRIN = '\u{1F601}';

describe('normalizeEol', () => {
  it('turns CRLF and CR into LF', () => {
    expect(normalizeEol('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });
});

describe('minimalChange', () => {
  it('is null for equal text', () => {
    expect(minimalChange('abc', 'abc')).toBeNull();
  });

  it('replaces only the differing middle', () => {
    expect(minimalChange('int led = 13;', 'int led = 7;')).toEqual({ from: 10, to: 12, insert: '7' });
    expect(minimalChange('abc', 'abXc')).toEqual({ from: 2, to: 2, insert: 'X' });
    expect(minimalChange('abXc', 'abc')).toEqual({ from: 2, to: 3, insert: '' });
  });

  it('handles empty sides and repeated characters', () => {
    expect(minimalChange('', 'hi')).toEqual({ from: 0, to: 0, insert: 'hi' });
    expect(minimalChange('hi', '')).toEqual({ from: 0, to: 2, insert: '' });
    expect(apply('aaaa', minimalChange('aaaa', 'aaaaaa'))).toBe('aaaaaa');
  });

  it('always reproduces the new text', () => {
    const cases: [string, string][] = [
      ['', ''], ['abcabc', 'abcxabc'], ['x\ny\nz', 'x\nz'], [`a${SMILE}b`, `a${GRIN}b`], [SMILE, SMILE + SMILE], ['abc', 'xyz'],
    ];
    for (const [a, b] of cases) expect(apply(a, minimalChange(a, b)), `${a} -> ${b}`).toBe(b);
  });

  it('does not split a surrogate pair', () => {
    expect(minimalChange(`a${SMILE}b`, `a${GRIN}b`)).toEqual({ from: 1, to: 3, insert: GRIN });
  });
});

describe('findMoved', () => {
  const before = new Set(['main.ino', 'old.h', 'lib/a.txt', 'lib/b.txt']);

  it('finds the new path holding the same text', () => {
    const after = { 'main.ino': 'm', 'new.h': 'H', 'lib/a.txt': 'x', 'lib/b.txt': 'y' };
    expect(findMoved('old.h', 'H', before, after)).toBe('new.h');
  });

  it('ignores paths that already existed, and text that differs', () => {
    const after = { 'main.ino': 'H', 'new.h': 'changed' };
    expect(findMoved('old.h', 'H', before, after)).toBeNull();
  });

  it('compares line endings loosely', () => {
    expect(findMoved('old.h', 'a\r\nb', before, { 'new.h': 'a\nb' })).toBe('new.h');
  });

  it('narrows several equal candidates by file name (a renamed folder)', () => {
    const b = new Set(['lib/a.txt', 'lib/b.txt']);
    const after = { 'src/a.txt': '', 'src/b.txt': '' };
    expect(findMoved('lib/a.txt', '', b, after)).toBe('src/a.txt');
    expect(findMoved('lib/b.txt', '', b, after)).toBe('src/b.txt');
  });

  it('gives up when it stays ambiguous, a candidate is taken, or nothing is new', () => {
    const old = new Set(['lib/x.txt']);
    expect(findMoved('lib/x.txt', '', old, { 'p/x.txt': '', 'q/x.txt': '' })).toBeNull();
    expect(findMoved('lib/x.txt', '', old, { 'p/x.txt': '' }, new Set(['p/x.txt']))).toBeNull();
    expect(findMoved('lib/x.txt', '', old, {})).toBeNull();
  });
});
