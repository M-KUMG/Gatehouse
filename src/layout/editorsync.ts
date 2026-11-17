// Helpers to keep an open editor in step with the project's files. Pure, no DOM.

/** Line breaks the way the editor holds them: always "\n". */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * The smallest single replacement that turns `before` into `after` (common
 * start and end are left alone), or null when they are equal. Applying only
 * this keeps the cursor, selection and scroll of the editor where they were
 * outside the changed part.
 */
export function minimalChange(before: string, after: string): TextChange | null {
  if (before === after) return null;
  const max = Math.min(before.length, after.length);
  let start = 0;
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore--;
    endAfter--;
  }
  // Never split a surrogate pair at either end.
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start--;
  if (endBefore < before.length && isLowSurrogate(before.charCodeAt(endBefore))) {
    endBefore++;
    endAfter++;
  }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Where did the open file `oldPath` go? Used when it vanished from the tree
 * without anyone saying why (undo or redo of a rename): look for a path that
 * is new (not in `before`) and holds the same text. Several candidates are
 * narrowed down by file name (a renamed folder keeps its files' names);
 * still not exactly one, null (the tab then closes).
 */
export function findMoved(
  oldPath: string,
  content: string,
  before: ReadonlySet<string>,
  after: Readonly<Record<string, string>>,
  taken: ReadonlySet<string> = new Set(),
): string | null {
  const candidates = Object.keys(after).filter((p) => !before.has(p) && !taken.has(p) && normalizeEol(after[p]) === normalizeEol(content));
  if (candidates.length === 1) return candidates[0];
  const name = baseName(oldPath);
  const same = candidates.filter((p) => baseName(p) === name);
  return same.length === 1 ? same[0] : null;
}
