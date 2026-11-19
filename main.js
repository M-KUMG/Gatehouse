const { app, BrowserWindow, protocol } = require('electron');
const fs = require('fs');
const path = require('path');
const { SCHEME, ORIGIN, createHandler, isAppUrl } = require('./electron/staticserve.cjs');

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
 *    <resources>/toolchain-packs/ if it exists. Packaging (copying the packs there)
 *    is a later task: today only this lookup exists. If the folder is missing the
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

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(`${ORIGIN}/index.html`);
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, createHandler(serveRoots));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
