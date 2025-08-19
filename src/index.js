const { app, BrowserWindow, BrowserView, globalShortcut, ipcMain, shell } = require('electron');
const path = require('path');

const TB_HEIGHT = 44; // altura da titlebar com abas
let win, view;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 1000,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'shell-preload.js') // preload do "chrome"
    }
  });

  // Carrega o "shell" local que contém a titlebar + abas (não é o site!)
  win.loadFile(path.join(__dirname, 'shell.html'));

  // Cria o BrowserView para o site remoto
  view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      // (opcional) preload para o conteúdo remoto, se precisar
      // preload: path.join(__dirname, 'content-preload.js')
    }
  });
  win.setBrowserView(view);

  // Primeira URL
  view.webContents.loadURL('https://chat.openai.com/');

  // Tamanho/posição do BrowserView (abaixo da barra)
  const setBounds = () => {
    const [w, h] = win.getContentSize();
    view.setBounds({ x: 0, y: TB_HEIGHT, width: w, height: Math.max(0, h - TB_HEIGHT) });
  };
  setBounds();
  win.on('resize', setBounds);

  // Abrir links "target=_blank" no navegador padrão
  view.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Atualiza aba ativa quando navegar (full nav e navegação in-page SPA)
  const notifyActive = (_ev, url) => { win.webContents.send('nav:active', url); };
  view.webContents.on('did-navigate', notifyActive);
  view.webContents.on('did-navigate-in-page', notifyActive);
}

// Toggle com atalho global (como você já tinha)
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

// IPC: ações da janela e navegação das abas
ipcMain.handle('window:minimize', () => win?.minimize());
ipcMain.handle('window:close', () => win?.close());
ipcMain.handle('window:toggleMaximize', () => win?.isMaximized() ? win.unmaximize() : win.maximize());
ipcMain.handle('nav:go', (_evt, url) => { if (view && typeof url === 'string') view.webContents.loadURL(url); });

app.on('will-quit', () => globalShortcut.unregisterAll());
