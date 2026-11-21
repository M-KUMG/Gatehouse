const { app, BrowserWindow, dialog, ipcMain, protocol, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { SCHEME, ORIGIN, createHandler, isAppUrl } = require('./electron/staticserve.cjs');
const W = require('./electron/windowstate.cjs');
const { registerFolderIpc } = require('./electron/folderipc.cjs');
const { CHANNEL: CLOSE, createCloseFlow } = require('./electron/closeflow.cjs');
const { detectMode } = require('./electron/setupmode.cjs');
const { startSetup } = require('./electron/installerwindow.cjs');

const SETUP_MODE = detectMode(process.argv, process.env, process.execPath); // 'install' | 'uninstall' | null (the app)
const realUserData = app.getPath('userData'); // read before setup mode moves it

// The product name for the window (src/app.ts holds the same name for the page; this file cannot import TypeScript).
const APP_NAME = 'Gatehouse';
// The page's base colour (see glass.css). The window shows it at once, so there is no white flash while the app loads.
const BACKGROUND = '#090b11';

if (process.platform === 'win32') app.setAppUserModelId(APP_NAME); // taskbar grouping and icon

// The app is served from gatehouse://app/ instead of file://, so fetch, module
// Workers and Cache Storage behave as on a web page (the browser compiler needs
// them). This must run before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

/**
 * The two folders gatehouse://app/ serves (nothing else is reachable):
 *  - the built app: dist/ next to this file;
 *  - the compiler packs at /toolchain-packs/: in development toolchain/packs/ at
 *    the repo root (npm run toolchain:fetch + toolchain:packs); in a packaged app
 *    <resources>/toolchain-packs/ (electron-builder copies the packs there, see the
 *    "build" field of package.json, `npm run dist`). If the folder is missing the
 *    packs answer 404 and the compiler reports 'unavailable'.
 */
function serveRoots() {
  const appRoot = path.join(__dirname, 'dist');
  if (!app.isPackaged) return { appRoot, packsRoot: path.join(__dirname, 'toolchain', 'packs') };
  const packed = path.join(process.resourcesPath, 'toolchain-packs');
  return { appRoot, packsRoot: fs.existsSync(packed) ? packed : null };
}

// Every web contents (also any created later) may only show this app: no new
// windows, no navigation or redirect to another origin.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const onlyApp = (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  };
  contents.on('will-navigate', onlyApp);
  contents.on('will-redirect', onlyApp);
});

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

/** The app icon next to the built page, if it is there (a missing icon just means the default one). */
function iconPath() {
  const icon = path.join(__dirname, 'dist', 'icon.png');
  return fs.existsSync(icon) ? icon : undefined;
}

/** Usable area of every screen, the primary one first. */
function workAreas() {
  const primary = screen.getPrimaryDisplay();
  return [primary.workArea, ...screen.getAllDisplays().filter((d) => d.id !== primary.id).map((d) => d.workArea)];
}

function createWindow() {
  const saved = W.loadState(stateFile(), fs);
  const bounds = W.sanitizeBounds(saved.bounds, workAreas());
  const win = new BrowserWindow({
    ...bounds,
    minWidth: W.MIN_SIZE.width,
    minHeight: W.MIN_SIZE.height,
    title: APP_NAME,
    icon: iconPath(),
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true, // the menu (reload, developer tools) is one Alt press away
    show: false, // shown once the first frame is ready, never a blank window
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'electron', 'preload.cjs') },
  });

  win.once('ready-to-show', () => {
    if (saved.maximized) win.maximize();
    win.show();
  });
  // If the page never gets ready (a load error), show the window anyway so the user is not left with nothing.
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 5000);

  const remember = () => W.saveState(stateFile(), { bounds: win.getNormalBounds(), maximized: win.isMaximized() }, fs);

  // The page cannot cancel closing in Electron, so a close with unsaved changes is blocked here and the page is
  // asked: it shows its own "Save changes?" popup (Save / Don't save / Cancel) and answers (electron/closeflow.cjs).
  // The page marks unsaved changes with a dot in front of its title (controller.ts), which is all this needs to
  // know. If the page does not answer in time, the plain system dialog below asks instead.
  let closeConfirmed = false;
  const forceClose = () => {
    if (win.isDestroyed()) return;
    closeConfirmed = true;
    win.close();
  };
  const systemDialog = () => {
    const name = W.projectNameFromTitle(win.getTitle()) || 'This project';
    dialog
      .showMessageBox(win, {
        type: 'warning',
        title: 'Unsaved changes',
        message: `"${name}" has changes that are not saved.`,
        detail: 'Close anyway? Save the project first with Ctrl+S to keep them.',
        buttons: ['Cancel', 'Close without saving'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 1) forceClose();
      });
  };
  const closeFlow = createCloseFlow({
    send: () => win.webContents.send(CLOSE.request),
    fallback: systemDialog,
    forceClose,
  });
  const fromThisPage = (event) => event.sender === win.webContents;
  const onAck = (event) => fromThisPage(event) && closeFlow.ack();
  const onAnswer = (event, action) => fromThisPage(event) && closeFlow.answer(action);
  ipcMain.on(CLOSE.ack, onAck);
  ipcMain.on(CLOSE.answer, onAnswer);
  win.on('closed', () => {
    ipcMain.removeListener(CLOSE.ack, onAck);
    ipcMain.removeListener(CLOSE.answer, onAnswer);
  });
  win.on('close', (event) => {
    remember();
    if (closeConfirmed || !W.isDirtyTitle(win.getTitle())) return;
    event.preventDefault();
    closeFlow.request();
  });

  win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

// The same exe is also the installer and the uninstaller (electron/setupmode.cjs says which start this is). Those
// modes show their own window and nothing of the app; their Chromium files go to a temp folder, so setup leaves
// nothing in the app's real settings folder.
if (SETUP_MODE) {
  app.setPath('userData', path.join(app.getPath('temp'), 'gatehouse-setup'));
  app.whenReady().then(() => startSetup({ electron: require('electron'), mode: SETUP_MODE, realUserData }));
} else if (!app.requestSingleInstanceLock()) {
  // One window of the app at a time: a second start focuses the first (two copies would fight over the
  // browser-side autosave of the project).
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    protocol.handle(SCHEME, createHandler(serveRoots));
    registerFolderIpc(ipcMain, dialog, isAppUrl, (event) => BrowserWindow.fromWebContents(event.sender), {
      defaultParent: app.getPath('documents'),
      stateFile: path.join(app.getPath('userData'), 'project-folder.json'),
    });
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
