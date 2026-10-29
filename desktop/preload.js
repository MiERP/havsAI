'use strict';

try {
  const { contextBridge, ipcRenderer } = require('electron');
  contextBridge.exposeInMainWorld('havsDesktop', {
    getInfo: () => ipcRenderer.invoke('havs-desktop-info'),
    notify: (payload) => ipcRenderer.invoke('havs-desktop-notify', payload)
  });
} catch {}
