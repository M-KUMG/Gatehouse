// Import files into a board's folder: the part that touches the browser
// (the file picker, dropped files, reading bytes) and the project. The rules
// (accepted extensions, names, the summary) are in importfiles.ts.
//
// Reading is asynchronous, so everything is read first; then all the files
// are written in one go, with no frame in between, which makes the whole
// import one undo step (the history settles after the next frame). Every
// file is checked by the project's own tree rules and refused with its own
// message, never overwritten: a name that is taken gets "name (2).ext".

import { createBoardFile, listBoardFiles, listBoards } from '../project/boardfiles';
import { toast } from '../project/dialog';
import { parentOf, quote } from '../project/paths';
import type { Project } from '../project/project';
import { getPart } from '../parts';
import { joinPath } from './filerows';
import { decodeText, extensionError, sizeError, summarizeImport, uniqueName, type ImportTarget, type Skipped } from './importfiles';

export interface ImportRequest {
  files: readonly File[];
  /** Refused before reading (dropped folders). */
  skipped?: readonly Skipped[];
  target: ImportTarget;
}

export interface ImportDone {
  boardId: string;
  folder: string;
  /** Paths inside the board of the files that were added, in order. */
  imported: string[];
}

/** The files of a drop, read right away (the list is gone after the event); dropped folders are reported, not read. */
export function filesFromDrop(data: DataTransfer): { files: File[]; skipped: Skipped[] } {
  const files: File[] = [];
  const skipped: Skipped[] = [];
  const items = [...data.items].filter((i) => i.kind === 'file');
  if (items.length === 0) return { files: [...data.files], skipped };
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    const file = item.getAsFile();
    if (entry?.isDirectory) skipped.push({ name: entry.name, reason: `${quote(entry.name)} is a folder; drop its files instead.` });
    else if (file) files.push(file);
  }
  return { files, skipped };
}

/** A hidden file picker (several files); `onFiles` gets what was chosen. */
export function createFilePicker(onFiles: (files: File[]) => void): { element: HTMLInputElement; open(): void } {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    input.value = ''; // the same file can be chosen again
    if (files.length > 0) onFiles(files);
  });
  return { element: input, open: () => input.click() };
}

/**
 * Read the files, then add them to the board. `run` wraps the synchronous
 * writing (the explorer holds its refresh back meanwhile). Shows one toast
 * with the result; returns what was added, or null when nothing was.
 */
export async function importFiles(project: Project, request: ImportRequest, run: <T>(op: () => T) => T): Promise<ImportDone | null> {
  const { target } = request;
  const board = listBoards(project).find((b) => b.boardId === target.boardId);
  if (!board) {
    toast('That board is no longer in the project.', 'error');
    return null;
  }
  const accepted = getPart(board.typeId)?.sourceExtensions ?? [];
  const skipped: Skipped[] = [...(request.skipped ?? [])];

  const ready: { name: string; text: string }[] = [];
  for (const file of request.files) {
    const bad = extensionError(file.name, accepted) ?? sizeError(file.name, file.size);
    if (bad) {
      skipped.push({ name: file.name, reason: bad });
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      skipped.push({ name: file.name, reason: `${quote(file.name)} could not be read.` });
      continue;
    }
    const text = decodeText(file.name, bytes);
    if (text.ok) ready.push({ name: file.name, text: text.text });
    else skipped.push({ name: file.name, reason: text.reason });
  }

  // The project may have changed while the files were read: look again, then write without a pause.
  const entries = listBoardFiles(project, target.boardId);
  if (!entries) {
    toast('That board is no longer in the project.', 'error');
    return null;
  }
  if (target.folder !== '' && !entries.some((e) => e.kind === 'folder' && e.path === target.folder)) {
    toast(`The folder ${quote(target.folder)} is gone, so nothing was imported.`, 'error');
    return null;
  }
  const taken = new Set(entries.filter((e) => (parentOf(e.path) ?? '') === target.folder).map((e) => e.name.toLowerCase()));
  const imported: string[] = [];
  let renamed = 0;
  run(() => {
    for (const item of ready) {
      const name = uniqueName(item.name, taken);
      const path = joinPath(target.folder, name);
      const result = createBoardFile(project, target.boardId, path, item.text);
      if (!result.ok) {
        skipped.push({ name: item.name, reason: `Could not import ${quote(item.name)}: ${result.error}` });
        continue;
      }
      taken.add(name.toLowerCase());
      imported.push(path);
      if (name !== item.name) renamed++;
    }
  });

  const summary = summarizeImport({ imported: imported.length, renamed, skipped });
  toast(summary.text, summary.kind);
  return imported.length > 0 ? { boardId: target.boardId, folder: target.folder, imported } : null;
}
