// settings-preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  list:        () => ipcRenderer.invoke('providers:list'),
  onChanged:   (cb) => ipcRenderer.on('providers:changed', (_e, data) => cb?.(data)),
  add:         (payload) => ipcRenderer.invoke('providers:add', payload),
  remove:      (id) => ipcRenderer.invoke('providers:remove', id),
  update:      (payload) => ipcRenderer.invoke('providers:update', payload),
  setPinned:   (id, pinned) => ipcRenderer.invoke('providers:setPinned', { id, pinned }),
  setDefault:  (id) => ipcRenderer.invoke('providers:setDefault', id),
  open:        (id) => ipcRenderer.invoke('providers:open', id),

  // NOVO: fechar settings (voltar ao conteúdo)
  closeSettings: () => ipcRenderer.invoke('settings:show', false),
});
