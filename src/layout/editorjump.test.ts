import { describe, expect, it } from 'vitest';
import { resolveJump, type LineTable } from './editorjump';

/** A document of lines with the given lengths (each followed by a newline). */
function table(lengths: number[]): LineTable {
  const starts: number[] = [];
  let at = 0;
  for (const n of lengths) {
    starts.push(at);
    at += n + 1;
  }
  return { lines: lengths.length, line: (n) => ({ from: starts[n - 1], length: lengths[n - 1] }) };
}

describe('jumping to a line and column', () => {
  const doc = table([10, 0, 5]); // line 1 at 0, line 2 at 11, line 3 at 12

  it('puts the cursor at the 1-based column of the line', () => {
    expect(resolveJump(doc, { line: 1, column: 1 })).toEqual({ pos: 0, line: 1 });
    expect(resolveJump(doc, { line: 1, column: 4 })).toEqual({ pos: 3, line: 1 });
    expect(resolveJump(doc, { line: 3, column: 2 })).toEqual({ pos: 13, line: 3 });
  });

  it('goes to the start of the line without a column', () => {
    expect(resolveJump(doc, { line: 3 })).toEqual({ pos: 12, line: 3 });
  });

  it('clamps a column past the end of the line and a line past the end of the document', () => {
    expect(resolveJump(doc, { line: 1, column: 99 })).toEqual({ pos: 10, line: 1 });
    expect(resolveJump(doc, { line: 2, column: 5 })).toEqual({ pos: 11, line: 2 });
    expect(resolveJump(doc, { line: 40, column: 1 })).toEqual({ pos: 12, line: 3 });
  });

  it('clamps line 0, negatives and odd numbers to the document', () => {
    expect(resolveJump(doc, { line: 0, column: 0 })).toEqual({ pos: 0, line: 1 });
    expect(resolveJump(doc, { line: -3, column: -1 })).toEqual({ pos: 0, line: 1 });
    expect(resolveJump(doc, { line: Number.NaN })).toEqual({ pos: 0, line: 1 });
    expect(resolveJump(doc, { line: 2.9, column: 1.9 })).toEqual({ pos: 11, line: 2 });
  });
});
