// Strict checks on the board side of a project document: boardIds, the
// source trees in `files` and `boardCounters`. Throws a ProjectError that
// says what is wrong and where (see validate.ts for the rest).

import type { PlacedPart } from '../model';
import { isBoardType, parseBoardId, sortedCounters, type BoardCounters } from './boardid';
import { canonical, treeError, type BoardTree, type SourceFiles } from './filetree';
import { ProjectError } from './format';

type Obj = Record<string, unknown>;

function fail(message: string): never {
  throw new ProjectError(message);
}

function obj(v: unknown, where: string): Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : fail(`${where} must be an object.`);
}

/** A part's `boardId` field (`o` is the raw part): required on boards, not allowed elsewhere. */
export function partBoardId(o: Obj, typeId: string, where: string): string | undefined {
  const board = isBoardType(typeId);
  if (o.boardId === undefined) {
    if (board) fail(`${where} is a board but has no "boardId".`);
    return undefined;
  }
  if (!board) fail(`${where} has a "boardId", but a ${typeId} part is not a board.`);
  const id = o.boardId;
  if (typeof id !== 'string' || !parseBoardId(id)) {
    fail(`${where}.boardId must look like "uno-1" (lower-case letters or digits, "-", a number); got ${JSON.stringify(id)}.`);
  }
  return id;
}

/** One board's tree: { files: { path: text }, folders: [path] }, checked by the same rules as editing. */
export function boardTree(v: unknown, where: string): BoardTree {
  const o = obj(v, where);
  for (const key of Object.keys(o)) if (key !== 'files' && key !== 'folders') fail(`${where} has an unknown field "${key}".`);
  const files = obj(o.files, `${where}.files`);
  for (const [path, text] of Object.entries(files)) {
    if (typeof text !== 'string') fail(`${where}.files[${JSON.stringify(path)}] must be text.`);
  }
  if (!Array.isArray(o.folders)) fail(`${where}.folders must be a list.`);
  for (const path of o.folders) if (typeof path !== 'string') fail(`${where}.folders must only hold text.`);
  const folders = o.folders as string[];
  if (new Set(folders).size !== folders.length) fail(`${where}.folders lists a folder twice.`);
  const tree = canonical(files as Record<string, string>, folders);
  const bad = treeError(tree);
  if (bad) fail(`${where}: ${bad}`);
  return tree;
}

/**
 * `files` and `boardCounters` against the (already checked) parts: every
 * boardId unique, one tree per board and none for anything else.
 */
export function boardsAndFiles(parts: readonly PlacedPart[], filesRaw: unknown, countersRaw: unknown): { files: SourceFiles; boardCounters: BoardCounters } {
  const owners = new Map<string, number>();
  parts.forEach((p, i) => {
    if (!p.boardId) return;
    const other = owners.get(p.boardId);
    if (other !== undefined) fail(`parts[${i}].boardId "${p.boardId}" is also used by parts[${other}]; each board needs its own.`);
    owners.set(p.boardId, i);
  });
  const raw = obj(filesRaw, '"files"');
  for (const id of Object.keys(raw)) {
    if (!owners.has(id)) fail(`"files" has files for board "${id}", which is not a board in this project.`);
  }
  const files: SourceFiles = {};
  for (const [id, i] of owners) {
    if (!Object.hasOwn(raw, id)) fail(`parts[${i}] (board "${id}") has no entry in "files".`);
    files[id] = boardTree(raw[id], `files["${id}"]`);
  }
  const counters = obj(countersRaw, '"boardCounters"');
  for (const [slug, n] of Object.entries(counters)) {
    if (!/^[a-z0-9]+$/.test(slug)) fail(`"boardCounters" has an invalid key ${JSON.stringify(slug)}.`);
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) fail(`boardCounters.${slug} must be a whole number of 0 or more.`);
  }
  return { files, boardCounters: sortedCounters(counters as BoardCounters) };
}
