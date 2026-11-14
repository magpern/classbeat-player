'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spike', {
  getState: () => ipcRenderer.invoke('state'),
  onState: (cb) => { ipcRenderer.on('state', (_e, s) => cb(s)); },
  onWake: (cb) => { ipcRenderer.on('wake', () => cb()); },
  command: (cmd) => ipcRenderer.invoke('command', cmd),
  reportOverlay: (v) => ipcRenderer.send('overlay-visible', v === true),
  reportFps: (v) => ipcRenderer.send('fps', v),
});
