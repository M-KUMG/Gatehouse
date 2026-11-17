// Pure logic of "Import files": which files a board takes, what to call an
// incoming file when its name is taken, how to read its bytes as text, where
// it goes, and the one message that reports a whole import. No DOM.

import { MAX_FILE_BYTES, parentOf, quote } from '../project/paths';
import { extensionOf } from './editorlang';
import type { ProjectNode } from './projectrows';

/** ".ino, .cpp, .c": extensions as shown to people. */
export function extensionList(accepted: readonly string[]): string {
  return accepted.map((e) => `.${e}`).join(', ');
}

/**
 * Why `name` cannot be imported into a board that accepts `accepted`
 * extensions (lower case, no dot), or null when it can.
 */
export function extensionError(name: string, accepted: readonly string[]): string | null {
  const ext = extensionOf(name);
  if (accepted.length === 0) return `${quote(name)} was not imported: this board type does not take imported files.`;
  if (accepted.includes(ext)) return null;
  const what = ext === '' ? 'has no file extension' : `is a .${ext} file`;
  return `${quote(name)} ${what}; this board takes ${extensionList(accepted)}.`;
}

/** Why a file of `bytes` bytes is too big for the tree, in the tree's own words (see filetree.ts treeError), or null. */
export function sizeError(name: string, bytes: number): string | null {
  return bytes > MAX_FILE_BYTES ? `${quote(name)} is ${Math.ceil(bytes / 1024)} KB; a file can be at most ${MAX_FILE_BYTES / 1024} KB.` : null;
}

export type DecodeResult = { ok: true; text: string } | { ok: false; reason: string };

/** The text in `bytes`: UTF-8 (a leading byte order mark is dropped), no NUL. Anything else is not a text file. */
export function decodeText(name: string, bytes: Uint8Array): DecodeResult {
  if (bytes.includes(0)) return { ok: false, reason: `${quote(name)} is not a text file (it contains NUL bytes).` };
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: `${quote(name)} is not valid UTF-8 text.` };
  }
}

/** "main.ino" -> { base: "main", ext: ".ino" }; ".hidden" and "Makefile" have no extension. */
export function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? { base: name.slice(0, dot), ext: name.slice(dot) } : { base: name, ext: '' };
}

/**
 * `name` if no entry of the folder has it, else "name (2).ext", "name (3).ext"
 * ... Names compare ignoring letter case (the tree does too), so `taken` holds
 * lower-case names.
 */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  const { base, ext } = splitName(name);
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Where imported files go: a board and a folder inside it ('' for the board folder). */
export interface ImportTarget {
  boardId: string;
  folder: string;
}

type TargetRow = Pick<ProjectNode, 'kind' | 'boardId' | 'path'>;

/** The folder a row stands for when files are dropped on it: a board or folder itself, a file's folder. Null for the other rows. */
export function dropTarget(row: TargetRow | null): ImportTarget | null {
  if (!row || row.boardId === undefined) return null;
  if (row.kind === 'board') return { boardId: row.boardId, folder: '' };
  if (row.kind === 'folder') return { boardId: row.boardId, folder: row.path ?? '' };
  if (row.kind === 'file') return { boardId: row.boardId, folder: parentOf(row.path ?? '') ?? '' };
  return null;
}

/** Where the Import button puts files: the selected folder or file's folder, else the active board's folder. Null without a board. */
export function importTarget(selected: TargetRow | null, activeBoardId: string | null): ImportTarget | null {
  return dropTarget(selected) ?? (activeBoardId === null ? null : { boardId: activeBoardId, folder: '' });
}

export interface Skipped {
  name: string;
  /** A whole sentence that names the file. */
  reason: string;
}

export interface ImportOutcome {
  imported: number;
  /** Imported under another name because the name was taken. */
  renamed: number;
  skipped: readonly Skipped[];
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
/** At most this many reasons are spelled out. */
const MAX_REASONS = 3;

/** The one message for a whole import: "Imported 3 files, 1 skipped: reason". */
export function summarizeImport(outcome: ImportOutcome): { text: string; kind: 'info' | 'error' } {
  const { imported, renamed, skipped } = outcome;
  if (imported === 0 && skipped.length === 0) return { text: 'No files to import.', kind: 'info' };
  const reasons = skipped.slice(0, MAX_REASONS).map((s) => s.reason);
  if (skipped.length > MAX_REASONS) reasons.push(`and ${skipped.length - MAX_REASONS} more.`);
  const why = reasons.join(' ');
  if (imported === 0) return { text: `Nothing was imported. ${why}`, kind: 'error' };
  let text = `Imported ${plural(imported, 'file', 'files')}`;
  if (renamed > 0) text += ` (${renamed} renamed to keep both)`;
  if (skipped.length > 0) text += `, ${skipped.length} skipped: ${why}`;
  return { text, kind: skipped.length > 0 ? 'error' : 'info' };
}
