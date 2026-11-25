/**
 * 企业服务大厅 · Electron 壳
 *
 * 干三件网页版做不到的事：
 *   1. 用 <webview> 代替 iframe —— 不受 X-Frame-Options / frame-ancestors 限制
 *   2. 主进程拦截 guest 的 window.open，转成应用内页签
 *   3. guest preload 覆盖 parent 指向，绕开 "读父页面属性" 的同源报错
 *
 * 它只是壳：不启动、也不携带后端。第一次打开必须先填服务端地址，
 * 之后所有数据都来自那个服务端，和网页版共用同一份。
 */

const { app, BrowserWindow, Menu, Tray, nativeImage, dialog, shell, session, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const PACKAGED = app.isPackaged;
/* 只是输入框里的建议值，不代表默认就会连它 */
const SUGGEST_ORIGIN = 'http://127.0.0.1:' + (Number(process.env.PORT) || 8080);
const DEV = process.argv.includes('--dev');
const REPO = 'MIAOPANGCI/one-stop-service';

let win = null;
let setupWin = null;
let aboutWin = null;
let tray = null;
let quitting = false;

/* ---------------- 本地偏好（菜单栏显隐这类） ---------------- */

const prefs = {
  hideMenuBar: false,
  /* 点右上角关闭时：tray 收进托盘 / quit 直接退出 */
  closeAction: 'tray',
  /* 关闭时问一句「收托盘还是退出」 */
  confirmClose: true,
  /* 下载新版本走的 HTTP 代理，留空直连。GitHub 慢的时候填这个 */
  updateProxy: '',
  /* 连哪个服务端。空 = 本机 127.0.0.1:8080。
     填了远端地址就纯当客户端用，本地不再存一份数据。 */
  serverUrl: ''
};

function prefsPath() {
  return path.join(app.getPath('userData'), 'desktop-prefs.json');
}

function loadPrefs() {
  try {
    const raw = JSON.parse(fs.readFileSync(prefsPath(), 'utf8'));
    if (raw && typeof raw === 'object') {
      if (typeof raw.hideMenuBar === 'boolean') prefs.hideMenuBar = raw.hideMenuBar;
      if (typeof raw.serverUrl === 'string') prefs.serverUrl = raw.serverUrl;
      if (typeof raw.updateProxy === 'string') prefs.updateProxy = raw.updateProxy;
      if (raw.closeAction === 'tray' || raw.closeAction === 'quit') prefs.closeAction = raw.closeAction;
      if (typeof raw.confirmClose === 'boolean') prefs.confirmClose = raw.confirmClose;
      if (typeof raw.trayHinted === 'boolean') prefs.trayHinted = raw.trayHinted;
    }
  } catch (e) {}
}

function savePrefs() {
  try {
    fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
    fs.writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2));
  } catch (e) {}
}


/* ---------------- 路径 ---------------- */

function iconPath() {
  const p = path.join(__dirname, 'build', 'icon.png');
  return fs.existsSync(p) ? p : undefined;
}

/* ---------------- 服务端地址 ---------------- */

function normalizeOrigin(v) {
  let s = String(v || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s.replace(/\/+$/, '');
}

/* 只认用户填的（或环境变量给的）。客户端自己不起服务，所以没有默认值。 */
function serverOrigin() {
  return normalizeOrigin(process.env.PORTAL_SERVER) || normalizeOrigin(prefs.serverUrl) || '';
}

function isLocalOrigin(origin) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(origin);
}

/* 探测时带上桌面客户端 UA：服务端 --mode desktop 会据此放行。
   返回 { state: 'ok' | 'web-only' | 'offline', mode, version, status } */
function probeInfo(origin) {
  return new Promise((resolve) => {
    const offline = (status) => resolve({ state: 'offline', status: status || 0 });

    let target;
    try { target = new URL('/api/ping', origin || serverOrigin()); }
    catch (e) { return offline(0); }
    if (!target.host) return offline(0);

    const mod = target.protocol === 'https:' ? https : http;
    const req = mod.get(target, {
      timeout: 2500,
      // 内网自签证书很常见，别因为这个连不上
      rejectUnauthorized: false,
      headers: { 'User-Agent': 'CorpPortalDesktop/' + app.getVersion() }
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 4000) body += c; });
      res.on('end', () => {
        let d = null;
        try { d = JSON.parse(body); } catch (e) {}

        if (res.statusCode === 200 && d && d.name === 'corp-portal') {
          return resolve({ state: 'ok', mode: d.mode || 'both', version: d.version || '', status: 200 });
        }

        // 403 + mode=web：服务端活着，只是不让桌面客户端连
        if (res.statusCode === 403 && d && d.mode === 'web') {
          return resolve({ state: 'web-only', mode: 'web', status: 403 });
        }

        offline(res.statusCode);
      });
    });
    req.on('error', () => offline(0));
    req.on('timeout', () => { req.destroy(); offline(0); });
  });
}

/* ---------------- 连接设置窗口 ---------------- */

/* 第一次打开、或者连不上时，先让用户填地址。
   填的东西要能真的连上才保存 —— 免得存了个错的、下次又进不去。 */
