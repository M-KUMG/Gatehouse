// Arduino sketch preparation: join the .ino files into one C++ translation
// unit the way the Arduino builder does (primary file first, the rest
// alphabetically), put `#include <Arduino.h>` first, generate prototypes for
// the functions they define, and emit `#line` directives so every compiler
// message points at the original file and line. Pure, no DOM, no Node.

import { blankSource, lineAt } from './source';

export interface SourceFile {
  /** Path relative to the sketch folder, '/'-separated (e.g. "main.ino"). */
  path: string;
  text: string;
}

const byName = (a: string, b: string): number => {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la < lb ? -1 : la > lb ? 1 : a < b ? -1 : a > b ? 1 : 0;
};

/**
 * Order the sketch's root .ino files: the primary one first (named like the
 * sketch folder, else main.ino, else sketch.ino, else the first
 * alphabetically), then the others alphabetically.
 */
export function orderInoFiles(paths: readonly string[], sketchName?: string): string[] {
  const sorted = [...paths].sort(byName);
  const wanted = [sketchName ? `${sketchName}.ino` : undefined, 'main.ino', 'sketch.ino'];
  let primary: string | undefined;
  for (const w of wanted) {
    if (primary === undefined && w !== undefined) primary = sorted.find((p) => p.toLowerCase() === w.toLowerCase());
  }
  primary ??= sorted[0];
  return primary === undefined ? [] : [primary, ...sorted.filter((p) => p !== primary)];
}

/** A function defined at the top level of an .ino file. */
export interface FunctionDefinition {
  name: string;
  /** Number of parameters (overloads are told apart by it). */
  arity: number;
  /** The prototype to declare, with any default arguments, ending in ';'. */
  prototype: string;
  /** 1-based line of the definition's first token. */
  line: number;
  /** Offset of the definition's first token. */
  start: number;
  /** Offset ranges of the default arguments (`= value`), removed from the definition when the prototype carries them. */
  defaults: [number, number][];
}

export interface FunctionScan {
  definitions: FunctionDefinition[];
  /** `name/arity` of every top-level function declaration (an existing prototype). */
  declared: Set<string>;
}

const NOT_NAMES = new Set(['if', 'while', 'for', 'switch', 'catch', 'return', 'sizeof', 'decltype', 'alignof', 'defined']);
const NOT_IN_TYPE = /\b(?:class|struct|union|enum|namespace|typedef|using|template|operator|extern|friend)\b|[=(){};#"'[\]]/;
const TRAILING = /\s*(?:\bconst\b|\bvolatile\b|\bnoexcept\b|\bthrow\s*\(\s*\))\s*$/;
// Already declared by Arduino.h; Arduino never prototypes them either.
const SKIP = new Set(['setup', 'loop', 'main']);

/** Split a parameter list at top-level commas; returns [from, to) ranges relative to `params`. */
function splitParams(params: string): [number, number][] {
  const out: [number, number][] = [];
  let depth = 0;
  let from = 0;
  for (let k = 0; k < params.length; k++) {
    const c = params[k];
    if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
    else if (c === ')' || c === ']' || c === '}' || c === '>') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      out.push([from, k]);
      from = k + 1;
    }
  }
  out.push([from, params.length]);
  return out;
}

interface Head {
  name: string;
  arity: number;
  /** Offsets (in the scanned text) of the parameter list, inside the parentheses. */
  paramsFrom: number;
  paramsTo: number;
  /** Offset where the declaration starts (first non-space). */
  start: number;
  /** Offset just after the head (before `{` or `;`). */
  end: number;
}

/** Parse `[specifiers] type name(params) [const|noexcept]` from code[from, to) (blanked code). */
function parseHead(code: string, from: number, to: number): Head | undefined {
  let head = code.slice(from, to);
  while (TRAILING.test(head)) head = head.replace(TRAILING, '');
  head = head.replace(/\s+$/, '');
  if (!head.endsWith(')')) return undefined;
  const lead = head.length - head.trimStart().length;
  const start = from + lead;
  const close = from + head.length - 1;
  let depth = 0;
  let open = -1;
  for (let k = close; k >= start; k--) {
    if (code[k] === ')') depth++;
    else if (code[k] === '(' && --depth === 0) {
      open = k;
      break;
    }
  }
  if (open < 0) return undefined;
  const before = code.slice(start, open).replace(/\s+$/, '');
  const m = /([A-Za-z_]\w*)$/.exec(before);
  if (!m) return undefined;
  const name = m[1];
  const type = before.slice(0, before.length - name.length);
  if (NOT_NAMES.has(name)) return undefined;
  if (/::\s*$/.test(type) || type.trim() === '' || NOT_IN_TYPE.test(type)) return undefined;
  if (!/^[\w\s:*&<>,]+$/.test(type)) return undefined;
  const params = code.slice(open + 1, close);
  const trimmed = params.trim();
  const arity = trimmed === '' || trimmed === 'void' ? 0 : splitParams(params).length;
  return { name, arity, paramsFrom: open + 1, paramsTo: close, start, end: to };
}

