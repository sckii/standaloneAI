// main.js
const { app, BrowserWindow, BrowserView, globalShortcut, ipcMain, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');

// ------------ Store & helpers ------------
const store = new Store({
  name: 'settings',
  defaults: {
    providers: [
      { id: 'gpt',  label: 'GPT',        url: 'https://chat.openai.com/', icon: '', pinned: true },
      { id: 'claude', label: 'Claude',   url: 'https://claude.ai/', icon: '', pinned: true },
      { id: 'gemini',   label: 'Gemini', url: 'https://gemini.google.com/', icon: '', pinned: true },
    ],
    defaultProviderId: 'gpt'
  }
});

function validateUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

// IMPORTANTE: usar "function" para hoisting seguro
function getProviders(){ return store.get('providers'); }
function setProviders(list){ store.set('providers', list); notifyProvidersChanged(); }
function getDefaultId(){ return store.get('defaultProviderId'); }
function setDefaultId(id){ store.set('defaultProviderId', id); notifyProvidersChanged(); }
function validateUrl(u){ try{ const x=new URL(u); return x.protocol==='https:'||x.protocol==='http:'; } catch { return false; } }
function findProvider(id){ return getProviders().find(p=>p.id===id); }

// ------------ Globals ------------
let win;          // janela do shell (titlebar + tabs)
let view;         // BrowserView com o site remoto
let settingsWin;  // janela das Configurações
let CHROME_HEIGHT = 48; // altura da barra (atualizada pelo shell via IPC)

// ------------ Criação das janelas ------------
function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 700,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'shell-preload.js')
    }
  });

  // Shell com titlebar/tabs (HTML local)
  win.loadFile(path.join(__dirname, 'shell.html'));

  // BrowserView com conteúdo remoto
  view = new BrowserView({
    webPreferences: { contextIsolation: true }
  });
  win.setBrowserView(view);

  // Carrega provedor padrão
  const providers = getProviders();
  let def = findProvider(getDefaultId());
  if (!def) { def = providers[0]; setDefaultId(def.id); }
  view.webContents.loadURL(def.url);

  // Dimensiona o BrowserView abaixo da barra
  const setBounds = () => {
    const [w, h] = win.getContentSize();
    view.setBounds({
      x: 0,
      y: Math.round(CHROME_HEIGHT),
      width: w,
      height: Math.max(0, h - Math.round(CHROME_HEIGHT))
    });
  };
  setBounds();
  win.on('resize', setBounds);

  // Eventos de navegação (para pintar aba ativa no shell)
  const notifyActive = (_e, url) => win.webContents.send('nav:active', url);
  view.webContents.on('did-navigate', notifyActive);
  view.webContents.on('did-navigate-in-page', notifyActive);

  // Links target=_blank abrem no navegador padrão
  view.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Envia lista inicial de provedores para o shell
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('providers:init', { providers: getProviders(), defaultId: getDefaultId() });
  });
}

function openSettingsWindow(filePath) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }

  settingsWin = new BrowserWindow({
    width: 900,
    height: 620,
    show: true,
    resizable: true,
    autoHideMenuBar: true,
    frame: true, // mude para frameless se quiser mesma titlebar do shell
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'settings/settings-preload.js')
    },
  });

  const defaultFile = path.join(__dirname, 'src/settings', 'index.html');
  const target = filePath ? path.resolve(__dirname, filePath) : defaultFile;

  settingsWin.loadFile(target);
  settingsWin.on('closed', () => (settingsWin = null));

  // Opcional: enviar estado inicial ao abrir
  settingsWin.webContents.on('did-finish-load', () => {
    settingsWin?.webContents.send('providers:changed', { providers: getProviders(), defaultId: getDefaultId() });
  });
}

// Emite atualização para shell e settings
function notifyProvidersChanged() {
  const payload = { providers: getProviders(), defaultId: getDefaultId() };
  if (win && !win.isDestroyed()) win.webContents.send('providers:changed', payload);
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('providers:changed', payload);
}

// ------------ Atalho global (toggle janela) ------------
function toggleWindow() {
  if (!win) return;
  if (win.isMinimized()) { win.restore(); win.show(); win.focus(); }
  else if (win.isVisible()) { win.minimize(); }
  else { win.show(); win.focus(); }
}

