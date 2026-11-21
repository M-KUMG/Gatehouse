'use strict';
// The page's way to project folders (electron/projectfolder.cjs), as IPC
// handlers. The page never names a path of its own: a folder becomes usable
// only after the user picked it in a native dialog here (or, for a new project,
// named it inside a folder they picked), and read / write refuse any other
// path. Requests from anything but the app's own pages are refused. Failures
// come back as { error } (never a thrown error across IPC).
//
// Opening: a native "pick a folder" dialog ('open'). Saving as: the page shows
// its own "Save project" popup (name + location); the Browse button there is
// the same native dialog in 'parent' mode, and `create` joins parent + name.

const fs = require('node:fs');
const path = require('node:path');
const F = require('./projectfolder.cjs');

const CHANNEL = {
  pick: 'gatehouse:project-folder:pick',
  home: 'gatehouse:project-folder:home',
  create: 'gatehouse:project-folder:create',
  read: 'gatehouse:project-folder:read',
  write: 'gatehouse:project-folder:write',
};

const MAX_NAME = 100;
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

/** Why `name` cannot be a project folder name, or null when it can. */
function checkFolderName(name) {
  if (typeof name !== 'string') return 'The name is missing.';
  const n = name.trim();
  if (n === '') return 'Give the project a name.';
  if (n.length > MAX_NAME) return `The name is longer than ${MAX_NAME} characters.`;
  if (n === '.' || n === '..' || /[\\/:*?"<>|\u0000-\u001f]/.test(n)) return 'The name cannot contain \\ / : * ? " < > |';
  if (/[. ]$/.test(n) || DEVICE_NAME.test(n)) return 'That name is not allowed on Windows.';
  return null;
}

function describe(e) {
  return e instanceof F.FolderError ? e.message : `The folder could not be used (${e && e.code ? e.code : 'unexpected error'}).`;
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @param ipcMain   Electron's ipcMain
 * @param dialog    Electron's dialog
 * @param isAppUrl  true for the app's own origin
 * @param windowOf  (event) -> the BrowserWindow the request came from
 * @param options   { defaultParent: where a new project goes at first (Documents), stateFile: json file remembering the last one }
 */
function registerFolderIpc(ipcMain, dialog, isAppUrl, windowOf, options) {
  const { defaultParent, stateFile } = options;
  /** Project folders the user picked or created in this run. */
  const allowed = new Set();
  /** Folders new projects may be created in: picked with Browse, or the remembered one. */
  const parents = new Set();
  const fromApp = (event) => Boolean(event.senderFrame && isAppUrl(event.senderFrame.url));
  const known = (dir) => typeof dir === 'string' && allowed.has(dir);

  const rememberedParent = () => {
    try {
      const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (saved && typeof saved.parent === 'string' && isDirectory(saved.parent)) return saved.parent;
    } catch {
      /* nothing remembered yet */
    }
    return null;
  };
  const remember = (parent) => {
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify({ parent }), 'utf8');
    } catch {
      /* a failed write only means the next start offers Documents */
    }
  };

  ipcMain.handle(CHANNEL.pick, async (event, mode) => {
    if (!fromApp(event) || (mode !== 'open' && mode !== 'parent')) return { error: 'Refused.' };
    const result = await dialog.showOpenDialog(windowOf(event), {
      title: mode === 'open' ? 'Open project folder' : 'Choose where to save the project',
      buttonLabel: mode === 'open' ? 'Open' : 'Choose',
      properties: mode === 'open' ? ['openDirectory'] : ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    const dir = path.resolve(result.filePaths[0]);
    if (mode === 'parent') {
      parents.add(dir);
      remember(dir);
      return { dir, name: path.basename(dir) || dir };
    }
    try {
      const kind = F.inspectFolder(dir);
      allowed.add(dir);
      return { dir, name: path.basename(dir), kind };
    } catch (e) {
      return { error: describe(e) };
    }
  });

  // Where a new project is offered first: the folder used last time, else Documents.
  ipcMain.handle(CHANNEL.home, (event) => {
    if (!fromApp(event)) return { error: 'Refused.' };
    const dir = path.resolve(rememberedParent() || defaultParent);
    parents.add(dir);
    return { dir };
  });

  // <parent>/<name> for a new project; nothing is created until the project is written.
  ipcMain.handle(CHANNEL.create, (event, parent, name) => {
    if (!fromApp(event) || typeof parent !== 'string' || !parents.has(parent)) return { error: 'Refused.' };
    const problem = checkFolderName(name);
    if (problem) return { error: problem };
    const dir = path.join(parent, name.trim());
    try {
      const kind = F.inspectFolder(dir);
      allowed.add(dir);
      remember(parent);
      return { dir, name: name.trim(), kind };
    } catch (e) {
      return { error: describe(e) };
    }
  });

  ipcMain.handle(CHANNEL.read, (event, dir) => {
    if (!fromApp(event) || !known(dir)) return { error: 'Refused.' };
    try {
      return { map: F.readFolder(dir) };
    } catch (e) {
      return { error: describe(e) };
    }
  });

  ipcMain.handle(CHANNEL.write, (event, dir, map) => {
    if (!fromApp(event) || !known(dir)) return { error: 'Refused.' };
    if (typeof map !== 'object' || map === null || Array.isArray(map)) return { error: 'Refused.' };
    try {
      F.writeFolder(dir, map);
      return {};
    } catch (e) {
      return { error: describe(e) };
    }
  });
}

module.exports = { CHANNEL, checkFolderName, registerFolderIpc };
