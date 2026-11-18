// Where the editor puts the cursor when a build message is clicked. Pure: it
// only needs the document's line table, which CodeMirror's Text provides.

/** The part of CodeMirror's Text this needs (lines are 1-based). */
export interface LineTable {
  readonly lines: number;
  line(n: number): { readonly from: number; readonly length: number };
}

export interface JumpTarget {
  /** 1-based; clamped to the document. */
  line: number;
  /** 1-based; clamped to the line. Missing: the start of the line. */
  column?: number;
}

export interface JumpPlace {
  /** Document offset for the cursor. */
  pos: number;
  /** 1-based line actually used (after clamping). */
  line: number;
}

/** Document offset of a 1-based line and column, clamped to the text (a message may name a line that was deleted since). */
export function resolveJump(doc: LineTable, target: JumpTarget): JumpPlace {
  const want = Number.isFinite(target.line) ? Math.trunc(target.line) : 1;
  const line = Math.min(Math.max(want, 1), Math.max(doc.lines, 1));
  const info = doc.line(line);
  const col = target.column !== undefined && Number.isFinite(target.column) ? Math.trunc(target.column) : 1;
  return { pos: info.from + Math.min(Math.max(col - 1, 0), info.length), line };
}
