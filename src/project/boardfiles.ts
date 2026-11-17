// Board source files, as the file explorer and code editor use them. No DOM.
//
// API (all take the Project; boardId is a board part's `boardId`, paths
// follow the rules in paths.ts):
//   listBoards(project): BoardInfo[]                     boards in natural boardId order (uno-2 before uno-10), with labels
//   boardTree(project, boardId): BoardTree | null        a copy of the board's tree
//   listBoardFiles(project, boardId): TreeEntry[] | null files and folders, explorer order
//   readBoardFile(project, boardId, path): ReadResult
//   createBoardFile(project, boardId, path, content?): FileOpResult
//   createBoardFolder(project, boardId, path): FileOpResult
//   writeBoardFile(project, boardId, path, content): FileOpResult
//   renameBoardPath(project, boardId, from, to): FileOpResult   (folders move their contents)
//   deleteBoardPath(project, boardId, path): FileOpResult       (folders with their contents)
// User mistakes come back as { ok: false, error } with a message to show;
// nothing throws. A successful change goes through Project.checkForChanges,
// so listeners, the unsaved marker and autosave see it at once; the undo
// history records it at its next settle() (after the next rendered frame:
// the UI should request a render, or call controller.history.settle()).
// Fast repeated writes to the same board fold into one undo step.

import { boardLabel } from '../parts';
import { compareBoardIds } from './boardidparse';
import {
  createFile, createFolder, deletePath, listTree, readFile, renamePath, writeFile, copyTree,
  type BoardTree, type ReadResult, type TreeEntry, type TreeResult,
} from './filetree';
import type { Project } from './project';

export interface BoardInfo {
  boardId: string;
  partId: number;
  typeId: string;
  /** e.g. "Arduino Uno #4" (see boardLabel). */
  label: string;
}

export type FileOpResult = { ok: true } | { ok: false; error: string };

/** The boards, in a fixed order that does not depend on selection or draw order (bring-to-front). */
export function listBoards(project: Project): BoardInfo[] {
  return project.scene.parts
    .flatMap((p) => (p.boardId ? [{ boardId: p.boardId, partId: p.id, typeId: p.typeId, label: boardLabel(p) }] : []))
    .sort((a, b) => compareBoardIds(a.boardId, b.boardId));
}

function tree(project: Project, boardId: string): BoardTree | undefined {
  const files = project.scene.files;
  return Object.hasOwn(files, boardId) ? files[boardId] : undefined;
}

export function boardTree(project: Project, boardId: string): BoardTree | null {
  const t = tree(project, boardId);
  return t ? copyTree(t) : null;
}

export function listBoardFiles(project: Project, boardId: string): TreeEntry[] | null {
  const t = tree(project, boardId);
  return t ? listTree(t) : null;
}

const noBoard = (boardId: string): { ok: false; error: string } => ({ ok: false, error: `There is no board "${boardId}" in this project.` });

export function readBoardFile(project: Project, boardId: string, path: string): ReadResult {
  const t = tree(project, boardId);
  return t ? readFile(t, path) : noBoard(boardId);
}

/** Apply one tree operation to a board and tell the project. */
function change(project: Project, boardId: string, op: (t: BoardTree) => TreeResult): FileOpResult {
  const t = tree(project, boardId);
  if (!t) return noBoard(boardId);
  const result = op(t);
  if (!result.ok) return result;
  if (result.tree !== t) {
    project.scene.files[boardId] = result.tree;
    project.checkForChanges();
  }
  return { ok: true };
}

export function createBoardFile(project: Project, boardId: string, path: string, content = ''): FileOpResult {
  return change(project, boardId, (t) => createFile(t, path, content));
}

export function createBoardFolder(project: Project, boardId: string, path: string): FileOpResult {
  return change(project, boardId, (t) => createFolder(t, path));
}

export function writeBoardFile(project: Project, boardId: string, path: string, content: string): FileOpResult {
  return change(project, boardId, (t) => writeFile(t, path, content));
}

export function renameBoardPath(project: Project, boardId: string, from: string, to: string): FileOpResult {
  return change(project, boardId, (t) => renamePath(t, from, to));
}

export function deleteBoardPath(project: Project, boardId: string, path: string): FileOpResult {
  return change(project, boardId, (t) => deletePath(t, path));
}
