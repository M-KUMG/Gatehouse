// Pure helpers of the File explorer about names: what a typed name means
// (paths are relative to a board's folder here; the tree rows are in
// projectrows.ts). No DOM.

import { parentOf, pathError } from '../project/paths';

/** Path of a board's folder itself (the parent of its top-level items). */
export const ROOT = '';

export function joinPath(folder: string, name: string): string {
  return folder === ROOT ? name : `${folder}/${name}`;
}

export type NameCheck = { ok: true; path: string } | { ok: false; error: string };

/** The full path for a typed new name ("lib/led.h" is allowed: folders in between are made too), or why not. */
export function checkNewName(parent: string, typed: string): NameCheck {
  const name = typed.trim();
  if (name === '') return { ok: false, error: 'Type a name.' };
  const path = joinPath(parent, name);
  const bad = pathError(path);
  return bad ? { ok: false, error: bad } : { ok: true, path };
}

export type RenameCheck = { ok: true; path: string; unchanged: boolean } | { ok: false; error: string };

/** The new path for renaming `path` to the typed name, in the same folder. */
export function checkRename(path: string, typed: string): RenameCheck {
  const name = typed.trim();
  if (name === '') return { ok: false, error: 'Type a name.' };
  if (name.includes('/')) return { ok: false, error: 'A name cannot contain "/". Renaming keeps the item in its folder.' };
  const target = joinPath(parentOf(path) ?? ROOT, name);
  const bad = pathError(target);
  if (bad) return { ok: false, error: bad };
  return { ok: true, path: target, unchanged: target === path };
}

/** How many leading characters of a file name are its base name (before the extension): what rename selects first. */
export function baseLength(name: string): number {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? dot : name.length;
}

/** Source files the editor will open as code (they get the code icon). */
export function isCodeFile(name: string): boolean {
  return /\.(ino|pde|c|cc|cpp|cxx|h|hh|hpp|s)$/i.test(name);
}

/** `paths` after `from` was renamed to `to`: entries at or inside `from` move along. */
export function remapPaths(paths: ReadonlySet<string>, from: string, to: string): Set<string> {
  return new Set([...paths].map((p) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p)));
}
