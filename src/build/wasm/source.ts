// Length-preserving blanking of C/C++ source text, so later scans can work on
// "code only" while every offset, line and column still matches the original.
// Pure, no DOM, no Node.

export interface BlankOptions {
  /** Blank the contents of string and character literals (the quotes stay). */
  strings?: boolean;
  /** Blank preprocessor directives (with their backslash continuations). */
  directives?: boolean;
}

const isIdent = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c);

/**
 * Comments always become spaces (newlines kept); string/char literal contents
 * and preprocessor lines become spaces when asked. The result has the same
 * length and the same newlines as `text`.
 */
export function blankSource(text: string, opts: BlankOptions = {}): string {
  const out = text.split('');
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  let i = 0;
  let lineStart = true; // only whitespace since the last newline
  let directiveFrom = -1;
  const n = text.length;
  const endDirective = (at: number): void => {
    if (directiveFrom >= 0 && opts.directives) blank(directiveFrom, at);
    directiveFrom = -1;
  };
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '\n') {
      // a directive ends at a newline that is not escaped by a backslash
      if (directiveFrom >= 0 && !/\\\r?$/.test(text.slice(Math.max(0, i - 2), i))) endDirective(i);
      lineStart = true;
      i++;
      continue;
    }
    if (c === '/' && next === '/') {
      let j = i + 2;
      while (j < n && !(text[j] === '\n' && text[j - 1] !== '\\')) j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2);
      const j = close < 0 ? n : close + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '#' && lineStart && directiveFrom < 0) {
      directiveFrom = i;
      lineStart = false;
      i++;
      continue;
    }
    if (c === '"' && text[i - 1] === 'R' && !isIdent(rawPrefixBefore(text, i - 1))) {
      // raw string R"delim( ... )delim"
      const open = text.indexOf('(', i);
      const delim = open < 0 ? '' : text.slice(i + 1, open);
      const close = open < 0 ? -1 : text.indexOf(`)${delim}"`, open);
      const j = close < 0 ? n : close + delim.length + 2;
      if (opts.strings) blank(i + 1, j - 1);
      lineStart = false;
      i = j;
      continue;
    }
    if (c === '"' || (c === "'" && !isIdent(text[i - 1]))) {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      if (opts.strings) blank(i + 1, Math.min(j, n));
      lineStart = false;
      i = Math.min(j + 1, n);
      continue;
    }
    if (c !== ' ' && c !== '\t' && c !== '\r' && c !== '\f' && c !== '\v') lineStart = false;
    i++;
  }
  endDirective(n);
  return out.join('');
}

/** The character before a raw-string `R` prefix, skipping an encoding prefix (u8, u, U, L). */
function rawPrefixBefore(text: string, rAt: number): string | undefined {
  let k = rAt - 1;
  if (text.slice(k - 1, k + 1) === 'u8') k -= 2;
  else if (/[uUL]/.test(text[k] ?? '')) k -= 1;
  return text[k];
}

/** 1-based line number of `offset` in `text`. */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let k = 0; k < offset && k < text.length; k++) if (text[k] === '\n') line++;
  return line;
}
