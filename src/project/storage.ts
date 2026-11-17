// A project as a folder of files. Save writes this folder as a `.gth` zip
// (gth.ts, diskfile.ts); a real-folder storage can come later. No DOM here.
//
// Folder layout (toFileMap / fromFileMap):
//   gatehouse.json            the project file without file contents, plus
//                             `boards: [{ boardId, folders }]` (empty folders
//                             cannot be stored as files, so they are listed)
//   boards/<boardId>/<path>   each board's source files, as text
// Reading back runs the same migration and validation as opening a file.

import { APP_NAME } from '../app';
import { canonical, type SourceFiles } from './filetree';
import { ProjectError, type ProjectFile } from './format';
import { readProjectDocument } from './read';

/** Project-relative path ("gatehouse.json", "boards/uno-1/main.ino") -> text. */
export type FileMap = Record<string, string>;

export const MANIFEST = 'gatehouse.json';
export const BOARDS_DIR = 'boards';

/** Where a project's files live. Async, because real folders and zips are. */
export interface ProjectStorage {
  /** Every file, as a map. */
  readAll(): Promise<FileMap>;
  /** Every file path, sorted. */
  list(): Promise<string[]>;
  /** Create or replace one file. */
  writeFile(path: string, content: string): Promise<void>;
  /** Delete one file; deleting a missing file does nothing. */
  deleteFile(path: string): Promise<void>;
}

/** A ProjectStorage in memory (tests, and a model for the real ones). */
export class MemoryStorage implements ProjectStorage {
  private readonly files = new Map<string, string>();

  constructor(initial: FileMap = {}) {
    for (const [path, text] of Object.entries(initial)) this.files.set(path, text);
  }

  async readAll(): Promise<FileMap> {
    return Object.fromEntries(this.files);
  }

  async list(): Promise<string[]> {
    return [...this.files.keys()].sort();
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }
}

/** Make `storage` hold exactly `map`: changed files are written, others deleted. */
export async function writeFileMap(storage: ProjectStorage, map: FileMap): Promise<void> {
  const before = await storage.readAll();
  for (const [path, text] of Object.entries(map)) if (before[path] !== text) await storage.writeFile(path, text);
  for (const path of Object.keys(before)) if (!Object.hasOwn(map, path)) await storage.deleteFile(path);
}

/** The project in the folder layout. */
export function toFileMap(file: ProjectFile): FileMap {
  const { files, ...rest } = file;
  const boards = Object.keys(files).map((boardId) => ({ boardId, folders: [...files[boardId].folders] }));
  const map: FileMap = { [MANIFEST]: `${JSON.stringify({ ...rest, boards }, null, 2)}
` };
  for (const { boardId } of boards) {
    for (const [path, text] of Object.entries(files[boardId].files)) map[`${BOARDS_DIR}/${boardId}/${path}`] = text;
  }
  return map;
}

function fail(message: string): never {
  throw new ProjectError(message);
}

/** A project from the folder layout; throws a ProjectError for anything wrong. */
export function fromFileMap(map: FileMap): ProjectFile {
  if (!Object.hasOwn(map, MANIFEST)) fail(`This folder is not a ${APP_NAME} project (no ${MANIFEST}).`);
  let doc: unknown;
  try {
    doc = JSON.parse(map[MANIFEST]);
  } catch {
    fail(`${MANIFEST} is not valid JSON.`);
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) fail(`${MANIFEST} must hold an object.`);
  const { boards, ...rest } = doc as Record<string, unknown>;
  if ('files' in rest) fail(`${MANIFEST} must not hold "files"; source files belong in ${BOARDS_DIR}/.`);
  const trees: Record<string, { files: Record<string, string>; folders: string[] }> = {};
  if (boards !== undefined) {
    if (!Array.isArray(boards)) fail(`"boards" in ${MANIFEST} must be a list.`);
    boards.forEach((b: unknown, i) => {
      const o = typeof b === 'object' && b !== null ? (b as Record<string, unknown>) : {};
      const { boardId, folders } = o;
      if (typeof boardId !== 'string' || !Array.isArray(folders) || folders.some((f) => typeof f !== 'string')) {
        fail(`boards[${i}] in ${MANIFEST} must be { boardId, folders }.`);
      }
      if (Object.hasOwn(trees, boardId)) fail(`Board "${boardId}" is listed twice in ${MANIFEST}.`);
      trees[boardId] = { files: {}, folders: folders as string[] };
    });
  }
  const prefix = `${BOARDS_DIR}/`;
  for (const [path, text] of Object.entries(map)) {
    if (path === MANIFEST) continue;
    if (!path.startsWith(prefix)) fail(`Unexpected file "${path}": project files belong in ${BOARDS_DIR}/<board>/.`);
    const slash = path.indexOf('/', prefix.length);
    const boardId = path.slice(prefix.length, slash < 0 ? undefined : slash);
    if (slash < 0) fail(`Unexpected file "${path}": it is not inside a board folder.`);
    if (!Object.hasOwn(trees, boardId)) fail(`"${path}" belongs to board "${boardId}", which is not a board in this project.`);
    trees[boardId].files = { ...trees[boardId].files, [path.slice(slash + 1)]: text };
  }
  const files: SourceFiles = Object.fromEntries(Object.entries(trees).map(([id, t]) => [id, canonical(t.files, t.folders)]));
  // Older manifests (no boards) are upgraded by the normal migration; v3+ ones carry their files.
  return readProjectDocument(boards === undefined ? rest : { ...rest, files });
}
