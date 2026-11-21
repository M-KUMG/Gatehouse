'use strict';
// What the setup window does to the disk: copy the app, make shortcuts, register it with Windows, and undo all of
// it. Everything the outside world offers (the file system, reg.exe, Electron's shortcut writer) is passed in
// as `deps`, so electron/installer.test.mjs runs the real logic against a temporary folder and fakes.
//
// Safety rules (this code deletes folders):
//  - the install folder is always <chosen>/Gatehouse, never a drive root or a folder with other files in it;
//  - a folder is only ever removed if it holds our marker file (install.json) and the app's exe;
//  - paths with characters that are special to cmd.exe are refused (the leftover cleanup runs through cmd).

const path = require('path');

const APP_DIR = 'Gatehouse';
const MARKER = 'install.json';
const UNINSTALL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Gatehouse';
const NSIS_UNINSTALLER = 'Uninstall Gatehouse.exe'; // what the earlier NSIS installer left behind
const UNINSTALL_EXE = 'Uninstall Gatehouse.exe'; // ours: a hard link of the app's exe that starts as the uninstaller (setupmode.cjs)
const CMD_UNSAFE = /["%&^!|<>\r\n]/;

/** %LOCALAPPDATA%\Programs\Gatehouse: where a per-user install goes (no administrator rights needed). */
function defaultInstallDir(localAppData) {
  return path.join(localAppData, 'Programs', APP_DIR);
}

/**
 * The folder an install really goes to for what the user picked: always a folder named Gatehouse (a picked
 * folder gets one made inside it). null if the choice is unusable.
 */
function resolveInstallDir(chosen) {
  if (typeof chosen !== 'string' || chosen.trim() === '' || !path.isAbsolute(chosen)) return null;
  if (CMD_UNSAFE.test(chosen)) return null;
  const clean = path.resolve(chosen);
  if (path.basename(clean).toLowerCase() === APP_DIR.toLowerCase()) return clean;
  return path.join(clean, APP_DIR);
}

/** { version } of the Gatehouse installed in `dir`, or null if there is none (no marker, or a foreign one). */
function readMarker(dir, fs) {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf8'));
    return marker && marker.app === APP_DIR && typeof marker.version === 'string' ? { version: marker.version } : null;
  } catch {
    return null;
  }
}

/** True for a folder holding an install made by the earlier NSIS installer (its uninstaller and the exe, no marker). */
function isNsisInstall(dir, exeName, fs) {
  return !readMarker(dir, fs) && fs.existsSync(path.join(dir, exeName)) && fs.existsSync(path.join(dir, NSIS_UNINSTALLER));
}

/** { version, dir } of a Gatehouse already in `dir` (version is null for an NSIS one, which does not say), or null. */
function findExisting(dir, exeName, fs) {
  const marker = readMarker(dir, fs);
  if (marker) return { version: marker.version, dir };
  return isNsisInstall(dir, exeName, fs) ? { version: null, dir } : null;
}

/** True only for a folder that is certainly our install: not a root, has the marker and the exe. */
function isRemovable(dir, exeName, fs) {
  const clean = path.resolve(dir);
  if (path.parse(clean).root === clean) return false;
  if (!readMarker(clean, fs)) return false;
  return fs.existsSync(path.join(clean, exeName));
}

/** Every file below `root` (relative paths, sizes) and the total size. Links are skipped. */
function listTree(root, fs) {
  const files = [];
  const dirs = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const next = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        dirs.push(next);
        walk(next);
      } else if (entry.isFile()) {
        files.push({ rel: next, size: fs.statSync(path.join(root, next)).size });
      }
    }
  };
  walk('');
  return { files, dirs, total: files.reduce((sum, f) => sum + f.size, 0) };
}

function copyFile(from, to, fs, onBytes) {
  return new Promise((resolve, reject) => {
    const input = fs.createReadStream(from);
    const output = fs.createWriteStream(to);
    const fail = (err) => {
      input.destroy();
      output.destroy();
      reject(err);
    };
    input.on('data', (chunk) => onBytes(chunk.length));
    input.on('error', fail);
    output.on('error', fail);
    output.on('close', resolve);
    input.pipe(output);
  });
}

