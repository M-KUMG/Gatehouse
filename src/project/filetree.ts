// The source files of one board: text files by path plus explicitly
// created folders (so an empty folder can exist). Pure and DOM-free: every
// operation returns a new tree or an error worded for the person using the
// app; user mistakes never throw. Path rules live in paths.ts.
//
// Folders exist implicitly above every file and explicit folder. A folder
// that would vanish because its last entry was moved or deleted is kept as
// an explicit folder, so emptying a folder does not remove it.

import {
  MAX_FILES, MAX_FILE_BYTES, MAX_FOLDERS, ancestors, byteLength, fold, isInside, parentOf, pathError, quote,
} from './paths';

export interface BoardTree {
  /** Path -> file text. */
  files: Record<string, string>;
  /** Explicitly created folders (may also be implied by files inside them). */
  folders: string[];
}

/** Source trees of all boards in a project, by boardId. */
export type SourceFiles = Record<string, BoardTree>;

export type TreeResult = { ok: true; tree: BoardTree } | { ok: false; error: string };
export type ReadResult = { ok: true; content: string } | { ok: false; error: string };

export interface TreeEntry {
  path: string;
  /** Last path segment. */
  name: string;
  kind: 'file' | 'folder';
  /** 0 for entries directly in the board folder. */
  depth: number;
  /** Files: size in UTF-8 bytes. */
  size?: number;
}

export const DEFAULT_SKETCH_PATH = 'main.ino';

export const DEFAULT_SKETCH = `// Blink: turns the built-in LED (pin 13) on and off once a second.
//
// This file is source only. Gatehouse cannot compile sketches yet: the
// board runs the program loaded as a .hex file.

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(1000);
  digitalWrite(LED_BUILTIN, LOW);
  delay(1000);
}
`;

export function emptyTree(): BoardTree {
  return { files: {}, folders: [] };
}

/** What a new board starts with. */
export function defaultTree(): BoardTree {
  return { files: { [DEFAULT_SKETCH_PATH]: DEFAULT_SKETCH }, folders: [] };
}

/** Same content, sorted (files by path, folders unique): equal trees give equal JSON. */
export function canonical(files: Record<string, string>, folders: Iterable<string>): BoardTree {
  // fromEntries defines own properties, so even a file named "__proto__" stays a plain entry.
  const out = Object.fromEntries(Object.keys(files).sort(order).map((path) => [path, files[path]]));
  return { files: out, folders: [...new Set(folders)].sort(order) };
}

export function copyTree(tree: BoardTree): BoardTree {
  return canonical({ ...tree.files }, tree.folders);
}

