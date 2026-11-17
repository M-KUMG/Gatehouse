// Rules for paths inside a board's source folder, in one place. A path is
// POSIX style and relative to the board folder ("main.ino", "lib/led.h").
// The rules keep every path usable as a real file name on Windows, macOS
// and Linux, so the same tree can later be written to disk or a zip.

/** Longest path, in characters. */
export const MAX_PATH_LENGTH = 200;
/** Most folder levels, counting the file name ("a/b/c.ino" is 3). */
export const MAX_DEPTH = 8;
/** Largest file, in bytes of UTF-8. */
export const MAX_FILE_BYTES = 512 * 1024;
/** Most files in one board. */
export const MAX_FILES = 200;
/** Most explicitly created folders in one board. */
export const MAX_FOLDERS = 200;

// Parentheses are allowed so "name (2).ext" (what a browser or an import makes for a duplicate) is a valid name.
const SEGMENT = /^[A-Za-z0-9 ._+()-]+$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
/** Device names Windows will not use as file names, with or without an extension. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** A path quoted for an error message (control characters made visible). */
export function quote(path: string): string {
  const text = JSON.stringify(path);
  return text.length > 60 ? `${text.slice(0, 57)}..."` : text;
}

/** Why `path` is not an allowed path, or null when it is fine. */
export function pathError(path: unknown): string | null {
  if (typeof path !== 'string') return 'A path must be text.';
  if (path.length === 0) return 'The name is empty.';
  const q = quote(path);
  if (path.length > MAX_PATH_LENGTH) return `${q} is longer than ${MAX_PATH_LENGTH} characters.`;
  if (CONTROL.test(path)) return `${q} contains a control character.`;
  if (path.includes('\\')) return `${q} contains a backslash; use "/" between folders.`;
  if (path.startsWith('/')) return `${q} starts with "/"; paths are relative to the board folder.`;
  if (path.endsWith('/')) return `${q} ends with "/".`;
  const segments = path.split('/');
  if (segments.length > MAX_DEPTH) return `${q} is more than ${MAX_DEPTH} levels deep.`;
  for (const s of segments) {
    if (s === '') return `${q} has an empty folder name ("//").`;
    if (s === '.' || s === '..') return `${q} uses "${s}", which is not allowed in a path.`;
    if (!SEGMENT.test(s)) return `"${s}" in ${q} may only use letters, digits, spaces and . _ - + ( ).`;
    if (s.startsWith(' ') || s.endsWith(' ')) return `"${s}" in ${q} starts or ends with a space.`;
    if (s.endsWith('.')) return `"${s}" in ${q} ends with ".", which Windows does not allow.`;
    if (RESERVED.test(s)) return `"${s}" in ${q} is a reserved device name on Windows.`;
  }
  return null;
}

/** The comparison key: paths that differ only in letter case are the same file on Windows and macOS. */
export function fold(path: string): string {
  return path.toLowerCase();
}

/** The folder holding `path`, or null for the board folder itself. */
export function parentOf(path: string): string | null {
  const i = path.lastIndexOf('/');
  return i < 0 ? null : path.slice(0, i);
}

/** Every folder above `path`, outermost first ("a/b/c" -> ["a", "a/b"]). */
export function ancestors(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** True when `path` is inside `folder` (at any depth), compared ignoring case. */
export function isInside(path: string, folder: string): boolean {
  return fold(path).startsWith(`${fold(folder)}/`);
}

const encoder = new TextEncoder();

/** Size of a text file as UTF-8 bytes. */
export function byteLength(text: string): number {
  return encoder.encode(text).length;
}
