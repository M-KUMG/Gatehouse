'use strict';
// Exposes the project-folder commands to the page as `window.gatehouseHost`
// (only the Electron app has it, so the page offers folder saving there and
// nowhere else). The page gets a few functions and no Node or Electron access.

const { contextBridge, ipcRenderer } = require('electron');

// A sandboxed preload cannot require our own files, so the channel names are written
// out here; electron/folderipc.test.mjs checks they equal the ones in folderipc.cjs.
const CHANNEL = {
  pick: 'gatehouse:project-folder:pick',
  home: 'gatehouse:project-folder:home',
  create: 'gatehouse:project-folder:create',
  read: 'gatehouse:project-folder:read',
  write: 'gatehouse:project-folder:write',
};

const CLOSE = {
  request: 'gatehouse:close:request',
  ack: 'gatehouse:close:ack',
  answer: 'gatehouse:close:answer',
};

contextBridge.exposeInMainWorld('gatehouseHost', {
  /** The window is being closed with unsaved changes: `callback` shows the page's "Save changes?" popup and then calls answerClose. */
  onCloseRequest: (callback) => {
    ipcRenderer.on(CLOSE.request, () => {
      ipcRenderer.send(CLOSE.ack); // tells main the page is on it, so the system dialog is not shown
      callback();
    });
  },
  /** 'close' closes the window now; anything else keeps it open. */
  answerClose: (action) => ipcRenderer.send(CLOSE.answer, action === 'close' ? 'close' : 'stay'),
  /**
   * Native folder dialog. 'open': an existing project folder -> { dir, name, kind };
   * 'parent': the folder a new project goes in (Browse in the Save popup) -> { dir, name };
   * either may answer { cancelled } or { error }.
   */
  pickProjectFolder: (mode) => ipcRenderer.invoke(CHANNEL.pick, mode),
  /** Where the Save popup starts: the folder used last time, else Documents. -> { dir } */
  defaultProjectParent: () => ipcRenderer.invoke(CHANNEL.home),
  /** <parent>/<name> for a new project (parent from the two above). -> { dir, name, kind } | { error } */
  createProjectFolder: (parent, name) => ipcRenderer.invoke(CHANNEL.create, parent, name),
  /** -> { map } | { error } */
  readProjectFolder: (dir) => ipcRenderer.invoke(CHANNEL.read, dir),
  /** -> {} | { error } */
  writeProjectFolder: (dir, map) => ipcRenderer.invoke(CHANNEL.write, dir, map),
});
