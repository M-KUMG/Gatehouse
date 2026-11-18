// What a sketch is made of: which files of a board folder are compiled, which
// are headers, and the translation units built from them. Pure.

import { orderInoFiles, prepareIno, type SourceFile } from './preprocess';

export interface SketchInput {
  /** The board folder's files: path (relative, '/'-separated) -> text. Other files are ignored. */
  files: Readonly<Record<string, string>>;
  /** Board profile id (see profiles.ts). */
  profileId: string;
  /** The sketch folder's name, to find the primary .ino (Arduino names it after the folder). */
  sketchName?: string;
}

/** Where the sketch lives in the tools' filesystem. */
export const SKETCH_ROOT = '/sketch';
export const BUILD_ROOT = '/build';

export interface TranslationUnit {
  /** Name shown to people (the primary .ino for the joined .ino files). */
  display: string;
  /** Path of the unit's source in the tools' filesystem (next to the original, so "x.h" includes resolve). */
  path: string;
  /** Text compiled (preprocessed .ino, wrapped .c, or the .cpp as is). */
  text: string;
  /** Object file path. */
  object: string;
  /** Compiled as C (with the C-as-C++ workaround). */
  isC: boolean;
}

export interface SketchLayout {
  /** Every compiled or included file (sources and headers), sketch-relative. */
  sources: SourceFile[];
  /** Header files only (part of each unit's cache key). */
  headers: SourceFile[];
  units: TranslationUnit[];
  /** The .ino files in join order (primary first). */
  inoOrder: string[];
  prototypes: string[];
  /** Base name for the firmware (e.g. "main.ino.hex"). */
  firmwareName: string;
}

const SOURCE = /\.(ino|cpp|c|h|hpp)$/i;

/** Normalise a board-folder path: '/' separators, no leading './' or '/'. */
export const normalisePath = (p: string): string => p.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');

/** Root-level sketch files and everything under src/ (as the Arduino builder compiles). */
export function sketchFiles(files: Readonly<Record<string, string>>): SourceFile[] {
  const out: SourceFile[] = [];
  for (const [p, text] of Object.entries(files)) {
    const path = normalisePath(p);
    if (!SOURCE.test(path)) continue;
    const root = !path.includes('/');
    if (root || path.startsWith('src/')) {
      if (!root && /\.ino$/i.test(path)) continue; // .ino files only count at the root
      out.push({ path, text });
    }
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const objectPath = (display: string): string => `${BUILD_ROOT}/${display}.o`;

/** Split a sketch into translation units. */
export function layoutSketch(input: SketchInput): SketchLayout {
  const sources = sketchFiles(input.files);
  const headers = sources.filter((f) => /\.(h|hpp)$/i.test(f.path));
  const inoOrder = orderInoFiles(sources.filter((f) => /\.ino$/i.test(f.path)).map((f) => f.path), input.sketchName);
  const units: TranslationUnit[] = [];
  let prototypes: string[] = [];
  if (inoOrder.length > 0) {
    const text = new Map(sources.map((f) => [f.path, f.text]));
    const prepared = prepareIno(inoOrder.map((path) => ({ path, text: text.get(path) ?? '' })), (p) => `${SKETCH_ROOT}/${p}`);
    prototypes = prepared.prototypes;
    const display = inoOrder[0];
    units.push({ display, path: `${SKETCH_ROOT}/${display}.cpp`, text: prepared.text, object: objectPath(display), isC: false });
  }
  for (const f of sources) {
    if (/\.cpp$/i.test(f.path)) {
      units.push({ display: f.path, path: `${SKETCH_ROOT}/${f.path}`, text: f.text, object: objectPath(f.path), isC: false });
    } else if (/\.c$/i.test(f.path)) {
      // No C compiler (cc1) in the toolchain: compile C as C++ with C linkage.
      const text = `extern "C" {\n#line 1 ${JSON.stringify(`${SKETCH_ROOT}/${f.path}`)}\n${f.text}\n}\n`;
      units.push({ display: f.path, path: `${SKETCH_ROOT}/${f.path}.cpp`, text, object: objectPath(f.path), isC: true });
    }
  }
  const firmwareName = `${inoOrder[0] ?? units[0]?.display ?? 'sketch'}.hex`;
  return { sources, headers, units, inoOrder, prototypes, firmwareName };
}

/** Internal path -> sketch-relative name, for messages. */
export function displayPath(layout: SketchLayout): (p: string) => string {
  const byObject = new Map(layout.units.map((u) => [u.object, u.display]));
  const byUnit = new Map(layout.units.map((u) => [u.path, u.display]));
  return (p) => {
    const known = byObject.get(p) ?? byUnit.get(p);
    if (known) return known;
    if (p.startsWith(`${SKETCH_ROOT}/`)) return p.slice(SKETCH_ROOT.length + 1);
    if (p.startsWith(`${BUILD_ROOT}/`)) return p.slice(BUILD_ROOT.length + 1);
    return p;
  };
}