/** Copies the folder `src` to `dst`, calling onProgress({ percent, file }) as bytes go over (at most every 40 ms). */
async function copyTree(src, dst, fs, onProgress, now = Date.now) {
  const { files, dirs, total } = listTree(src, fs);
  fs.mkdirSync(dst, { recursive: true });
  for (const dir of dirs) fs.mkdirSync(path.join(dst, dir), { recursive: true });
  let done = 0;
  let last = 0;
  for (const file of files) {
    const name = file.rel;
    await copyFile(path.join(src, name), path.join(dst, name), fs, (n) => {
      done += n;
      const t = now();
      if (t - last >= 40) {
        last = t;
        onProgress({ percent: total ? (done / total) * 100 : 100, file: name });
      }
    });
  }
  onProgress({ percent: 100, file: '' });
}

/**
 * Deletes every file below `dir`, then the folders. A file that cannot be deleted (in use) is left and listed in
 * `locked`; the folders that still have something in them stay too.
 */
function removeTree(dir, fs, onProgress) {
  const { files, dirs } = listTree(dir, fs);
  const locked = [];
  files.forEach((file, i) => {
    try {
      fs.unlinkSync(path.join(dir, file.rel));
    } catch {
      locked.push(file.rel);
    }
    if (onProgress) onProgress({ percent: ((i + 1) / Math.max(files.length, 1)) * 100, file: file.rel });
  });
  for (const sub of dirs.sort((a, b) => b.length - a.length)) {
    try {
      fs.rmdirSync(path.join(dir, sub));
    } catch {
      /* not empty or in use: stays */
    }
  }
  try {
    fs.rmdirSync(dir);
  } catch {
    /* still has locked files */
  }
  return { locked };
}

/** The values of the "Apps > Installed apps" entry. */
function uninstallEntries({ dir, version, exeName, sizeKb, uninstallExe }) {
  const exe = path.join(dir, exeName);
  const remover = path.join(dir, uninstallExe || exeName);
  return [
    { name: 'DisplayName', type: 'REG_SZ', value: 'Gatehouse' },
    { name: 'DisplayVersion', type: 'REG_SZ', value: version },
    { name: 'Publisher', type: 'REG_SZ', value: 'Gatehouse' },
    { name: 'InstallLocation', type: 'REG_SZ', value: dir },
    { name: 'DisplayIcon', type: 'REG_SZ', value: exe },
    { name: 'UninstallString', type: 'REG_SZ', value: `"${remover}" --uninstall` },
    { name: 'NoModify', type: 'REG_DWORD', value: 1 },
    { name: 'NoRepair', type: 'REG_DWORD', value: 1 },
    { name: 'EstimatedSize', type: 'REG_DWORD', value: sizeKb },
  ];
}

const regAddArgs = (entry) => ['add', UNINSTALL_KEY, '/v', entry.name, '/t', entry.type, '/d', String(entry.value), '/f'];
const regDeleteArgs = () => ['delete', UNINSTALL_KEY, '/f'];

/** The command that removes the folder once the uninstaller has quit (it cannot delete its own running files). */
function cleanupCommand(dir) {
  if (CMD_UNSAFE.test(dir)) return null;
  return `ping -n 4 127.0.0.1 >nul & rmdir /s /q "${dir}"`;
}

/**
 * The same cleanup as a VBScript for wscript.exe, which is a windowed program: it runs with no console window at
 * all (a detached cmd.exe shows one, and a non-detached child dies with the app). It waits for the uninstaller to
 * quit, retries for a while, then deletes itself. null for a path that is not safe to put in a script.
 */
function cleanupScript(dir) {
  if (CMD_UNSAFE.test(dir)) return null;
  return [
    'On Error Resume Next',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'For i = 1 To 20',
    '  WScript.Sleep 1000',
    `  If fso.FolderExists("${dir}") Then fso.DeleteFolder "${dir}", True`,
    `  If Not fso.FolderExists("${dir}") Then Exit For`,
    'Next',
    'fso.DeleteFile WScript.ScriptFullName, True',
    '',
  ].join('\r\n');
}

function shortcutPaths({ startMenuDir, desktopDir }) {
  return { startMenu: path.join(startMenuDir, `${APP_DIR}.lnk`), desktop: path.join(desktopDir, `${APP_DIR}.lnk`) };
}

function shortcutDetails(dir, exeName) {
  const target = path.join(dir, exeName);
  return { target, cwd: dir, icon: target, iconIndex: 0, appUserModelId: APP_DIR, description: 'Gatehouse' };
}

/**
 * Installs (or updates) the app. deps: { fs, run(file, args) -> Promise, shell: { writeShortcutLink },
 * src (folder to copy), exeName, version, startMenuDir, desktopDir }. options: { dir, startMenu, desktop }.
 * Returns { dir, exe }. Throws an Error with a message fit to show the user.
 */