function createSetupWindow(origin, message) {
  if (setupWin && !setupWin.isDestroyed()) {
    setupWin.show();
    setupWin.focus();
    return setupWin;
  }

  const self = new BrowserWindow({
    width: 560,
    height: 494,
    resizable: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    title: '连接服务端',
    icon: iconPath(),
    backgroundColor: '#f5f7fa',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'host-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  setupWin = self;
  self.setMenuBarVisibility(false);

  self.loadFile(path.join(__dirname, 'setup.html'), {
    query: {
      origin: normalizeOrigin(origin) || '',
      suggest: SUGGEST_ORIGIN,
      msg: message || ''
    }
  });

  self.once('ready-to-show', () => { if (!self.isDestroyed()) self.show(); });
  self.on('closed', () => { if (setupWin === self) setupWin = null; });
  self.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  return self;
}

function closeSetupWindow() {
  const target = setupWin;
  setupWin = null;
  if (target && !target.isDestroyed()) target.destroy();
}

/* 连上了才往下走；否则回到设置窗口 */
async function boot() {
  const origin = serverOrigin();

  if (!origin) {
    createSetupWindow('', '第一次使用，先填服务端地址。');
    return;
  }

  const info = await probeInfo(origin);

  if (info.state === 'ok') {
    createWindow();
    return;
  }

  createSetupWindow(origin, info.state === 'web-only'
    ? '这个服务端只开了网页版（--mode web），桌面客户端连不进去。让管理员改成 --mode both 或 desktop。'
    : '连不上 ' + origin + '。确认服务端已经启动，地址和端口没写错。');
}

/* ---------------- 窗口 ---------------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#0e141a',
    title: '企业服务大厅',
    icon: iconPath(),
    autoHideMenuBar: prefs.hideMenuBar,
    webPreferences: {
      preload: path.join(__dirname, 'host-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false
    }
  });

  applyMenuBar();

  // 页签里的 <webview> 一律强制使用我们的 preload
  win.webContents.on('will-attach-webview', guardWebview);

  win.loadURL(serverOrigin() + '/');

  if (DEV) win.webContents.openDevTools({ mode: 'detach' });

  win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    // 页签里的 webview 失败不归这里管，只处理主页面
    if (!isMainFrame || !/\/\/?$/i.test(String(url || '').replace(/^https?:\/\/[^/]+/i, '/'))) return;

    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<body style="margin:0;display:grid;place-items:center;height:100vh;' +
      'font:15px/1.9 \'Microsoft YaHei\',system-ui;color:#33404d;background:#f6f8fa">' +
      '<div style="max-width:520px;padding:26px 30px;background:#fff;border-radius:14px;' +
      'box-shadow:0 18px 44px -24px rgba(16,24,40,.4)">' +
      '<h2 style="margin:0 0 10px;font-size:17px">连不上服务端</h2>' +
      '<p style="margin:0;color:#5a6672;word-break:break-all">' + escHtml(serverOrigin() || '（还没设置）') + '</p>' +
      '<p style="margin:14px 0 0;color:#8b95a1;font-size:13px">' +
      '服务端可能关机了，或者网络不通。菜单「文件 → 重新设置服务端…」可以换地址，改完重启客户端。</p>' +
      '</div></body>'
    ));
  });

  // 门户页面里的外链一律交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', handleClose);
  win.on('closed', () => { win = null; });
}

/* ---------------- 托盘 / 关闭行为 ---------------- */

function showMain() {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.moveTop();
    win.focus();

    // Windows 不允许后台进程随便抢前台，抢不到就闪任务栏，让用户点一下
    setTimeout(() => {
      if (win && !win.isDestroyed() && !win.isFocused()) {
        try { win.flashFrame(true); } catch (e) {}
        win.once('focus', () => { try { win.flashFrame(false); } catch (e) {} });
        setTimeout(() => { try { if (win && !win.isDestroyed()) win.flashFrame(false); } catch (e) {} }, 6000);
      }
    }, 260);

    return;
  }

  boot();
}

function ensureTray() {
  if (tray) return tray;

  const ico = iconPath();
  if (!ico) return null;

  let img = nativeImage.createFromPath(ico);
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });

  try {
    tray = new Tray(img);

    tray.setToolTip('企业服务大厅');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开主界面', click: () => showMain() },
      { type: 'separator' },
      { label: '检查更新', click: () => checkUpdate(true) },
      { label: '重新设置服务端…', click: () => createSetupWindow(serverOrigin(), '') },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit(); } }
    ]));

    tray.on('click', () => showMain());
    tray.on('double-click', () => showMain());
  } catch (e) {
    tray = null;
  }

  return tray;
}

function hideToTray() {
  if (!ensureTray()) { quitting = true; app.quit(); return; }
  if (win && !win.isDestroyed()) win.hide();

  // 头一次收进托盘提示一句，免得以为关掉了
  if (!prefs.trayHinted) {
    prefs.trayHinted = true;
    savePrefs();
    try {
      tray.displayBalloon({
        title: '企业服务大厅还在运行',
        content: '已经收进托盘，双击图标就能打开；要彻底退出请右键托盘图标。'
      });
    } catch (e) {}
  }
}

async function askCloseBehavior() {
  const opts = {
    type: 'question',
    message: '关闭主界面？',
    detail: '收到托盘后服务不中断，双击托盘图标就能回来。',
    buttons: ['最小化到托盘', '退出程序', '取消'],
    defaultId: prefs.closeAction === 'quit' ? 1 : 0,
    cancelId: 2,
    checkboxLabel: '记住我的选择，以后不再问',
    checkboxChecked: false,
    noLink: true
  };

  const p = parentWin();
  const r = p ? await dialog.showMessageBox(p, opts) : await dialog.showMessageBox(opts);

  return {
    action: r.response === 1 ? 'quit' : 'tray',
    cancel: r.response === 2,
    remember: !!r.checkboxChecked
  };
}

