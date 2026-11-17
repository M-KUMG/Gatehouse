// The `.gth` file: a zip of the project folder (see storage.ts for the
// layout). Pure and DOM-free: bytes in, file map out, and back.
//
// Writing puts everything under one folder named after the project, so
// unzipping gives "<name>/gatehouse.json" and "<name>/boards/...". Reading
// accepts that, or the files at the zip root. Archives from elsewhere are
// untrusted: sizes are checked from the zip directory before anything is
// inflated, and only plain, safe, UTF-8 text paths and files are accepted.

import { strToU8, unzipSync, zipSync, type UnzipFileInfo, type Zippable } from 'fflate';
import { APP_NAME } from '../app';
import { safeBaseName } from './filename';
import { ProjectError } from './format';
import { MAX_FILE_BYTES } from './paths';
import { MANIFEST, type FileMap } from './storage';

/** Most entries in one archive (directories and junk included). */
export const MAX_ENTRIES = 5000;
/** Most bytes once everything is unpacked. */
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
/** Largest gatehouse.json (a big circuit is still far below this). */
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

/** Every entry gets this time, so the same project always gives the same bytes. */
const FIXED_TIME = new Date(1980, 0, 1, 0, 0, 0); // local time: DOS zip times have no zone

/** The project folder as `.gth` bytes, under one root folder named after the project. */
export function encodeGth(name: string, map: FileMap): Uint8Array {
  const root = safeBaseName(name);
  const entries: Zippable = {};
  for (const path of Object.keys(map).sort()) entries[`${root}/${path}`] = [strToU8(map[path]), { level: 6 }];
  return zipSync(entries, { mtime: FIXED_TIME });
}

/** True when the bytes start like a zip archive. */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) && bytes[2] + 1 === bytes[3];
}

export interface DecodedGth {
  /** The single top-level folder the files were in, when they were. */
  folder?: string;
  /** Paths relative to the project folder. */
  fileMap: FileMap;
}

function fail(message: string): never {
  throw new ProjectError(message);
}

/** Folders and files that zip tools add and that mean nothing to a project. */
function isJunk(segments: string[]): boolean {
  const last = segments[segments.length - 1];
  return segments[0] === '__MACOSX' || last === '.DS_Store' || last === 'Thumbs.db' || last === 'desktop.ini' || last.startsWith('._');
}

/** Why a zip entry name is unsafe, or null. Directory names end with "/". */
function nameError(name: string): string | null {
  const q = JSON.stringify(name.length > 60 ? `${name.slice(0, 57)}...` : name);
  if (name === '') return 'The archive has an entry with no name.';
  if (/[\u0000-\u001f\u007f]/.test(name)) return `The archive entry ${q} has control characters in its name.`;
  if (name.includes('\\')) return `The archive entry ${q} uses "\\" in its path; zip paths use "/".`;
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return `The archive entry ${q} has an absolute path.`;
  const segments = name.replace(/\/$/, '').split('/');
  if (segments.some((s) => s === '..')) return `The archive entry ${q} points outside the project folder ("..").`;
  if (segments.some((s) => s === '' || s === '.')) return `The archive entry ${q} has an empty or "." folder in its path.`;
  return null;
}

/** Entry names in the archive that are kept, checked as fflate lists them (before inflating). */
function entryFilter(kept: string[]): (info: UnzipFileInfo) => boolean {
  let count = 0;
  let total = 0;
  const seen = new Map<string, string>();
  return ({ name, size, originalSize }) => {
    if (++count > MAX_ENTRIES) fail(`The archive has more than ${MAX_ENTRIES} entries.`);
    const problem = nameError(name);
    if (problem) fail(problem);
    if (name.endsWith('/') || isJunk(name.split('/'))) return false;
    const folded = name.toLowerCase();
    const earlier = seen.get(folded);
    if (earlier !== undefined) {
      fail(earlier === name ? `The archive holds "${name}" twice.` : `The archive holds both "${earlier}" and "${name}", which differ only in case.`);
    }
    seen.set(folded, name);
    const bytes = Math.max(size, originalSize);
    const limit = name === MANIFEST || name.endsWith(`/${MANIFEST}`) ? MAX_MANIFEST_BYTES : MAX_FILE_BYTES;
    if (bytes > limit) fail(`"${name}" is ${Math.ceil(bytes / 1024)} KB; a file can be at most ${limit / 1024} KB.`);
    total += bytes;
    if (total > MAX_TOTAL_BYTES) fail(`The archive unpacks to more than ${MAX_TOTAL_BYTES / (1024 * 1024)} MB.`);
    kept.push(name);
    return true;
  };
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

function text(name: string, bytes: Uint8Array): string {
  let result: string;
  try {
    result = UTF8.decode(bytes);
  } catch {
    fail(`"${name}" is not a text file (it is not valid UTF-8).`);
  }
  if (result.includes('\u0000')) fail(`"${name}" is not a text file.`);
  return result;
}

/** The single folder holding every file, when there is no gatehouse.json at the root. */
function rootFolder(names: string[]): string | undefined {
  if (names.includes(MANIFEST)) return undefined;
  const first = names[0]?.split('/')[0];
  if (first === undefined || !names.every((n) => n.startsWith(`${first}/`))) return undefined;
  return first;
}

/** The project folder inside `.gth` bytes. Throws a ProjectError, worded for people, for anything wrong. */
export function decodeGth(bytes: Uint8Array): DecodedGth {
  if (!isZip(bytes)) fail(`This is not a ${APP_NAME} project file (it is not a .gth / zip archive).`);
  const kept: string[] = [];
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes, { filter: entryFilter(kept) });
  } catch (e) {
    if (e instanceof ProjectError) throw e;
    fail(`The archive is damaged or uses a zip feature that is not supported (${e instanceof Error ? e.message : String(e)}).`);
  }
  const folder = rootFolder(kept);
  const cut = folder === undefined ? 0 : folder.length + 1;
  const fileMap: FileMap = {};
  for (const name of kept) fileMap[name.slice(cut)] = text(name, raw[name]);
  if (!Object.hasOwn(fileMap, MANIFEST)) {
    fail(`This archive is not a ${APP_NAME} project: there is no ${MANIFEST} at its top level or in a single top-level folder.`);
  }
  return folder === undefined ? { fileMap } : { folder, fileMap };
}
