// Which files the Code editor opens and how it highlights them. Pure, no DOM
// and no CodeMirror (the editor itself is loaded lazily, see editorcm.ts).

export type EditorLanguage = 'cpp' | 'python' | 'json' | 'plain';

/** Extensions of text files the editor opens (lower case, without the dot). */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  'ino', 'pde', 'cpp', 'cc', 'cxx', 'c', 'h', 'hh', 'hpp', 'py',
  'txt', 'md', 'json', 'ini', 'cfg', 'csv',
]);

const CPP_EXTENSIONS: ReadonlySet<string> = new Set(['ino', 'pde', 'cpp', 'cc', 'cxx', 'c', 'h', 'hh', 'hpp']);

/** Last path segment ("lib/led.h" -> "led.h"). */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Lower-case extension without the dot, or "" when the name has none
 * ("Makefile", ".gitignore", "name." all have none).
 */
export function extensionOf(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/** True for files the Code editor can show: known text types and files without an extension. */
export function isEditable(path: string): boolean {
  const ext = extensionOf(path);
  return ext === '' || TEXT_EXTENSIONS.has(ext);
}

/** Highlighting for a file: C/C++ for the Arduino and C family, Python for .py, JSON for .json, else none. */
export function languageFor(path: string): EditorLanguage {
  const ext = extensionOf(path);
  if (CPP_EXTENSIONS.has(ext)) return 'cpp';
  if (ext === 'py') return 'python';
  if (ext === 'json') return 'json';
  return 'plain';
}