/**
 * Find the top-level function definitions and declarations of one .ino
 * file. Comments, strings and preprocessor lines are ignored, templates and
 * class members are skipped.
 */
export function scanFunctions(text: string): FunctionScan {
  const noComments = blankSource(text);
  const code = blankSource(text, { strings: true, directives: true });
  const definitions: FunctionDefinition[] = [];
  const declared = new Set<string>();
  let depth = 0;
  let parens = 0;
  let segStart = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (depth === 0) {
      if (c === '(') parens++;
      else if (c === ')') parens = Math.max(0, parens - 1);
      else if (c === ';' && parens === 0) {
        const h = parseHead(code, segStart, i);
        if (h) declared.add(`${h.name}/${h.arity}`);
        segStart = i + 1;
      } else if (c === '{' && parens === 0) {
        const segment = code.slice(segStart, i);
        const h = /^\s*template\b/.test(segment) ? undefined : parseHead(code, segStart, i);
        if (h) definitions.push(definition(noComments, code, h));
        depth = 1;
      }
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) segStart = i + 1;
  }
  return { definitions, declared };
}

function definition(noComments: string, code: string, h: Head): FunctionDefinition {
  const defaults: [number, number][] = [];
  for (const [a, b] of splitParams(code.slice(h.paramsFrom, h.paramsTo))) {
    const part = code.slice(h.paramsFrom + a, h.paramsFrom + b);
    let depth = 0;
    for (let k = 0; k < part.length; k++) {
      const c = part[k];
      if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
      else if (c === ')' || c === ']' || c === '}' || c === '>') depth--;
      else if (c === '=' && depth === 0) {
        defaults.push([h.paramsFrom + a + k, h.paramsFrom + b]);
        break;
      }
    }
  }
  // Prototype text from the comment-free original (strings intact), on one line.
  const prototype = `${noComments.slice(h.start, h.end).replace(/\s*\r?\n\s*/g, ' ').trim()};`;
  return { name: h.name, arity: h.arity, prototype, line: lineAt(code, h.start), start: h.start, defaults };
}

export interface PreparedIno {
  /** The C++ text of the joined .ino files. */
  text: string;
  /** The generated prototypes, in order. */
  prototypes: string[];
  /** The .ino files in the order they were joined. */
  order: string[];
}

/**
 * Join the .ino files (already ordered, primary first) into one C++ unit.
 * `fileName(path)` gives the name used in `#line` (a path the compiler can
 * open, so its messages show the original source line).
 */
export function prepareIno(files: readonly SourceFile[], fileName: (path: string) => string = (p) => p): PreparedIno {
  const scans = files.map((f) => scanFunctions(f.text));
  const declared = new Set<string>();
  for (const s of scans) for (const d of s.declared) declared.add(d);
  const seen = new Set<string>();
  const protos: { file: string; def: FunctionDefinition }[] = [];
  scans.forEach((s, k) => {
    for (const def of s.definitions) {
      const key = `${def.name}/${def.arity}`;
      if (SKIP.has(def.name) || declared.has(key) || seen.has(def.prototype)) continue;
      seen.add(def.prototype);
      protos.push({ file: files[k].path, def });
    }
  });
  const withProto = new Set(protos.map((p) => p.def));
  // Prototypes go just before the first function definition, so types the
  // sketch declares above it are visible to them (as the Arduino builder does).
  const firstFile = scans.findIndex((s) => s.definitions.length > 0);
  const parts: string[] = ['#include <Arduino.h>\n'];
  files.forEach((f, k) => {
    let text = f.text;
    // The prototype carries the default arguments; the definition must not repeat them.
    for (const def of scans[k].definitions) {
      if (!withProto.has(def)) continue;
      for (const [a, b] of def.defaults) text = text.slice(0, a) + text.slice(a, b).replace(/[^\r\n]/g, ' ') + text.slice(b);
    }
    const name = JSON.stringify(fileName(f.path));
    parts.push(`#line 1 ${name}\n`);
    if (k === firstFile && protos.length > 0) {
      const first = scans[k].definitions[0];
      const lineFrom = text.lastIndexOf('\n', first.start - 1) + 1;
      const onlySpace = text.slice(lineFrom, first.start).trim() === '';
      const at = onlySpace ? lineFrom : first.start;
      const column = first.start - lineFrom;
      parts.push(text.slice(0, at));
      if (!onlySpace) parts.push('\n');
      for (const p of protos) parts.push(`#line ${p.def.line} ${JSON.stringify(fileName(p.file))}\n${p.def.prototype}\n`);
      parts.push(`#line ${first.line} ${name}\n`);
      if (!onlySpace) parts.push(' '.repeat(column));
      text = text.slice(at);
    }
    parts.push(text.endsWith('\n') ? text : `${text}\n`);
  });
  return { text: parts.join(''), prototypes: protos.map((p) => p.def.prototype), order: files.map((f) => f.path) };
}
