// Turns GCC (cc1plus), GNU as and GNU ld output into structured messages
// with the ORIGINAL file names (the sketch's #line directives already make
// GCC report "main.ino:5"; `mapPath` turns the tools' internal paths such as
// /sketch/main.ino or /build/main.ino.o into sketch-relative names). Linker
// errors get a friendly summary; the tool's text is always kept in `raw`.
// Pure, no DOM, no Node.

export type Severity = 'error' | 'warning' | 'note';

export interface BuildMessage {
  severity: Severity;
  /** Sketch-relative file, when the message has one. */
  file?: string;
  line?: number;
  column?: number;
  /** The message (for linker errors: a friendly summary). */
  message: string;
  /** The tool's text for this message (context, message and snippet), internal paths mapped. */
  raw: string;
  /** Source snippet and caret lines GCC printed under the message. */
  detail?: string;
  /** Lines GCC printed before it: "In function ...", "In file included from ...", "required from here". */
  context?: string;
}

/** Maps a tool's internal path to the name shown to people. */
export type PathMap = (path: string) => string;

const identity: PathMap = (p) => p;

/** Map every absolute internal path inside a text line. */
export function mapPathsInText(text: string, mapPath: PathMap): string {
  return text.replace(/\/(?:sketch|build)\/[^\s:'"`,;()]+/g, (p) => mapPath(p));
}

const GCC_LINE = /^(.+?):(\d+):(?:(\d+):)? (fatal error|error|warning|note): (.*)$/;
const GCC_TOOL_LINE = /^(cc1plus|cc1|as|ld|objcopy|collect2): (fatal error|error|warning|note): (.*)$/;
const GCC_CONTEXT =
  /^(?:In file included from .*|\s+from .*|.*: In (?:member |static member |)function .*|.*: In (?:constructor|destructor|instantiation|substitution|lambda function).*|.*: At global scope:|.*:\d+:\d+:\s+(?:required|recursively required|in constexpr expansion|in expansion of macro|required by substitution) .*)$/;

const severityOf = (s: string): Severity => (s === 'note' ? 'note' : s === 'warning' ? 'warning' : 'error');

/** Parse cc1plus diagnostics. */
export function parseGccOutput(text: string, mapPath: PathMap = identity): BuildMessage[] {
  const out: BuildMessage[] = [];
  let context: string[] = [];
  let last: { msg: BuildMessage; detail: string[]; raw: string[] } | undefined;
  const flush = (): void => {
    if (!last) return;
    if (last.detail.length) last.msg.detail = last.detail.join('\n');
    last.msg.raw = last.raw.join('\n');
    out.push(last.msg);
    last = undefined;
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = mapPathsInText(rawLine, mapPath);
    if (line.trim() === '') continue;
    const m = GCC_LINE.exec(rawLine);
    const t = m ? null : GCC_TOOL_LINE.exec(rawLine);
    if (m || t) {
      flush();
      const msg: BuildMessage = m
        ? {
            severity: severityOf(m[4]), file: mapPath(m[1]), line: Number(m[2]),
            ...(m[3] ? { column: Number(m[3]) } : {}), message: m[5], raw: '',
          }
        : { severity: severityOf(t![2]), message: t![3], raw: '' };
      if (context.length) msg.context = context.join('\n');
      last = { msg, detail: [], raw: [...context, line] };
      context = [];
    } else if (GCC_CONTEXT.test(rawLine) && !/^\s/.test(rawLine)) {
      flush();
      context.push(line);
    } else if (/^\s+from /.test(rawLine)) {
      context.push(line);
    } else if (last && /^\s/.test(rawLine)) {
      last.detail.push(rawLine);
      last.raw.push(rawLine);
    } else if (last) {
      // "compilation terminated." and anything unrecognised stay with the message.
      last.raw.push(line);
    } else {
      context.push(line);
    }
  }
  flush();
  if (context.length) {
    // Text with no message at all (a tool crash): keep it as an error so it is never lost.
    out.push({ severity: 'error', message: context.join('\n'), raw: context.join('\n') });
  }
  return out;
}

/**
 * Parse GNU as output ("x.s: Assembler messages:" then "x.s:12: Error: ...").
 * The line numbers are in the generated assembly, not the sketch, so the
 * message names the unit (`unit`, e.g. "main.ino") and the assembly line.
 */
export function parseAsOutput(text: string, unit: string): BuildMessage[] {
  const out: BuildMessage[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === '' || /Assembler messages:$/.test(rawLine)) continue;
    const m = /^(.+?):(\d+): (Error|Warning|Fatal error): (.*)$/i.exec(rawLine);
    if (m) {
      const severity: Severity = /warning/i.test(m[3]) ? 'warning' : 'error';
      const message = `Assembler ${severity} in the code generated for ${unit} (assembly line ${m[2]}): ${m[4]}`;
      out.push({ severity, file: unit, message, raw: `${unit} (assembly):${m[2]}: ${m[3]}: ${m[4]}` });
    } else out.push({ severity: /warning/i.test(rawLine) ? 'warning' : 'error', file: unit, message: rawLine, raw: rawLine });
  }
  return out;
}

/** "`foo()'" or "'foo()'" -> foo() */
const symbol = (s: string): string => s.replace(/^[`'‘]|['’]$/g, '');

const LD_PREFIX = /^(?:\S*\/)?(?:avr-)?ld(?:\.exe)?: /;
const UNDEFINED = /^(.*?): undefined reference to (.+)$/;
const MULTIPLE = /^(.*?): multiple definition of (.+?); (.*?): first defined here$/;

interface Where {
  file?: string;
  line?: number;
  /** The library archive the object came from ("Servo" for .../Servo.a(x.o)). */
  library?: string;
}

/**
 * Where an ld message points: "obj.o:/sketch/a.cpp:3", "/sketch/a.ino:3:(.text+0x4)",
 * "a.ino.cpp:(.text.x+0x0)", "/arduino/libraries/Servo.a(avr_Servo.cpp.o)".
 */
export function ldLocation(where: string, mapPath: PathMap = identity): Where {
  const w = where.replace(LD_PREFIX, '').trim().replace(/:\s*\([^()]*\)$/, '');
  const lib = /([^/:]+)\.a\([^)]*\)/.exec(w);
  const library = lib ? lib[1] : undefined;
  const m = /(?:^|:)([^:]+):(\d+):?$/.exec(w);
  if (m) return { file: mapPath(m[1]), line: Number(m[2]), ...(library ? { library } : {}) };
  const parts = w.split(':').filter((p) => p.trim() !== '');
  const last = parts[parts.length - 1];
  return { ...(last ? { file: mapPath(last) } : {}), ...(library ? { library } : {}) };
}

const at = (w: Where): string => (w.library ? `the ${w.library} library` : w.file ? `${w.file}${w.line ? `:${w.line}` : ''}` : 'another file');

/** Parse GNU ld output; known errors get a friendly `message`, the tool's text stays in `raw`. */
export function parseLdOutput(text: string, mapPath: PathMap = identity): BuildMessage[] {
  const out: BuildMessage[] = [];
  let context: string | undefined;
  let fn: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === '') continue;
    const line = mapPathsInText(rawLine, mapPath);
    const inFn = /in function [`'‘](.*)['’]:$/i.exec(rawLine);
    if (inFn) {
      context = line;
      fn = inFn[1];
      continue;
    }
    // A line starting with "ld: " stands alone; other lines belong to the last "in function".
    if (LD_PREFIX.test(rawLine)) {
      context = undefined;
      fn = undefined;
    }
    const raw = context ? `${context}\n${line}` : line;
    const ctx = context ? { context } : {};
    const body = rawLine.replace(LD_PREFIX, '');
    const und = UNDEFINED.exec(body);
    const mul = und ? null : MULTIPLE.exec(body);
    if (und) {
      const name = symbol(und[2]);
      const { library: _lib, ...where } = ldLocation(und[1], mapPath);
      out.push({
        severity: 'error', ...where, ...ctx, raw,
        message: `Undefined reference to '${name}'${fn ? ` in ${fn}` : ''}: it is declared but never defined, or its library is not included.`,
      });
    } else if (mul) {
      const name = symbol(mul[2]);
      const here = ldLocation(mul[1], mapPath);
      // "ld: .../Servo.a(x.o): in function `f':" says which library the definition is in.
      const contextLib = context ? ldLocation(context.replace(/: in function .*$/i, ''), mapPath).library : undefined;
      if (!here.library && contextLib) here.library = contextLib;
      const first = ldLocation(mul[3], mapPath);
      const vector = /^__vector_(\d+)$/.exec(name);
      const message = vector
        ? `Interrupt handler ${name} (vector ${vector[1]}) is defined twice: in ${at(first)} and in ${at(here)}. ` +
          'A library you include already uses this interrupt; use another one or drop that library.'
        : `'${name}' is defined more than once: in ${at(here)} and in ${at(first)}. Define it in one file only (declare it 'extern' in the others).`;
      // Point at the user's file rather than a library's.
      const where = here.library && !first.library ? first : here;
      out.push({ severity: 'error', ...(where.file ? { file: where.file } : {}), ...(where.line ? { line: where.line } : {}), ...ctx, raw, message });
    } else if (/will not fit in region|region [`'‘].*['’] overflowed|is not within region/.test(body)) {
      const ram = /\bdata\b|bss|noinit/.test(body);
      out.push({ severity: 'error', message: ram ? `Not enough RAM: ${body}` : `Sketch too big for the flash memory: ${body}`, raw });
    } else if (/^warning: /i.test(body)) {
      out.push({ severity: 'warning', message: mapPathsInText(body.replace(/^warning: /i, ''), mapPath), raw });
    } else {
      out.push({ severity: 'error', message: mapPathsInText(body, mapPath), raw, ...ctx });
    }
  }
  return out;
}

/** "main.ino:5:3: error: message" */
export function formatMessage(m: BuildMessage): string {
  const at = m.file ? `${m.file}${m.line ? `:${m.line}${m.column ? `:${m.column}` : ''}` : ''}: ` : '';
  return `${at}${m.severity}: ${m.message}`;
}
