// shell-preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Converte {providers, defaultId} -> {list, defaultId} esperado pelo shell
const mapOut = ({ providers, defaultId }) => ({
  list: (providers || []).map(p => ({
    id: p.id,
    name: p.label,         // <— mapeia label -> name
    url: p.url,
    icon: p.icon || 'globe',
    pinned: !!p.pinned,
  })),
  defaultId
});

contextBridge.exposeInMainWorld('api', {
  // janela
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),

  // layout (altura da barra p/ BrowserView)
  setChromeHeight: (h) => ipcRenderer.invoke('chrome:setHeight', h),

  // navegação
  navGo: (url) => ipcRenderer.invoke('nav:go', url),
  onActiveUrl: (cb) => ipcRenderer.on('nav:active', (_e, url) => cb?.(url)),

  // abrir configurações em janela separada
  openSettings: (path) => ipcRenderer.invoke('settings:open', path),

  // Providers CRUD (aliases com o formato que o shell usa)
  getProviders: async () => mapOut(await ipcRenderer.invoke('providers:list')),
  addProvider: ({ name, url, icon = 'globe', pinned = false, setAsDefault = false }) =>
    ipcRenderer.invoke('providers:add', { label: name, url, icon, pinned, setAsDefault }),
  updateProvider: ({ id, name, url, icon }) =>
    ipcRenderer.invoke('providers:update', { id, label: name, url, icon }),
  removeProvider: (id) => ipcRenderer.invoke('providers:remove', id),
  setDefaultProvider: (id) => ipcRenderer.invoke('providers:setDefault', id),
  setPinned: (id, pinned) => ipcRenderer.invoke('providers:setPinned', { id, pinned }),

  // eventos
  onProvidersUpdated: (cb) =>
    ipcRenderer.on('providers:changed', (_e, data) => cb?.(mapOut(data))),
});
