'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spike', {
  getState: () => ipcRenderer.invoke('state'),
  onState: (cb) => { ipcRenderer.on('state', (_e, s) => cb(s)); },
  command: (cmd) => ipcRenderer.invoke('command', cmd),
  reportFps: (v) => ipcRenderer.send('fps', v),
});
