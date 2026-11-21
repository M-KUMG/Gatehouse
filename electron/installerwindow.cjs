'use strict';
// The installer / uninstaller window: a frameless transparent window that shows electron/installer/index.html and
// runs the disk work of electron/installer.cjs for it. Used by main.js when electron/setupmode.cjs says this start
// of the exe is not the app.

// Electron's own `fs` treats app.asar as a folder; setup must copy it as the one file it is, so it uses original-fs
// (plain node, as in the tests, has no such module and its fs is already plain).
let fs;
try {
  fs = require('original-fs');
} catch {
  fs = require('fs');
}
const path = require('path');
const { spawn } = require('child_process');
const I = require('./installer.cjs');
const { appEnv } = require('./setupmode.cjs');

const CH = {
  info: 'gatehouse:setup:info',
  chooseDir: 'gatehouse:setup:choose-dir',
  run: 'gatehouse:setup:run',
  progress: 'gatehouse:setup:progress',
  launch: 'gatehouse:setup:launch',
  minimize: 'gatehouse:setup:minimize',
  close: 'gatehouse:setup:close',
};

/** Starts reg.exe (or anything else) with an argument list, no shell. Resolves on exit code 0. */
function runProgram(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${file} exited with ${code}`))));
  });
}

/**
 * electron: the `electron` module. mode: 'install' | 'uninstall'. realUserData: the app's own settings folder
 * (main.js moved the real userData path away so setup leaves no files in it).
 */
function startSetup({ electron, mode, realUserData }) {
  const { app, BrowserWindow, dialog, ipcMain, shell } = electron;
  // The app's exe: when this is the uninstaller started as "Uninstall Gatehouse.exe", that is the other name of the same file.
  const exeName = mode === 'uninstall' ? 'Gatehouse.exe' : path.basename(process.execPath);
  const ownDir = path.dirname(process.execPath); // install mode: the unpacked app to copy; uninstall mode: the install itself
  const version = app.getVersion();
  const startMenuDir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const desktopDir = app.getPath('desktop');
  const defaultDir = I.defaultInstallDir(process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'));

  const win = new BrowserWindow({
    width: 824,
    height: 524,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    hasShadow: false, // the page draws its own shadow
    backgroundColor: '#00000000',
    title: mode === 'uninstall' ? 'Remove Gatehouse' : 'Gatehouse Setup',
    icon: fs.existsSync(path.join(__dirname, '..', 'dist', 'icon.png')) ? path.join(__dirname, '..', 'dist', 'icon.png') : undefined,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'installer-preload.cjs') },
  });
  win.once('ready-to-show', () => win.show());
  setTimeout(() => !win.isDestroyed() && !win.isVisible() && win.show(), 4000);
  win.loadFile(path.join(__dirname, 'installer', 'index.html'));

  let cleanup = null;
  let busy = false;
  let launched = null; // the exe to open after a finished install
  const mine = (event) => event.sender === win.webContents;
  const handlers = [];
  const on = (channel, fn) => {
    const listener = (event, ...args) => (mine(event) ? fn(event, ...args) : undefined);
    ipcMain.on(channel, listener);
    handlers.push(['on', channel, listener]);
  };
  const handle = (channel, fn) => {
    ipcMain.handle(channel, (event, ...args) => (mine(event) ? fn(event, ...args) : { error: 'Not allowed.' }));
    handlers.push(['handle', channel]);
  };

  const existing = () => {
    const dir = I.resolveInstallDir(defaultDir);
    return dir ? I.findExisting(dir, exeName, fs) : null;
  };

  handle(CH.info, () => {
    if (mode === 'uninstall') return { mode, version, dir: ownDir, existing: null };
    const old = existing();
    return { mode, version, dir: old ? old.dir : defaultDir, existing: old };
  });

  handle(CH.chooseDir, async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Choose where to install Gatehouse', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    const dir = I.resolveInstallDir(result.filePaths[0]);
    return dir ? { dir } : { cancelled: true };
  });

  handle(CH.run, async (_event, options) => {
    if (busy) return { error: 'Setup is already working.' };
    busy = true;
    const send = (p) => !win.isDestroyed() && win.webContents.send(CH.progress, p);
    try {
      const common = { fs, run: runProgram, exeName, startMenuDir, desktopDir };
      if (mode === 'uninstall') {
        const real = realUserData && options && options.deleteData ? realUserData : null;
        const out = await I.uninstall({ ...common, shell, dir: ownDir, userDataDir: real }, send);
        cleanup = out.cleanup;
        send({ percent: 100, file: '' });
      } else {
        const old = existing();
        const chosen = old ? old.dir : options && options.dir;
        const out = await I.install(
          { ...common, shell, src: ownDir, version },
          { dir: chosen, startMenu: !!(options && options.startMenu), desktop: !!(options && options.desktop) },
          send,
        );
        launched = out.exe;
      }
      return { ok: true };
    } catch (err) {
      return { error: (err && err.message) || 'Something went wrong.' };
    } finally {
      busy = false;
    }
  });

  on(CH.launch, () => {
    if (!launched) return;
    // Without the installer markers in its environment, or the new app would start as an installer too.
    spawn(launched, [], { detached: true, stdio: 'ignore', env: appEnv(process.env), cwd: path.dirname(launched) }).unref();
    win.close();
  });
  on(CH.minimize, () => win.minimize());
  on(CH.close, () => win.close());

  win.on('closed', () => {
    for (const [kind, channel, listener] of handlers) {
      if (kind === 'on') ipcMain.removeListener(channel, listener);
      else ipcMain.removeHandler(channel);
    }
    // The uninstaller cannot delete its own running files: a helper finishes the job after it quit. It has to be
    // detached (a plain child dies with the app) and must show no console: wscript.exe is a windowed program, so a
    // small script in the temp folder does it quietly. If that cannot start, a hidden cmd.exe does the same.
    if (cleanup) {
      const temp = app.getPath('temp');
      const script = I.cleanupScript(ownDir);
      const viaCmd = () =>
        spawn('cmd.exe', ['/d', '/s', '/c', `"${cleanup}"`], { cwd: temp, detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
      try {
        if (!script) throw new Error('unsafe path');
        const file = path.join(temp, `gatehouse-cleanup-${process.pid}.vbs`);
        fs.writeFileSync(file, script);
        const wscript = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
        const child = spawn(wscript, ['//B', '//Nologo', file], { cwd: temp, detached: true, stdio: 'ignore' });
        child.on('error', viaCmd);
        child.unref();
      } catch {
        viaCmd();
      }
    }
  });
  return win;
}

module.exports = { startSetup, CHANNEL: CH };
