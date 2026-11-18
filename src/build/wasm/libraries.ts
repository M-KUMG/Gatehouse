// Which bundled libraries a sketch uses: scan its #include lines, map each
// header to the sketch's own files, the core/avr-libc/GCC headers or a
// bundled library, and report the ones that are none of these. Only the
// libraries a sketch includes are linked (linking all of them pulls in their
// interrupt handlers and clashes with a sketch's own ISR). Pure.

import type { BuildMessage } from './diagnostics';
import type { SourceFile } from './preprocess';
import { blankSource } from './source';
import { BUNDLED_LIBRARIES, SYSTEM_HEADERS, type BundledLibrary } from './sysroot';

export interface IncludeLine {
  /** The including file (sketch-relative path). */
  file: string;
  line: number;
  column: number;
  header: string;
  angle: boolean;
}

const INCLUDE = /^([ \t]*#[ \t]*include[ \t]*)([<"])([^>"\r\n]+)[>"]/gm;

/** Every #include of the file (comments ignored). */
export function scanIncludes(file: SourceFile): IncludeLine[] {
  const text = blankSource(file.text);
  const out: IncludeLine[] = [];
  for (const m of text.matchAll(INCLUDE)) {
    const at = m.index ?? 0;
    const line = text.slice(0, at).split('\n').length;
    out.push({ file: file.path, line, column: m[1].length + 1, header: m[3].trim(), angle: m[2] === '<' });
  }
  return out;
}

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');

/** Normalise a/b/../c to a/c; undefined when it leaves the sketch folder. */
function normalise(path: string): string | undefined {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return undefined;
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

export interface LibraryResolution {
  libraries: BundledLibrary[];
  /** One error per unknown header include. */
  errors: BuildMessage[];
}

export const libraryList = (libs: readonly BundledLibrary[] = BUNDLED_LIBRARIES): string => libs.map((l) => l.name).join(', ');

/**
 * Map the sketch's includes to bundled libraries. `files` are all sketch
 * files (headers included), with paths relative to the sketch folder; the
 * sketch root and src/ are on the include path.
 */
export function resolveLibraries(files: readonly SourceFile[], libs: readonly BundledLibrary[] = BUNDLED_LIBRARIES): LibraryResolution {
  const own = new Set(files.map((f) => f.path));
  const byHeader = new Map<string, BundledLibrary>();
  for (const l of libs) for (const h of l.headers) byHeader.set(h, l);
  const used = new Set<BundledLibrary>();
  const errors: BuildMessage[] = [];
  for (const f of files) {
    for (const inc of scanIncludes(f)) {
      const candidates = [...(inc.angle ? [] : [dirOf(f.path) + inc.header]), inc.header, `src/${inc.header}`];
      if (candidates.some((c) => own.has(normalise(c) ?? ''))) continue;
      const lib = byHeader.get(inc.header);
      if (lib) {
        used.add(lib);
        continue;
      }
      if (SYSTEM_HEADERS.has(inc.header)) continue;
      // A quoted include of a missing file is the compiler's to report (with its own wording).
      if (!inc.angle) continue;
      const sameName = [...byHeader.keys(), ...SYSTEM_HEADERS].find((h) => h.toLowerCase() === inc.header.toLowerCase());
      const message = sameName
        ? `Library '${inc.header}' is not available: names are case-sensitive, did you mean <${sameName}>?`
        : `Library '${inc.header}' is not available in the browser compiler. Bundled libraries: ${libraryList(libs)}.`;
      errors.push({
        severity: 'error', file: inc.file, line: inc.line, column: inc.column, message,
        raw: `${inc.file}:${inc.line}:${inc.column}: error: ${message}`,
      });
    }
  }
  return { libraries: libs.filter((l) => used.has(l)), errors };
}
