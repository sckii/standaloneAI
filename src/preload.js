const { app, BrowserWindow, BrowserView, ipcMain, globalShortcut } = require('electron');
const path = require('path');

let win, chromeView, contentView;
const CHROME_HEIGHT = 44;

// abas (label + url)
const TABS = [
  { label: 'GPT', url: 'https://chat.openai.com/' },
  { label: 'Claude', url: 'https://claude.ai/' },
  { label: 'Gemini', url: 'https://gemini.google.com' },
];

function setBounds() {
  const { width, height } = win.getContentBounds();
  chromeView.setBounds({ x: 0, y: 0, width, height: CHROME_HEIGHT });
  contentView.setBounds({ x: 0, y: CHROME_HEIGHT, width, height: height - CHROME_HEIGHT });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 700,
    frame: false,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
  });

  // ----- VIEW SUPERIOR (titlebar + abas) -----
  chromeView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload_chrome.js'),
    }
  });
  win.addBrowserView(chromeView);

  // HTML embutido (pode trocar por loadFile se preferir)
  const chromeHTML = `
  <!doctype html><html><head><meta charset="utf-8"/>
  <style>
    :root { --tb-h:${CHROME_HEIGHT}px; --glass: rgba(20,20,20,0.20); }
    body { margin:0; font: 13px/1 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; }
    .bar { -webkit-app-region: drag; height: var(--tb-h);
      display:grid; grid-template-columns:auto 1fr auto; align-items:center;
      gap:8px; padding:0 12px; background:var(--glass); backdrop-filter: blur(12px);
      color:#e6e6e6; }
    .left,.right { display:flex; gap:8px; align-items:center; -webkit-app-region:no-drag; }
    .dot { width:12px; height:12px; border-radius:50%; border:1px solid rgba(0,0,0,.15); cursor:pointer; position:relative; }
    .close{background:#ff5f57}.min{background:#ffbd2e}.max{background:#28c840}
    .center{ -webkit-app-region: no-drag; display:flex; justify-content:center; }
    .tabs{ display:flex; gap:8px; align-items:center; overflow-x:auto; padding:4px 0; }
    .tab{ border:1px solid rgba(255,255,255,.12); border-radius:999px; padding:8px 14px;
      color:#e6e6e6; background:rgba(255,255,255,.06); cursor:pointer; white-space:nowrap;
      transition:background .2s,border-color .2s,color .2s,transform .06s; }
    .tab:hover{ background:rgba(255,255,255,.12) } .tab:active{ transform:translateY(1px) }
    .tab.active{ color:#111; background:#fff; border-color:#fff; box-shadow:0 6px 16px rgba(0,0,0,.25) }
  </style></head><body>
    <div class="bar">
      <div class="left">
        <div class="dot close" title="Fechar"   id="btn-close"></div>
        <div class="dot min"   title="Minimizar"id="btn-min"></div>
        <div class="dot max"   title="Max/Rest" id="btn-max"></div>
      </div>
      <div class="center"><div class="tabs" id="tabs"></div></div>
      <div class="right" id="spacer"></div>
    </div>
    <script>
      const TABS = ${JSON.stringify(TABS)};
      const $ = sel => document.querySelector(sel);
      const tabsEl = $('#tabs');

      function renderTabs(activeHref) {
        tabsEl.innerHTML = '';
        TABS.forEach(t => {
          const b = document.createElement('button');
          b.className = 'tab' + ((activeHref && (activeHref.startsWith(t.url) || activeHref.includes(t.url))) ? ' active' : '');
          b.textContent = t.label;
          b.title = t.url;
          b.onclick = () => window.chromeAPI.go(t.url);
          tabsEl.appendChild(b);
        });
      }

      // botões janela
      $('#btn-close').onclick = () => window.chromeAPI.close();
      $('#btn-min').onclick   = () => window.chromeAPI.minimize();
      $('#btn-max').onclick   = () => window.chromeAPI.toggleMaximize();

      // centralização perfeita: espelha largura da esquerda na direita
      const left = document.querySelector('.left');
      const spacer = document.querySelector('#spacer');
      const ro = new ResizeObserver(()=> spacer.style.width = left.offsetWidth + 'px');
      ro.observe(left); spacer.style.width = left.offsetWidth + 'px';

      // ativa primeira renderização sem ativo
      renderTabs();

      // recebe navegação ativa do main
      window.chromeAPI.onActive(href => renderTabs(href));
    </script>
  </body></html>`;
  chromeView.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(chromeHTML));

  // ----- VIEW INFERIOR (conteúdo remoto) -----
  contentView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      // (opcional) preload do conteúdo se precisar
    }
  });
  win.addBrowserView(contentView);

  setBounds();
  win.on('resize', setBounds);

  // URL inicial
  contentView.webContents.loadURL(TABS[0].url);

  // informa a barra sobre a URL ativa
  const sendActive = () => {
    const url = contentView.webContents.getURL();
    chromeView.webContents.send('nav:active', url);
  };
  contentView.webContents.on('did-navigate', sendActive);
  contentView.webContents.on('did-navigate-in-page', sendActive);

  // atalho global (se você usa)
  const ok = globalShortcut.register('Control+Space', () => {
    if (win.isMinimized()) { win.restore(); win.show(); win.focus(); }
    else if (win.isVisible()) { win.minimize(); }
    else { win.show(); win.focus(); }
  });
  if (!ok) console.warn('Falha ao registrar atalho global.');
}

// IPCs
ipcMain.handle('nav:go', (_e, url) => {
  if (contentView && typeof url === 'string') contentView.webContents.loadURL(url);
});
ipcMain.handle('window:minimize', () => win?.minimize());
ipcMain.handle('window:close', () => win?.close());
ipcMain.handle('window:toggleMaximize', () => win?.isMaximized() ? win.unmaximize() : win.maximize());

app.whenReady().then(createWindow);
app.on('will-quit', () => globalShortcut.unregisterAll());