function order(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const ok = (tree: BoardTree): TreeResult => ({ ok: true, tree });
const err = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Every entry by folded path: files, explicit folders and the folders they imply. */
function entries(tree: BoardTree): Map<string, { path: string; kind: 'file' | 'folder' }> {
  const out = new Map<string, { path: string; kind: 'file' | 'folder' }>();
  const folder = (path: string): void => {
    if (!out.has(fold(path))) out.set(fold(path), { path, kind: 'folder' });
  };
  for (const path of Object.keys(tree.files)) {
    out.set(fold(path), { path, kind: 'file' });
    ancestors(path).forEach(folder);
  }
  for (const path of tree.folders) {
    ancestors(path).forEach(folder);
    folder(path);
  }
  return out;
}

/** Whether `path` (exact spelling) is a file, a folder or nothing. */
export function kindOf(tree: BoardTree, path: string): 'file' | 'folder' | null {
  const e = entries(tree).get(fold(path));
  return e && e.path === path ? e.kind : null;
}

/**
 * Everything wrong with a whole tree, or null: path rules, limits, sizes,
 * names that differ only in case, and files used as folders. Used by every
 * operation (as a final check) and when reading a project.
 */
export function treeError(tree: BoardTree): string | null {
  const paths = Object.keys(tree.files);
  if (paths.length > MAX_FILES) return `A board can hold at most ${MAX_FILES} files (this one has ${paths.length}).`;
  if (tree.folders.length > MAX_FOLDERS) return `A board can hold at most ${MAX_FOLDERS} folders.`;
  const seen = new Map<string, string>();
  for (const path of [...paths, ...tree.folders]) {
    const bad = pathError(path);
    if (bad) return bad;
    const other = seen.get(fold(path));
    if (other !== undefined) {
      return other === path ? `${quote(path)} is listed twice.` : `${quote(path)} and ${quote(other)} differ only in letter case.`;
    }
    seen.set(fold(path), path);
  }
  const files = new Map(paths.map((p) => [fold(p), p]));
  for (const path of [...paths, ...tree.folders]) {
    for (const above of ancestors(path)) {
      const file = files.get(fold(above));
      if (file !== undefined) return `${quote(file)} is a file, so ${quote(path)} cannot be inside it.`;
    }
  }
  for (const path of paths) {
    const size = byteLength(tree.files[path]);
    if (size > MAX_FILE_BYTES) return `${quote(path)} is ${Math.ceil(size / 1024)} KB; a file can be at most ${MAX_FILE_BYTES / 1024} KB.`;
  }
  return null;
}

/** Final step of every change: check the whole result. */
function checked(files: Record<string, string>, folders: Iterable<string>): TreeResult {
  const tree = canonical(files, folders);
  const bad = treeError(tree);
  return bad ? err(bad) : ok(tree);
}

/** Why a new entry cannot be created at `path`, or null. */
function newEntryError(tree: BoardTree, path: string): string | null {
  const bad = pathError(path);
  if (bad) return bad;
  const existing = entries(tree).get(fold(path));
  if (existing) {
    const what = existing.kind === 'file' ? 'A file' : 'A folder';
    return existing.path === path ? `${what} named ${quote(path)} already exists.` : `${what} named ${quote(existing.path)} already exists (names are not case-sensitive).`;
  }
  return null;
}

/** Add a new text file (missing folders above it are created). */
export function createFile(tree: BoardTree, path: string, content = ''): TreeResult {
  const bad = newEntryError(tree, path);
  if (bad) return err(bad);
  if (Object.keys(tree.files).length >= MAX_FILES) return err(`A board can hold at most ${MAX_FILES} files.`);
  return checked({ ...tree.files, [path]: content }, tree.folders);
}

/** Add an empty folder (missing folders above it are created). */
export function createFolder(tree: BoardTree, path: string): TreeResult {
  const bad = newEntryError(tree, path);
  return bad ? err(bad) : checked(tree.files, [...tree.folders, path]);
}

export function readFile(tree: BoardTree, path: string): ReadResult {
  if (Object.hasOwn(tree.files, path)) return { ok: true, content: tree.files[path] };
  const bad = pathError(path);
  if (bad) return err(bad);
  return err(kindOf(tree, path) === 'folder' ? `${quote(path)} is a folder, not a file.` : `There is no file ${quote(path)}.`);
}

/** Replace the text of an existing file. */
export function writeFile(tree: BoardTree, path: string, content: string): TreeResult {
  const read = readFile(tree, path);
  if (!read.ok) return read;
  if (read.content === content) return ok(tree);
  return checked({ ...tree.files, [path]: content }, tree.folders);
}

/** Folders that held `paths` and would disappear without them stay as explicit folders. */
function keepParents(before: BoardTree, files: Record<string, string>, folders: string[], paths: string[]): string[] {
  const after = entries({ files, folders });
  const kept = [...folders];
  for (const path of paths) {
    const parent = parentOf(path);
    if (parent !== null && kindOf(before, parent) === 'folder' && !after.has(fold(parent))) kept.push(parent);
  }
  return kept;
}

/** Delete a file, or a folder with everything in it. */
export function deletePath(tree: BoardTree, path: string): TreeResult {
  const kind = kindOf(tree, path);
  if (!kind) return err(pathError(path) ?? `There is no file or folder ${quote(path)}.`);
  const gone = (p: string): boolean => p === path || (kind === 'folder' && isInside(p, path));
  const files = Object.fromEntries(Object.entries(tree.files).filter(([p]) => !gone(p)));
  const folders = tree.folders.filter((p) => !gone(p));
  return checked(files, keepParents(tree, files, folders, [path]));
}

/**
 * Rename or move a file or folder; a folder takes everything inside it
 * along. Changing only the letter case of a name is allowed.
 */
export function renamePath(tree: BoardTree, from: string, to: string): TreeResult {
  const kind = kindOf(tree, from);
  if (!kind) return err(pathError(from) ?? `There is no file or folder ${quote(from)}.`);
  const bad = pathError(to);
  if (bad) return err(bad);
  if (to === from) return ok(tree);
  if (kind === 'folder' && isInside(to, from)) return err(`A folder cannot be moved into itself (${quote(from)} -> ${quote(to)}).`);
  if (fold(to) !== fold(from)) {
    const clash = newEntryError(tree, to);
    if (clash) return err(clash);
  }
  const move = (p: string): string => (p === from ? to : kind === 'folder' && p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
  const files = Object.fromEntries(Object.entries(tree.files).map(([p, text]) => [move(p), text]));
  const folders = tree.folders.map(move);
  return checked(files, keepParents(tree, files, folders, [from]));
}

/** All files and folders, sorted so that each folder comes right before its contents. */
export function listTree(tree: BoardTree): TreeEntry[] {
  const all = [...entries(tree).values()];
  const key = (path: string): string[] => path.split('/');
  all.sort((a, b) => {
    const x = key(a.path);
    const y = key(b.path);
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      if (x[i] !== y[i]) {
        // Folders before files at the same level, then by name ignoring case.
        const aFolder = i < x.length - 1 || a.kind === 'folder';
        const bFolder = i < y.length - 1 || b.kind === 'folder';
        if (aFolder !== bFolder) return aFolder ? -1 : 1;
        return order(fold(x[i]), fold(y[i])) || order(x[i], y[i]);
      }
    }
    return x.length - y.length;
  });
  return all.map(({ path, kind }) => {
    const parts = key(path);
    const entry: TreeEntry = { path, name: parts[parts.length - 1], kind, depth: parts.length - 1 };
    if (kind === 'file') entry.size = byteLength(tree.files[path]);
    return entry;
  });
}
