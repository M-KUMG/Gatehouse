'use strict';
// A project as a real folder on disk (Electron only). Pure Node, no Electron
// import, so vitest can test it. The folder holds exactly what the `.gth` zip
// holds (src/project/storage.ts):
//   gatehouse.json              the project without file contents
//   boards/<boardId>/<path>     each board's source files, as text
// Reading takes only those two things (a README or .git next to them is left
// alone and never read); writing replaces only those two things. Nothing
// outside the chosen folder is ever touched, and symlinks are never followed.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MANIFEST = 'gatehouse.json';
const BOARDS_DIR = 'boards';
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_PATH_LENGTH = 512;
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

class FolderError extends Error {}

/** A project-relative path ("boards/uno-1/main.ino") that is safe to join under a folder, or a reason why not. */
function checkRelative(rel) {
  if (typeof rel !== 'string' || rel === '' || rel.length > MAX_PATH_LENGTH) return 'bad path';
  if (rel !== MANIFEST && !rel.startsWith(`${BOARDS_DIR}/`)) return 'outside the project layout';
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') return 'bad path segment';
    if (/[\\:*?"<>|\u0000-\u001f]/.test(seg)) return 'bad character';
    if (/[. ]$/.test(seg) || DEVICE_NAME.test(seg)) return 'name not allowed on Windows';
  }
  if (rel !== MANIFEST && rel.split('/').length < 3) return 'file is not inside a board folder';
  return null;
}

/** What is in a folder, for the "is it safe to save here" question: 'empty', 'project' (has gatehouse.json) 'other', or 'new' (does not exist yet: it will be created). */
function inspectFolder(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    if (e && e.code === 'ENOENT') return 'new';
    throw new FolderError('This folder cannot be read.');
  }
  if (entries.length === 0) return 'empty';
  return entries.includes(MANIFEST) ? 'project' : 'other';
}

/** gatehouse.json and boards/** of a folder as { relative path: text }. Throws FolderError for anything wrong. */
function readFolder(dir) {
  const map = {};
  let count = 0;
  let total = 0;
  const take = (abs, rel) => {
    const st = fs.lstatSync(abs);
    if (!st.isFile()) return; // symlinks and special files are skipped
    if (st.size > MAX_FILE_BYTES) throw new FolderError(`"${rel}" is too large (over ${MAX_FILE_BYTES / 1048576} MB).`);
    if (++count > MAX_FILES) throw new FolderError(`This folder holds more than ${MAX_FILES} project files.`);
    total += st.size;
    if (total > MAX_TOTAL_BYTES) throw new FolderError('The project files are too large to open.');
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(abs));
    } catch {
      throw new FolderError(`"${rel}" is not a text file.`);
    }
    map[rel] = text;
  };
  const walk = (absDir, relDir) => {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(path.join(absDir, entry.name), rel);
      else if (entry.isFile()) {
        const problem = checkRelative(rel);
        if (problem) throw new FolderError(`"${rel}" cannot be used in a project (${problem}).`);
        take(path.join(absDir, entry.name), rel);
      }
    }
  };
  const manifest = path.join(dir, MANIFEST);
  let st;
  try {
    st = fs.lstatSync(manifest);
  } catch {
    throw new FolderError(`This folder is not a Gatehouse project (no ${MANIFEST}).`);
  }
  if (!st.isFile()) throw new FolderError(`This folder is not a Gatehouse project (no ${MANIFEST}).`);
  take(manifest, MANIFEST);
  const boards = path.join(dir, BOARDS_DIR);
  if (fs.existsSync(boards) && fs.lstatSync(boards).isDirectory()) walk(boards, BOARDS_DIR);
  return map;
}

function writeAtomic(abs, text) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, abs);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* nothing more to do */
    }
    throw e;
  }
}

/** Remove folders under `abs` that hold nothing (what deleting the last file of a board folder leaves behind). */
function pruneEmpty(abs, keep) {
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) pruneEmpty(path.join(abs, entry.name), false);
  }
  if (!keep && fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
}

/**
 * Make `dir` hold exactly `map` (gatehouse.json + boards/**). Board files are
 * written first, the manifest last (a crash in between leaves the old manifest
 * with a consistent older project), then files no longer in the project are
 * deleted. Nothing outside gatehouse.json and boards/ is touched.
 */
function writeFolder(dir, map) {
  const paths = Object.keys(map);
  if (!paths.includes(MANIFEST)) throw new FolderError('The project has no manifest to write.');
  for (const rel of paths) {
    const problem = checkRelative(rel);
    if (problem) throw new FolderError(`"${rel}" cannot be saved (${problem}).`);
    if (typeof map[rel] !== 'string') throw new FolderError(`"${rel}" is not text.`);
  }
  const root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true });
  const target = (rel) => {
    const abs = path.resolve(root, ...rel.split('/'));
    if (!abs.startsWith(root + path.sep)) throw new FolderError(`"${rel}" would leave the project folder.`);
    return abs;
  };
  // A symlinked boards/ or board folder would send the write elsewhere: refuse.
  const boards = path.join(root, BOARDS_DIR);
  if (fs.existsSync(boards) && !fs.lstatSync(boards).isDirectory()) throw new FolderError(`"${BOARDS_DIR}" in this folder is not a folder.`);
  for (const rel of paths.filter((p) => p !== MANIFEST)) writeAtomic(target(rel), map[rel]);
  writeAtomic(target(MANIFEST), map[MANIFEST]);
  if (fs.existsSync(boards)) {
    const stale = [];
    const walk = (absDir, relDir) => {
      for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
        const rel = `${relDir}/${entry.name}`;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) walk(path.join(absDir, entry.name), rel);
        else if (entry.isFile() && !Object.hasOwn(map, rel)) stale.push(path.join(absDir, entry.name));
      }
    };
    walk(boards, BOARDS_DIR);
    for (const abs of stale) fs.rmSync(abs, { force: true });
    pruneEmpty(boards, true);
  }
}

module.exports = { MANIFEST, BOARDS_DIR, FolderError, checkRelative, inspectFolder, readFolder, writeFolder };
