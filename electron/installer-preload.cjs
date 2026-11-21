'use strict';
// Gives the setup page `window.gatehouseSetup` (see electron/installer/setup.js for what each call answers).
// A sandboxed preload cannot require our own files, so the channel names are written out here;
// electron/installerwindow.test.mjs checks they equal the ones in installerwindow.cjs.

const { contextBridge, ipcRenderer } = require('electron');

const CH = {
  info: 'gatehouse:setup:info',
  chooseDir: 'gatehouse:setup:choose-dir',
  run: 'gatehouse:setup:run',
  progress: 'gatehouse:setup:progress',
  launch: 'gatehouse:setup:launch',
  minimize: 'gatehouse:setup:minimize',
  close: 'gatehouse:setup:close',
};

contextBridge.exposeInMainWorld('gatehouseSetup', {
  info: () => ipcRenderer.invoke(CH.info),
  chooseDir: () => ipcRenderer.invoke(CH.chooseDir),
  run: (options) => ipcRenderer.invoke(CH.run, options),
  onProgress: (callback) => {
    ipcRenderer.removeAllListeners(CH.progress);
    ipcRenderer.on(CH.progress, (_event, progress) => callback(progress));
  },
  launch: () => ipcRenderer.send(CH.launch),
  minimize: () => ipcRenderer.send(CH.minimize),
  close: () => ipcRenderer.send(CH.close),
});
