// main.js
const { app, BrowserWindow, BrowserView, globalShortcut, ipcMain, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const fs = require('fs');

if (!app.requestSingleInstanceLock()) { app.quit(); }

// Sempre use %AppData%\SeuApp (gravável)
const userData = path.join(app.getPath('appData'), app.getName());
app.setPath('userData', userData);

// Directory do cache explícito dentro do userData
const cacheDir = path.join(userData, 'Cache');
fs.mkdirSync(cacheDir, { recursive: true });
app.commandLine.appendSwitch('disk-cache-dir', cacheDir);

// Evita cache de shaders em disco (ruído comum)
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-gpu-program-cache');

// ======= Limpeza emergencial (opcional, só rodar UMA vez) =======
// Rode o app com RECOVER_CACHE=1 na primeira execução após este patch
if (process.env.RECOVER_CACHE === '1') {
  // apaga pastas problemáticas ANTES de criar janela/sessão
  for (const rel of ['Service Worker', 'GPUCache', 'Code Cache', 'Cache']) {
    try { fs.rmSync(path.join(userData, rel), { recursive: true, force: true }); } catch {}
  }
}

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
let win;
let contentView;     // BrowserView com sites/IA
let settingsView;    // BrowserView com settings/index.html
let ACTIVE = 'content';
let CHROME_HEIGHT = 48;

// ------------ Criação das janelas ------------
function ensureViews() {
  if (!contentView) {
    contentView = new BrowserView({
      webPreferences: { contextIsolation: true }
    });
    // carregue a URL do provedor padrão
    const providers = getProviders();
    let def = findProvider(getDefaultId());
    if (!def) { def = providers[0]; setDefaultId(def.id); }
    contentView.webContents.loadURL(def.url);

    // abrir target=_blank fora
    contentView.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

    // avisar shell sobre URL ativa (para pintar a aba)
    const notify = (_e, url) => win?.webContents.send('nav:active', url);
    contentView.webContents.on('did-navigate', notify);
    contentView.webContents.on('did-navigate-in-page', notify);
  }

  if (!settingsView) {
    settingsView = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        preload: path.join(__dirname, 'settings/settings-preload.js') // o mesmo preload da janela separada
      }
    });
    settingsView.webContents.loadFile(path.join(__dirname, 'settings', 'index.html'));
  }
}

function setBoundsAll() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const rect = { x: 0, y: Math.round(CHROME_HEIGHT), width: w, height: Math.max(0, h - Math.round(CHROME_HEIGHT)) };
  if (contentView)  contentView.setBounds(rect);
  if (settingsView) settingsView.setBounds(rect);
}

function attach(view) {
  // remove todos e adiciona apenas o desejado
  win.getBrowserViews().forEach(v => win.removeBrowserView(v));
  win.addBrowserView(view);
  setBoundsAll();
}

function broadcastSettingsState() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('settings:state', { open: ACTIVE === 'settings' });
  }
}

function showSettings(inSameWindow) {
  ensureViews();
  if (inSameWindow) {
    attach(settingsView);
    ACTIVE = 'settings';
  } else {
    attach(contentView);
    ACTIVE = 'content';
  }
  broadcastSettingsState();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 700,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'shell-preload.js'), partition: 'persist:main'}
  });

  win.loadFile(path.join(__dirname, 'shell.html'));
  ensureViews();
  attach(contentView); // inicia no conteúdo

  win.on('resize', setBoundsAll);

  // envia lista inicial ao shell quando estiver pronto
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('providers:init', { providers: getProviders(), defaultId: getDefaultId() });
  });
}

// Emite atualização para shell e settings
function notifyProvidersChanged() {
  const payload = { providers: getProviders(), defaultId: getDefaultId() };
  if (win && !win.isDestroyed()) win.webContents.send('providers:changed', payload);
  if (settingsView && !settingsView.webContents.isDestroyed()) {
    settingsView.webContents.send('providers:changed', payload);
  }
}
// ------------ Atalho global (toggle janela) ------------
function toggleWindow() {
  if (!win) return;
  if (win.isMinimized()) { win.restore(); win.show(); win.focus(); }
  else if (win.isVisible()) { win.minimize(); }
  else { win.show(); win.focus(); }
}

app.whenReady().then(async () => {
  if (process.env.RECOVER_CACHE === '1') {
    try {
      await session.fromPartition('persist:main').clearStorageData({
        storages: ['serviceworkers', 'cachestorage'],
        quotas: ['temporary', 'persistent']
      });
    } catch (e) {
      console.warn('Falha limpando storage SW/CacheStorage:', e);
    }
  }

  createWindow();
  globalShortcut.register('Control+Shift+Space', toggleWindow);
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
  ensureViews();
  if (contentView && typeof url === 'string') contentView.webContents.loadURL(url);
  if (ACTIVE !== 'content') showSettings(false); // volta pro conteúdo
});

// ------------ IPC: abrir janela de Configurações ------------
ipcMain.handle('settings:open', (_evt, optionalPath) => {
  openSettingsWindow(optionalPath);
  return { ok: true };
});

ipcMain.handle('settings:show', (_evt, show) => {
  showSettings(!!show);
  return { ok: true, open: ACTIVE === 'settings' };
});

ipcMain.handle('settings:toggle', () => {
  showSettings(!(ACTIVE === 'settings'));
  return { ok: true, open: ACTIVE === 'settings' };
});

ipcMain.handle('settings:getState', () => ({ open: ACTIVE === 'settings' }));

// ------------ IPC: Providers CRUD ------------
ipcMain.handle('providers:list', () => ({ providers: getProviders(), defaultId: getDefaultId() }));

ipcMain.handle('providers:get', () => ({
  providers: getProviders(),
  defaultId: getDefaultId(),
}));

ipcMain.handle('providers:setDefault', (_e, id) => {
  const p = findProvider(id);
  if (!p) return { ok:false };
  setDefaultId(id);
  if (contentView) contentView.webContents.loadURL(p.url);
  showSettings(false);
  return { ok:true };
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