function handleClose(e) {
  if (quitting) return;

  // 没有托盘（比如图标读不出来）就别拦着了
  if (!iconPath()) return;

  e.preventDefault();

  if (!prefs.confirmClose) {
    if (prefs.closeAction === 'quit') { quitting = true; app.quit(); return; }
    hideToTray();
    return;
  }

  askCloseBehavior().then((r) => {
    if (r.cancel) return;

    if (r.remember) {
      prefs.closeAction = r.action;
      prefs.confirmClose = false;
      savePrefs();
    }

    if (r.action === 'quit') { quitting = true; app.quit(); return; }
    hideToTray();
  }).catch(() => {});
}

/* ---------------- webview 策略 ---------------- */

function isHttp(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

function guardWebview(event, webPreferences, params) {
  if (!isHttp(params.src)) {
    event.preventDefault();
    return;
  }

  delete webPreferences.preload;
  webPreferences.preload = path.join(__dirname, 'guest-preload.js');
  webPreferences.nodeIntegration = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.contextIsolation = true;
  webPreferences.sandbox = false;
  webPreferences.webSecurity = true;
}

app.on('web-contents-created', (event, contents) => {
  if (contents.getType() !== 'webview') return;

  contents.setWindowOpenHandler(({ url }) => {
    if (isHttp(url) && win && !win.isDestroyed()) {
      win.webContents.send('guest-open-tab', url);
    }
    return { action: 'deny' };
  });

  contents.session.setPermissionRequestHandler((wc, permission, callback) => {
    callback(['clipboard-sanitized-write', 'fullscreen'].includes(permission));
  });
});

/* ---------------- 菜单 ---------------- */

/* 菜单栏占一行高度，公司电脑多是 1366×768，很值钱。
   默认仍显示，用户自己在「视图」里关掉，关掉后按 Alt 还能临时叫出来。 */
function applyMenuBar() {
  if (!win || win.isDestroyed()) return;

  win.setAutoHideMenuBar(!!prefs.hideMenuBar);
  win.setMenuBarVisibility(!prefs.hideMenuBar);

  const item = Menu.getApplicationMenu() && Menu.getApplicationMenu().getMenuItemById('toggle-menubar');
  if (item) item.checked = !!prefs.hideMenuBar;
}

function setMenuHidden(hidden) {
  prefs.hideMenuBar = !!hidden;
  savePrefs();
  applyMenuBar();
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '重新设置服务端…', click: () => createSetupWindow(serverOrigin(), '') },
        {
          label: '在浏览器中打开',
          enabled: !!serverOrigin(),
          click: () => { if (serverOrigin()) shell.openExternal(serverOrigin() + '/'); }
        },
        { type: 'separator' },
        { label: '当前服务端：' + (serverOrigin() || '未设置'), enabled: false },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', click: () => app.quit() }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { type: 'separator' },
        {
          id: 'toggle-menubar',
          label: '隐藏菜单栏（按 Alt 可临时显示）',
          type: 'checkbox',
          checked: !!prefs.hideMenuBar,
          accelerator: 'Ctrl+Shift+M',
          click: (item) => setMenuHidden(item.checked)
        }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '检查更新', click: () => checkUpdate(true) },
        { label: '关于', click: showAbout }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- 关于 ---------------- */