async function install(deps, options, onProgress) {
  const { fs } = deps;
  const dir = resolveInstallDir(options.dir);
  if (!dir) throw new Error('That folder cannot be used. Pick another one.');
  const existed = fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
  const old = existed && isNsisInstall(dir, deps.exeName, fs);
  if (existed && !old && !isRemovable(dir, deps.exeName, fs)) {
    throw new Error('That folder already has other files in it. Pick an empty place, or a folder named Gatehouse.');
  }
  if (old) {
    // The earlier installer's own uninstaller takes its shortcuts and Windows entry away. `_?=` keeps it in place
    // and makes it finish before returning; it is deleted with the rest of the folder below.
    try {
      await deps.run(path.join(dir, NSIS_UNINSTALLER), ['/S', `_?=${dir}`]);
    } catch {
      /* it may refuse while the app is open: the files are then locked and the check below says so */
    }
  }
  if (existed) {
    const { locked } = removeTree(dir, fs);
    if (locked.length > 0) throw new Error('Gatehouse is open. Close it and try again.');
  }
  try {
    await copyTree(deps.src, dir, fs, onProgress);
    fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({ app: APP_DIR, version: deps.version }));
    const links = shortcutPaths(deps);
    const details = shortcutDetails(dir, deps.exeName);
    if (options.startMenu) deps.shell.writeShortcutLink(links.startMenu, 'create', details);
    if (options.desktop) deps.shell.writeShortcutLink(links.desktop, 'create', details);
    // "Uninstall Gatehouse.exe" next to the app: a hard link (same file, no extra disk space). If the disk
    // cannot link, the Windows entry just runs the app's exe with --uninstall.
    let uninstallExe = null;
    try {
      fs.linkSync(path.join(dir, deps.exeName), path.join(dir, UNINSTALL_EXE));
      uninstallExe = UNINSTALL_EXE;
    } catch {
      /* no link: fall back */
    }
    const sizeKb = Math.round(listTree(dir, fs).total / 1024);
    for (const entry of uninstallEntries({ dir, version: deps.version, exeName: deps.exeName, sizeKb, uninstallExe })) {
      await deps.run('reg.exe', regAddArgs(entry));
    }
  } catch (err) {
    // Take back what this run copied (the folder was empty or ours before, so everything in it is from this run).
    if (fs.existsSync(dir)) removeTree(dir, fs);
    if (err && err.code === 'EBUSY') throw new Error('Gatehouse is open. Close it and try again.');
    if (err && (err.code === 'EACCES' || err.code === 'EPERM')) throw new Error('Windows would not let setup write there. Pick another folder.');
    throw err;
  }
  return { dir, exe: path.join(dir, deps.exeName) };
}

/**
 * Removes the install that holds the running uninstaller. deps: { fs, run, shell: { readShortcutLink },
 * dir, exeName, startMenuDir, desktopDir, userDataDir (or null to keep settings) }.
 * Returns { dir, locked, cleanup } where cleanup is the command to run after quitting (or null).
 */
async function uninstall(deps, onProgress) {
  const { fs, dir } = deps;
  if (!isRemovable(dir, deps.exeName, fs)) throw new Error('This does not look like a Gatehouse install, so nothing was removed.');
  const exe = path.join(dir, deps.exeName);
  const links = shortcutPaths(deps);
  for (const link of [links.startMenu, links.desktop]) {
    try {
      const target = deps.shell.readShortcutLink(link).target;
      if (target && path.resolve(target).toLowerCase() === exe.toLowerCase()) fs.unlinkSync(link);
    } catch {
      /* no such shortcut, or not ours */
    }
  }
  try {
    await deps.run('reg.exe', regDeleteArgs());
  } catch {
    /* the entry was not there */
  }
  if (deps.userDataDir && path.basename(deps.userDataDir).toLowerCase() === APP_DIR.toLowerCase()) {
    fs.rmSync(deps.userDataDir, { recursive: true, force: true });
  }
  const { locked } = removeTree(dir, fs, onProgress);
  return { dir, locked, cleanup: locked.length > 0 || fs.existsSync(dir) ? cleanupCommand(dir) : null };
}

module.exports = {
  APP_DIR,
  UNINSTALL_EXE,
  MARKER,
  UNINSTALL_KEY,
  defaultInstallDir,
  resolveInstallDir,
  readMarker,
  isNsisInstall,
  findExisting,
  isRemovable,
  listTree,
  copyTree,
  removeTree,
  uninstallEntries,
  regAddArgs,
  regDeleteArgs,
  cleanupCommand,
  cleanupScript,
  shortcutPaths,
  install,
  uninstall,
};