app.whenReady().then(() => {
  createWindow();
  globalShortcut.register('Control+Space', toggleWindow);
});

// ------------ IPC: janela e layout ------------
ipcMain.handle('window:minimize', () => win?.minimize());
ipcMain.handle('window:close', () => win?.close());
ipcMain.handle('window:toggleMaximize', () => win?.isMaximized() ? win.unmaximize() : win.maximize());
ipcMain.handle('chrome:setHeight', (_e, h) => {
  if (typeof h === 'number' && h > 0) {
    CHROME_HEIGHT = h;
    if (win && view) {
      const [w, hh] = win.getContentSize();
      view.setBounds({ x: 0, y: Math.round(h), width: w, height: Math.max(0, hh - Math.round(h)) });
    }
  }
});

// ------------ IPC: navegação ------------
ipcMain.handle('nav:go', (_evt, url) => {
  if (view && typeof url === 'string' && validateUrl(url)) {
    view.webContents.loadURL(url);
  }
});

// ------------ IPC: abrir janela de Configurações ------------
ipcMain.handle('settings:open', (_evt, optionalPath) => {
  openSettingsWindow(optionalPath);
  return { ok: true };
});

// ------------ IPC: Providers CRUD ------------
ipcMain.handle('providers:list', () => ({ providers: getProviders(), defaultId: getDefaultId() }));

ipcMain.handle('providers:get', () => ({
  providers: getProviders(),
  defaultId: getDefaultId(),
}));

ipcMain.handle('providers:setDefault', (_e, id) => {
  const p = findProvider(id);
  if (!p) return { ok: false, error: 'not_found' };
  setDefaultId(id);
  // opcional: navega para o default ao trocar
  view?.webContents.loadURL(p.url);
  return { ok: true };
});

ipcMain.handle('providers:open', (_e, id) => {
  const p = findProvider(id);
  if (!p) return { ok: false, error: 'not_found' };
  view?.webContents.loadURL(p.url);
  return { ok: true };
});

ipcMain.handle('providers:add', (_e, payload) => {
  const { label, url, icon = '', pinned = false, setAsDefault = false } = payload || {};
  if (!label || !validateUrl(url)) return { ok: false, error: 'invalid' };

  const id = (label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20) || 'prov')
          + '-' + Math.random().toString(36).slice(2, 7);

  const list = getProviders();
  list.push({ id, label: label.trim(), url: url.trim(), icon: icon.trim(), pinned: !!pinned });
  setProviders(list);

  if (setAsDefault) {
    setDefaultId(id);
    view?.webContents.loadURL(url);
  }

  return { ok: true, id };
});

ipcMain.handle('providers:remove', (_e, id) => {
  const list = getProviders();
  const idx = list.findIndex(p => p.id === id);
  if (idx < 0) return { ok: false, error: 'not_found' };

  const wasDefault = getDefaultId() === id;
  list.splice(idx, 1);
  setProviders(list);

  if (wasDefault && list[0]) {
    setDefaultId(list[0].id);
    view?.webContents.loadURL(list[0].url);
  }
  return { ok: true };
});

ipcMain.handle('providers:setPinned', (_e, { id, pinned }) => {
  const list = getProviders();
  const p = list.find(x => x.id === id);
  if (!p) return { ok: false, error: 'not_found' };
  p.pinned = !!pinned;
  setProviders(list);
  return { ok: true };
});

// NOVO: update (editar label/url/icon)
ipcMain.handle('providers:update', (_e, { id, label, url, icon }) => {
  const list = getProviders();
  const p = list.find(x => x.id === id);
  if (!p) return { ok: false, error: 'not_found' };

  if (typeof label === 'string' && label.trim()) p.label = label.trim();
  if (typeof icon === 'string') p.icon = icon.trim();

  if (typeof url === 'string') {
    if (!validateUrl(url)) return { ok: false, error: 'invalid_url' };
    p.url = url.trim();
  }

  setProviders(list);
  return { ok: true };
});

app.on('will-quit', () => globalShortcut.unregisterAll());
