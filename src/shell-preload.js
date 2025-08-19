const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  navGo: (url) => ipcRenderer.invoke('nav:go', url),
  onActiveUrl: (cb) => ipcRenderer.on('nav:active', (_e, url) => cb(url)),
});