function showAbout() {
  if (aboutWin && !aboutWin.isDestroyed()) { aboutWin.focus(); return; }

  aboutWin = new BrowserWindow({
    width: 470,
    height: 430,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: '关于',
    parent: win || undefined,
    icon: iconPath(),
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  const rows = [
    ['应用版本', app.getVersion()],
    ['Electron', process.versions.electron],
    ['Chromium', process.versions.chrome],
    ['Node', process.versions.node],
    ['服务端', serverOrigin() || '（未设置）']
  ];

  // 图标直接内联，省得去读文件路径
  let logoSrc = '';
  try {
    logoSrc = 'data:image/png;base64,' +
      fs.readFileSync(path.join(__dirname, 'build', 'icon.png')).toString('base64');
  } catch (e) {}

  const logo = logoSrc
    ? `<img class="logo" src="${logoSrc}" alt="">`
    : '<div class="logo">万</div>';

  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:26px 28px;font:13px/1.7 "Segoe UI","Microsoft YaHei",system-ui;color:#1a2430;background:#fff}
    .head{overflow:hidden;margin-bottom:14px}
    .logo{width:52px;height:52px;border-radius:13px;background:#f2f7f6;padding:3px;
      display:grid;place-items:center;font-size:24px;font-weight:700;color:#fff;
      float:left;margin-right:12px;object-fit:contain}
    h1{margin:0 0 3px;font-size:16px;font-weight:600}
    p.sub{margin:0;color:#7b8590;font-size:12px}
    table{border-collapse:collapse;width:100%}
    td{padding:5px 0;vertical-align:top;font-size:12.5px}
    td.k{color:#7b8590;width:78px;white-space:nowrap}
    td.v{color:#1a2430;word-break:break-all;font-family:ui-monospace,Consolas,monospace}
  </style>
  <div class="head">
    ${logo}
    <h1>企业服务大厅</h1>
    <p class="sub">桌面客户端 · v${app.getVersion()}</p>
  </div>
  <table>${rows.map(r => `<tr><td class="k">${r[0]}</td><td class="v">${String(r[1]).replace(/</g, '&lt;')}</td></tr>`).join('')}</table>`;

  aboutWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  aboutWin.on('closed', () => { aboutWin = null; });
}

/* ---------------- 渲染层（门户设置页）来的请求 ---------------- */

ipcMain.handle('portal:server-info', () => {
  const origin = serverOrigin();
  return {
    origin: origin,
    configured: !!normalizeOrigin(prefs.serverUrl),
    local: !!origin && isLocalOrigin(origin),
    packaged: PACKAGED,
    updateProxy: prefs.updateProxy || '',
    closeAction: prefs.closeAction,
    confirmClose: prefs.confirmClose,
    version: app.getVersion()
  };
});

/* 门户设置页里改地址：先验证能连上，再存 + 重启，避免存个打不开的 */
ipcMain.handle('portal:set-server', async (e, value) => {
  const url = normalizeOrigin(value);
  if (!url) return { ok: false, error: '先填地址，例如 http://192.168.3.20:8080' };

  const info = await probeInfo(url);
  if (info.state === 'web-only') {
    return { ok: false, error: '这个服务端只开了网页版（--mode web），桌面客户端连不进去' };
  }
  if (info.state !== 'ok') {
    return { ok: false, error: '连不上 ' + url + (info.status ? '（HTTP ' + info.status + '）' : '') };
  }

  prefs.serverUrl = url;
  savePrefs();

  setTimeout(() => { app.relaunch(); app.exit(0); }, 300);
  return { ok: true, origin: url, restart: true };
});

/* 关闭主界面时的行为 */
ipcMain.handle('portal:set-close-behavior', (e, action, confirm) => {
  if (action === 'tray' || action === 'quit') prefs.closeAction = action;
  if (typeof confirm === 'boolean') prefs.confirmClose = confirm;
  savePrefs();
  return { ok: true, closeAction: prefs.closeAction, confirmClose: prefs.confirmClose };
});

/* 更新下载代理：空字符串 = 直连 */
ipcMain.handle('portal:set-update-proxy', (e, value) => {
  const v = String(value || '').trim();
  if (v && !/^https?:\/\/[^\s]+$/i.test(v)) {
    return { ok: false, error: '代理要写成 http://127.0.0.1:7897 这样' };
  }
  prefs.updateProxy = v;
  savePrefs();
  return { ok: true, updateProxy: v };
});

/* 连接设置窗口用 */
ipcMain.handle('portal:probe-server', async (e, value) => {
  const url = normalizeOrigin(value);
  if (!url) return { ok: false, error: '先填地址，例如 http://192.168.3.20:8080' };

  const info = await probeInfo(url);
  if (info.state === 'ok') {
    return { ok: true, origin: url, version: info.version, mode: info.mode };
  }
  if (info.state === 'web-only') {
    return { ok: false, error: '这个服务端只开了网页版，桌面客户端连不进去' };
  }
  return { ok: false, error: '连不上 ' + url + (info.status ? '（HTTP ' + info.status + '）' : '，检查地址和端口') };
});

ipcMain.handle('portal:setup-save', async (e, value) => {
  const url = normalizeOrigin(value);
  if (!url) return { ok: false, error: '先填地址，例如 http://192.168.3.20:8080' };

  const info = await probeInfo(url);
  if (info.state === 'web-only') {
    return { ok: false, error: '这个服务端只开了网页版（--mode web），桌面客户端连不进去。让管理员改成 --mode both 或 desktop。' };
  }
  if (info.state !== 'ok') {
    return { ok: false, error: '连不上 ' + url + (info.status ? '（HTTP ' + info.status + '）' : '，检查地址和端口') };
  }

  prefs.serverUrl = url;
  savePrefs();

  if (win && !win.isDestroyed()) {
    // 运行中改地址：重启自己，省得半截状态对不上
    setTimeout(() => { app.relaunch(); app.exit(0); }, 200);
    return { ok: true, restart: true };
  }

  // 先开大厅再关设置窗：反过来的话「最后一个窗口关闭」会直接触发退出
  createWindow();
  closeSetupWindow();

  return { ok: true };
});

ipcMain.on('portal:quit', () => app.quit());

ipcMain.on('portal:relaunch', () => {
  app.relaunch();
  app.exit(0);
});

/* ---------------- 下载进度 ---------------- */

/* 一个自己画的小窗，队列式管理。两种下载共用：
   - 客户端自身的更新包（https 直连 GitHub）
   - 页签里（webview）点的下载，走 will-download

   两个要点：
   1. 先让用户选保存路径，选完才开始真正下载；取消就整条取消，不显示进度。
   2. 多个文件同时下时在同一个小窗里排队，而不是一开一关地闪。 */

const DL_W = 420;
const DL_ROW_H = 58;
const DL_GAP = 10;
const DL_PAD = 24;
const DL_MAX_ROWS = 4;

let dlWin = null;
let dlTimer = null;
let dlSeq = 0;
const dlItems = new Map();   // id -> { name, cancel, state, ratio }

function fmtSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dlHtml() {
  return `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    html,body{height:100%}
    body{margin:0;padding:12px 14px;overflow:hidden;background:#fff;
      font:12.5px/1.5 "Segoe UI","Microsoft YaHei",system-ui;color:#1a2430}
    #list{display:flex;flex-direction:column;gap:${DL_GAP}px;max-height:100%;overflow:auto}
    .row{flex:0 0 auto}
    .top{display:flex;align-items:baseline;gap:8px}
    .nm{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pct{flex-shrink:0;color:#7b8590;font-variant-numeric:tabular-nums}
    .bar{height:4px;border-radius:99px;background:#eef2f5;overflow:hidden;margin:6px 0 5px}
    .bar i{display:block;height:100%;width:0;border-radius:99px;background:#2fa795;transition:width .18s linear}
    .ft{display:flex;align-items:center;gap:8px;color:#7b8590;font-size:11.5px;font-variant-numeric:tabular-nums}
    .ft .txt{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ft button{flex-shrink:0;padding:2px 9px;border:1px solid #e0e6ec;border-radius:5px;
      background:#fff;color:#41505c;font:inherit;font-size:11px;cursor:pointer}
    .ft button:hover{background:#f4f7f9}
    .row.ok .bar i{background:#17a34a}
    .row.err .bar i{background:#e0484d}
    .row.err .nm,.row.err .txt{color:#e0484d}
    .row.ok .ft button,.row.err .ft button{display:none}
  </style>
  <div id="list"></div>
  <script>
    function row(id) { return document.querySelector('.row[data-id="' + id + '"]'); }
    window.__dl = {
      add: function (id, name) {
        var d = document.createElement('div');
        d.className = 'row';
        d.setAttribute('data-id', id);
        d.innerHTML =
          '<div class="top"><span class="nm"></span><span class="pct">0%</span></div>' +
          '<div class="bar"><i></i></div>' +
          '<div class="ft"><span class="txt">准备中…</span>' +
          '<button data-cancel="' + id + '">取消</button></div>';
        d.querySelector('.nm').textContent = name;
        d.querySelector('.nm').title = name;
        document.getElementById('list').appendChild(d);
      },
      set: function (id, p, t) {
        var d = row(id); if (!d) return;
        d.querySelector('.bar i').style.width = p + '%';
        d.querySelector('.pct').textContent = Math.round(p) + '%';
        if (t) d.querySelector('.txt').textContent = t;
      },
      finish: function (id, kind, t) {
        var d = row(id); if (!d) return;
        d.classList.add(kind);
        d.querySelector('.bar i').style.width = (kind === 'ok' ? 100 : 0) + '%';
        d.querySelector('.pct').textContent = kind === 'ok' ? '100%' : '';
        if (t) d.querySelector('.txt').textContent = t;
      },
      remove: function (id) { var d = row(id); if (d) d.remove(); }
    };
    document.getElementById('list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cancel]');
      if (b && window.dlTip) window.dlTip.cancel(b.getAttribute('data-cancel'));
    });
  </script>`;
}

function dlHeight() {
  const n = Math.max(1, Math.min(dlItems.size, DL_MAX_ROWS));
  return DL_PAD + n * DL_ROW_H + (n - 1) * DL_GAP;
}

function placeDlWindow(w) {
  if (!win || win.isDestroyed() || !w || w.isDestroyed()) return;
  try {
    const b = win.getBounds();
    w.setBounds({
      x: Math.round(b.x + b.width - DL_W - 28),
      y: Math.round(b.y + b.height - dlHeight() - 64),
      width: DL_W,
      height: dlHeight()
    });
  } catch (e) {}
}

function ensureDlWindow() {
  // 刚要自动关闭时又来了新任务：撤销关闭，继续用这扇窗
  if (dlTimer) { clearTimeout(dlTimer); dlTimer = null; }

  if (dlWin && !dlWin.isDestroyed()) {
    if (!dlWin.isVisible()) dlWin.showInactive();
    return dlWin;
  }

  const self = new BrowserWindow({
    width: DL_W,
    height: dlHeight(),
    frame: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#ffffff',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'dl-tip-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  dlWin = self;
  placeDlWindow(self);
  self.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(dlHtml()));
  self.once('ready-to-show', () => { if (!self.isDestroyed()) self.showInactive(); });
  self.on('closed', () => { if (dlWin === self) dlWin = null; });
  self.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  return self;
}

function dlExec(js) {
  if (!dlWin || dlWin.isDestroyed()) return Promise.resolve();
  return dlWin.webContents.executeJavaScript(js).catch(() => {});
}

function dlAdd(name, cancel) {
  const id = ++dlSeq;
  dlItems.set(id, { name: name, cancel: cancel, state: 'run', ratio: 0 });

  ensureDlWindow();
  dlExec('window.__dl.add(' + id + ',' + JSON.stringify(String(name || '下载文件')) + ')');

  placeDlWindow(dlWin);
  return id;
}

function dlSet(id, pct, text, ratio) {
  const it = dlItems.get(id);
  if (!it || it.state !== 'run') return;

  if (typeof ratio === 'number') it.ratio = Math.max(0, Math.min(1, ratio));

  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  dlExec('window.__dl.set(' + id + ',' + JSON.stringify(p) + ',' + JSON.stringify(String(text || '')) + ')');
  updateTaskbar();
}

function dlFinish(id, kind, text) {
  const it = dlItems.get(id);
  if (!it) return;

  it.state = kind;
  it.cancel = null;

  dlExec('window.__dl.finish(' + id + ',' + JSON.stringify(kind) + ',' + JSON.stringify(String(text || '')) + ')');
  updateTaskbar();

  setTimeout(() => {
    dlItems.delete(id);
    dlExec('window.__dl.remove(' + id + ')');

    if (!dlItems.size) {
      closeDlWindow(220);
    } else {
      placeDlWindow(dlWin);
    }
  }, 2800);
}

function closeDlWindow(delay) {
  if (dlTimer) { clearTimeout(dlTimer); dlTimer = null; }

  const target = dlWin;
  if (!target || target.isDestroyed()) { dlWin = null; return; }

  if (!delay) {
    dlWin = null;
    target.destroy();
    return;
  }

  dlTimer = setTimeout(() => {
    dlTimer = null;
    if (!target.isDestroyed()) target.destroy();
    if (dlWin === target) dlWin = null;
    setTaskbarProgress(-1);
  }, delay);
}

function setTaskbarProgress(ratio) {
  if (!win || win.isDestroyed()) return;
  try { win.setProgressBar(ratio > 0 && ratio < 1 ? ratio : -1); } catch (e) {}
}

/* 多个同时下时，任务栏进度取平均，别来回跳 */
function updateTaskbar() {
  const running = Array.from(dlItems.values()).filter((x) => x.state === 'run');
  if (!running.length) { setTaskbarProgress(-1); return; }

  const avg = running.reduce((s, x) => s + (x.ratio || 0), 0) / running.length;
  setTaskbarProgress(Math.max(0.01, avg));
}

function notifyDone(name, savePath) {
  if (!Notification.isSupported()) return;
  try {
    const n = new Notification({ title: '下载完成', body: name, icon: iconPath() });
    n.on('click', () => { if (savePath) shell.showItemInFolder(savePath); });
    n.show();
  } catch (e) {}
}

/* 页签里点「下载」：Electron 默认会自己弹保存框并立刻开下，
   结果就是「还没选路径，进度条已经跑了」。这里改成自己控：
   先同步弹保存框 → 取消就整条取消 → 选了才 setSavePath 开始下。 */
function hookDownloads() {
  session.defaultSession.on('will-download', (event, item) => {
    const name = item.getFilename() || '下载文件';

    let savePath = '';
    try {
      const opts = {
        title: '保存文件',
        defaultPath: path.join(app.getPath('downloads'), name),
        buttonLabel: '保存'
      };
      savePath = (win && !win.isDestroyed())
        ? dialog.showSaveDialogSync(win, opts)
        : dialog.showSaveDialogSync(opts);
    } catch (e) {
      savePath = '';
    }

    if (!savePath) {
      try { item.cancel(); } catch (e) {}
      return;
    }

    try { item.setSavePath(savePath); } catch (e) {}

    const id = dlAdd(name, () => { try { item.cancel(); } catch (e) {} });

    item.on('updated', (e, state) => {
      if (state === 'interrupted') return dlSet(id, 0, '连接中断，正在重试…');
      if (state !== 'progressing') return;

      const got = item.getReceivedBytes();
      const tot = item.getTotalBytes();

      if (tot > 0) {
        dlSet(id, (got / tot) * 100, fmtSize(got) + ' / ' + fmtSize(tot), got / tot);
      } else {
        dlSet(id, 0, '已接收 ' + fmtSize(got));
      }
    });

    item.on('done', (e, state) => {
      if (state === 'completed') {
        dlFinish(id, 'ok', '已保存到 ' + path.basename(item.getSavePath()));
        notifyDone(name, item.getSavePath());
      } else if (state === 'cancelled') {
        dlFinish(id, 'err', '已取消');
      } else {
        dlFinish(id, 'err', '下载失败');
      }
    });
  });
}

ipcMain.on('dl-tip-cancel', (e, id) => {
  const it = dlItems.get(Number(id));
  if (!it || it.state !== 'run') return;

  const fn = it.cancel;
  it.cancel = null;
  if (fn) { try { fn(); } catch (e) {} }

  dlFinish(Number(id), 'err', '已取消');
});

/* ---------------- 弹窗辅助 ---------------- */

/* 更新检查可能在「连接服务端」窗口里点，那时还没有大厅窗口，
   所以父窗口要动态找，实在没有就独立弹。 */
function parentWin() {
  if (win && !win.isDestroyed()) return win;
  if (setupWin && !setupWin.isDestroyed()) return setupWin;
  return null;
}

function msgBox(opts) {
  const p = parentWin();
  return p ? dialog.showMessageBox(p, opts) : dialog.showMessageBox(opts);
}

function msgBoxSync(opts) {
  const p = parentWin();
  return p ? dialog.showMessageBoxSync(p, opts) : dialog.showMessageBoxSync(opts);
}

ipcMain.handle('portal:check-update', () => checkUpdate(true));

/* ---------------- 更新 ---------------- */

function cmpVersion(a, b) {
  const pa = String(a || '0').split('-')[0].split('.');
  const pb = String(b || '0').split('-')[0].split('.');
  for (let i = 0; i < 3; i++) {
    const x = parseInt(pa[i], 10) || 0;
    const y = parseInt(pb[i], 10) || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function httpGetJson(url, timeout) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };

    const req = https.get(url, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'corp-portal-desktop' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return httpGetJson(res.headers.location, timeout).then(finish);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 200000) body += c; });
      res.on('end', () => {
        try { finish(JSON.parse(body)); } catch (e) { finish(null); }
      });
    });

    req.setTimeout(timeout || 8000, () => { req.destroy(); finish(null); });
    req.on('error', () => finish(null));
  });
}

async function checkUpdate(manual) {
  const rel = await httpGetJson(`https://api.github.com/repos/${REPO}/releases/latest`, 8000);

  if (!rel || !rel.tag_name) {
    if (manual) {
      msgBox({
        type: 'warning',
        title: '检查更新',
        message: '连不上更新服务',
        detail: '这台机器可能访问不了外网，或者暂时被限流。可以到内网共享盘拿新版本。'
      });
    }
    return;
  }

  const latest = String(rel.tag_name).replace(/^v/i, '');
  if (cmpVersion(latest, app.getVersion()) <= 0) {
    if (manual) {
      msgBox({
        type: 'info',
        title: '检查更新',
        message: '已是最新版本',
        detail: '当前 v' + app.getVersion()
      });
    }
    return;
  }

  const ans = await msgBox({
    type: 'info',
    title: '发现新版本',
    message: `发现 v${latest}（当前 v${app.getVersion()}）`,
    detail: String(rel.body || '').slice(0, 700) || '（这个版本没有写更新说明）',
    buttons: ['下载并安装', '打开下载页', '稍后'],
    defaultId: 0,
    cancelId: 2
  });

  if (ans.response === 1) {
    shell.openExternal(rel.html_url);
    return;
  }
  if (ans.response === 0) downloadAndInstall(rel);
}

function normalizeProxy(v) {
  let s = String(v || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s.replace(/\/+$/, '');
}

/* 安装版还是便携版：两个附件都有就问一句，按当前运行方式给推荐 */
function pickAsset(rel) {
  const assets = rel.assets || [];
  const setup = assets.find((a) => /setup.*\.exe$/i.test(a.name));
  const portable = assets.find((a) => /portable.*\.exe$/i.test(a.name));

  if (!setup && !portable) {
    return assets.find((a) => /\.exe$/i.test(a.name)) || null;
  }
  if (!setup || !portable) return setup || portable;

  const runningPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;
  const first = runningPortable ? portable : setup;
  const second = runningPortable ? setup : portable;

  const ans = msgBoxSync({
    type: 'question',
    message: '下载哪个版本？',
    detail: '安装版：装到本机，带开始菜单和桌面快捷方式，适合长期用。\n' +
      '便携版：单个 exe，放在哪都能跑，不写注册表。' +
      (runningPortable ? '\n\n你现在用的就是便携版，建议继续用便携版。' : ''),
    buttons: [
      (first === setup ? '安装版' : '便携版') + '（推荐）',
      (second === setup ? '安装版' : '便携版'),
      '取消'
    ],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  });

  if (ans === 2) return null;
  return ans === 0 ? first : second;
}

/* 便携版没有安装程序，得自己换自己：
   运行中的 exe 允许改名、但不允许覆盖，所以走「新文件先落地 → 旧的改名让位 → 新的顶上」，
   全程都在同一个目录里，跨盘也不怕。 */
function portableExe() {
  return process.env.PORTABLE_EXECUTABLE_FILE || '';
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch (e) { const end = Date.now() + ms; while (Date.now() < end) {} }
}

function replacePortable(newFile) {
  const dest = portableExe();
  if (!dest) return { ok: false, error: '当前不是便携版运行方式' };

  const staged = dest + '.new';
  const old = dest + '.old';

  // 1) 先把新版本拷到同一目录（同盘改名才快，也避免跨盘拷贝中途失败）
  try {
    fs.rmSync(staged, { force: true });
    fs.copyFileSync(newFile, staged);
  } catch (e) {
    try { fs.rmSync(staged, { force: true }); } catch (e2) {}
    return { ok: false, error: '写新版本失败（' + (e.code || e.message) + '），目录可能没有写权限' };
  }

  try { fs.rmSync(old, { force: true }); } catch (e) {}

  // 2) 旧的让位。杀软/搜索索引偶尔占着一两秒，重试几次
  let renamed = false;
  let lastErr = null;
  for (let i = 0; i < 8; i++) {
    try { fs.renameSync(dest, old); renamed = true; break; }
    catch (e) { lastErr = e; sleepSync(350); }
  }

  if (!renamed) {
    try { fs.rmSync(staged, { force: true }); } catch (e) {}
    return { ok: false, error: '原文件被占用，改不了名（' + (lastErr && lastErr.code) + '）' };
  }

  // 3) 新的顶上；万一失败把旧的放回去
  for (let i = 0; i < 4; i++) {
    try { fs.renameSync(staged, dest); return { ok: true }; }
    catch (e) {
      lastErr = e;
      sleepSync(250);
    }
  }

  try { fs.renameSync(old, dest); } catch (e) {}
  try { fs.rmSync(staged, { force: true }); } catch (e) {}
  return { ok: false, error: '新文件放不回去（' + (lastErr && lastErr.code) + '）' };
}

/* 上次替换留下的 .old：那时它还在运行，删不掉，这次启动再收 */
function cleanOldPortable() {
  const dest = portableExe();
  if (!dest) return;

  const old = dest + '.old';
  let tries = 0;

  const tick = () => {
    if (!fs.existsSync(old)) return;
    try { fs.unlinkSync(old); }
    catch (e) { if (++tries < 6) setTimeout(tick, 800); }
  };

  tick();
}

function downloadAndInstall(rel) {
  const asset = pickAsset(rel);

  if (!asset) {
    if (!(rel.assets || []).some((a) => /\.exe$/i.test(a.name))) shell.openExternal(rel.html_url);
    return;
  }

  const proxy = normalizeProxy(prefs.updateProxy || process.env.PORTAL_UPDATE_PROXY || '');

  const target = path.join(app.getPath('temp'), asset.name);
  let currentReq = null;
  let cancelled = false;

  const id = dlAdd('新版本 ' + String(rel.tag_name || '') + ' · ' + asset.name, () => {
    cancelled = true;
    if (currentReq) { try { currentReq.destroy(); } catch (e) {} }
  });

  dlSet(id, 0, '连接中…');

  const openStream = (url, onRes) => {
    const u = new URL(url);
    const headers = { 'User-Agent': 'corp-portal-desktop' };

    if (!proxy) {
      return https.get(url, { headers: headers }, onRes);
    }

    // 走代理：先 CONNECT 一条隧道，再在这条 socket 上发 https 请求
    const pu = new URL(proxy);
    const conn = http.request({
      host: pu.hostname,
      port: pu.port || 80,
      method: 'CONNECT',
      path: u.hostname + ':443',
      headers: { Host: u.hostname + ':443' }
    });

    conn.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        currentReq = null;
        dlFail('代理返回 ' + res.statusCode);
        return;
      }
      const req = https.request({
        host: u.hostname,
        path: u.pathname + u.search,
        headers: headers,
        agent: false,
        socket: socket,
        servername: u.hostname
      }, onRes);
      req.on('error', (e) => dlFail('下载中断：' + e.message));
      req.end();
      currentReq = req;
    });

    conn.end();
    return conn;
  };

  const dlFail = (msg) => {
    dlFinish(id, 'err', msg);
    msgBox({ type: 'error', message: '下载失败', detail: msg + '，请到发布页手动下载。' });
  };

  const dl = (url, redirects) => {
    const req = openStream(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return dl(res.headers.location, redirects - 1);
      }

      if (res.statusCode !== 200) {
        res.resume();
        dlFinish(id, 'err', '下载失败：HTTP ' + res.statusCode);
        msgBox({ type: 'error', message: '下载失败', detail: 'HTTP ' + res.statusCode + '，请到发布页手动下载。' });
        shell.openExternal(rel.html_url);
        return;
      }

      const total = Number(res.headers['content-length']) || 0;
      let got = 0;

      res.on('data', (chunk) => {
        got += chunk.length;
        if (total > 0) {
          dlSet(id, (got / total) * 100,
            fmtSize(got) + ' / ' + fmtSize(total) + '（剩余 ' + fmtSize(total - got) + '）',
            got / total);
        } else {
          dlSet(id, 0, '已下载 ' + fmtSize(got));
        }
      });

      const file = fs.createWriteStream(target);
      res.pipe(file);

      file.on('finish', () => {
        file.close(() => {
          dlFinish(id, 'ok', '下载完成');

          const runningPortable = !!portableExe();
          const gotPortable = /portable/i.test(asset.name);

          if (runningPortable && gotPortable) {
            // 便携版：直接把当前 exe 换掉再重启，别留一个临时文件让人找
            const go = msgBoxSync({
              type: 'question',
              message: '替换并重启到新版本？',
              detail: '会用新版本覆盖当前这个 exe，然后自动重启。数据和服务端设置都不受影响。',
              buttons: ['替换并重启', '只下载（我不换）'],
              defaultId: 0,
              cancelId: 1
            });

            if (go !== 0) { shell.showItemInFolder(target); return; }

            const rep = replacePortable(target);

            if (!rep.ok) {
              // 换不掉也别让人无从下手：在 exe 旁边放一份能直接双击运行的
              const dest = portableExe() || '';
              let beside = '';
              if (dest) {
                beside = dest.replace(/\.exe$/i, '') + '-新版本.exe';
                try { fs.copyFileSync(target, beside); } catch (e) { beside = ''; }
              }

              msgBox({
                type: 'error',
                message: '替换失败',
                detail: rep.error + '\n\n' +
                  (beside
                    ? '已经把新版本放在同一个文件夹里，名叫：\n' + path.basename(beside) +
                      '\n直接双击它就能用新版本，确认没问题后把旧的删掉即可。'
                    : '新版本在：' + target + '，手动覆盖即可。') +
                  '\n\n目标位置：' + (dest || '（未识别）')
              });

              if (beside) shell.showItemInFolder(beside);
              else shell.showItemInFolder(target);
              return;
            }

            try { app.relaunch({ execPath: portableExe(), args: [] }); } catch (e) {}
            app.quit();
            return;
          }

          if (!runningPortable && gotPortable) {
            msgBox({
              type: 'info',
              message: '便携版已下载',
              detail: '你现在用的是安装版。要用便携版的话，直接运行下载好的文件即可，不用安装。'
            });
            shell.showItemInFolder(target);
            return;
          }

          const go = msgBoxSync({
            type: 'question',
            message: '下载完成，现在安装吗？',
            detail: '安装过程会关闭客户端，装完重新打开即可。',
            buttons: ['立即安装', '稍后（文件已保存）'],
            defaultId: 0,
            cancelId: 1
          });

          if (go === 0) {
            spawn(target, [], { detached: true, stdio: 'ignore' }).unref();
            app.quit();
          } else {
            shell.showItemInFolder(target);
          }
        });
      });

      file.on('error', () => {
        dlFinish(id, 'err', '保存失败');
        msgBox({ type: 'error', message: '保存失败', detail: target });
      });
    });

    currentReq = req;

    req.on('error', () => {
      if (cancelled) return;
      dlFinish(id, 'err', '下载失败：网络中断');
      msgBox({ type: 'error', message: '下载失败', detail: '网络中断，请到发布页手动下载。' });
    });
  };

  dl(asset.browser_download_url, 3);
}

/* ---------------- 生命周期 ---------------- */

if (!app.requestSingleInstanceLock()) {
  // 已经有实例在跑：通知已经发出去了，自己退干净。
  // 用 exit 而不是 quit，跳过整个生命周期，任务栏不会闪。
  setTimeout(() => app.exit(0), 50);
} else {
  app.on('second-instance', () => showMain());

  app.whenReady().then(async () => {
    try { app.setAppUserModelId('cn.szwl.portal'); } catch (e) {}

    loadPrefs();

    session.defaultSession.setUserAgent(
      session.defaultSession.getUserAgent() + ' CorpPortalDesktop/' + app.getVersion()
    );

    hookDownloads();
    buildMenu();
    cleanOldPortable();

    // 连得上就进大厅，连不上（含第一次）先填地址
    await boot();

    // 打包版启动后静默查一次更新，连不上就算了
    if (PACKAGED) setTimeout(() => checkUpdate(false), 5000);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) boot();
    });
  });

  app.on('before-quit', () => { quitting = true; });

  app.on('window-all-closed', () => {
    // 设置窗 → 大厅的切换有个瞬间可能没有窗口，等一拍再判断
    setTimeout(() => {
      if (BrowserWindow.getAllWindows().length) return;
      if (!quitting && tray && prefs.closeAction === 'tray') return;   // 收在托盘里，别退
      app.quit();
    }, 80);
  });
}
