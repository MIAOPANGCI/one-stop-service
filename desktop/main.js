/**
 * 企业服务大厅 · Electron 壳
 *
 * 干三件网页版做不到的事：
 *   1. 用 <webview> 代替 iframe —— 不受 X-Frame-Options / frame-ancestors 限制
 *   2. 主进程拦截 guest 的 window.open，转成应用内页签
 *   3. guest preload 覆盖 parent 指向，绕开 "读父页面属性" 的同源报错
 *
 * 打包后：后端放在 resources/app-root，数据写到 %APPDATA%/<app>/data。
 * 未打包：直接复用仓库根目录的 server.js 和 data/。
 */

const { app, BrowserWindow, Menu, dialog, shell, session, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const PACKAGED = app.isPackaged;
const APP_ROOT = PACKAGED ? path.join(process.resourcesPath, 'app-root') : path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;
const DEV = process.argv.includes('--dev');
const REPO = 'MIAOPANGCI/one-stop-service';

let win = null;
let aboutWin = null;
let serverProc = null;

/* ---------------- 本地偏好（菜单栏显隐这类） ---------------- */

const prefs = {
  hideMenuBar: false,
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

function dataDir() {
  return PACKAGED ? path.join(app.getPath('userData'), 'data') : path.join(APP_ROOT, 'data');
}

function configPath() {
  return PACKAGED ? path.join(app.getPath('userData'), 'config.json') : path.join(APP_ROOT, 'config.json');
}

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

/* 优先级：环境变量 > prefs > 本机默认 */
function serverOrigin() {
  return normalizeOrigin(process.env.PORTAL_SERVER) ||
    normalizeOrigin(prefs.serverUrl) ||
    ('http://127.0.0.1:' + PORT);
}

function isLocalOrigin(origin) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(origin);
}

function originPort(origin) {
  try {
    const u = new URL(origin);
    if (u.port) return Number(u.port);
    return u.protocol === 'https:' ? 443 : 80;
  } catch (e) {
    return PORT;
  }
}

/* ---------------- 后端 ---------------- */

/* 探测时带上桌面客户端 UA：服务端 --mode desktop 会据此放行。
   返回 'ok' / 'web-only'（服务端在，只开了网页版）/ 'none'（啥也没有）。 */
function probe(origin) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };

    let target;
    try { target = new URL('/api/ping', origin || serverOrigin()); }
    catch (e) { return finish('none'); }

    const mod = target.protocol === 'https:' ? https : http;
    const req = mod.get(target, {
      timeout: 1200,
      headers: { 'User-Agent': 'CorpPortalDesktop/' + app.getVersion() }
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 4000) body += c; });
      res.on('end', () => {
        let d = null;
        try { d = JSON.parse(body); } catch (e) {}

        if (res.statusCode === 200 && d && d.name === 'corp-portal') return finish('ok');

        // 403 + mode=web：服务端活着，只是不让桌面客户端连
        if (res.statusCode === 403 && d && d.mode === 'web') return finish('web-only');

        finish('none');
      });
    });
    req.on('error', () => finish('none'));
    req.on('timeout', () => { req.destroy(); finish('none'); });
  });
}

function ping(origin) {
  return probe(origin).then((r) => r === 'ok');
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* 上次探测的结论，连不上时给失败页用 */
let serverState = 'unknown';

async function ensureServer() {
  const origin = serverOrigin();
  serverState = await probe(origin);

  if (serverState === 'ok') return true;

  /* 对方只开了网页版：说清楚，别在本地再起一个抢端口 */
  if (serverState === 'web-only') return false;

  /* 连的是别的机器上的服务端：连不上就直说，绝不在本地偷偷起一份自己的数据 */
  if (!isLocalOrigin(origin)) return false;

  fs.mkdirSync(dataDir(), { recursive: true });

  serverProc = spawn(process.execPath, [path.join(APP_ROOT, 'server.js')], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(originPort(origin)),
      PORTAL_DATA_DIR: dataDir(),
      PORTAL_CONFIG: configPath()
    },
    stdio: 'ignore',
    windowsHide: true
  });

  for (let i = 0; i < 48; i++) {
    await wait(250);
    if (await probe(origin) === 'ok') { serverState = 'ok'; return true; }
  }
  return false;
}

function stopServer() {
  if (!serverProc) return;
  try { serverProc.kill(); } catch (e) {}
  serverProc = null;
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

  win.webContents.on('did-fail-load', () => {
    const why = serverState === 'web-only'
      ? '这个服务端是「仅网页版」模式（--mode web），不接受桌面客户端。把服务端改成 --mode both 启动，或换一个服务端地址。'
      : '连不上 ' + serverOrigin() + '。';

    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<body style="font:15px/1.9 system-ui;padding:60px;color:#334">' +
      '<h2>连不上服务端</h2>' +
      '<p>' + why + '</p>' +
      '<p style="color:#8b95a1;font-size:13px">本机数据目录：' + dataDir() + '</p>' +
      '<p style="color:#8b95a1;font-size:13px">改过服务端地址连不上的话，菜单「文件 → 改回本机服务端」可以恢复。</p>' +
      '</body>'
    ));
  });

  // 门户页面里的外链一律交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => { win = null; });
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
        { label: '打开数据目录', click: () => { shell.openPath(app.getPath('userData')); } },
        { label: '在浏览器中打开', click: () => { shell.openExternal(serverOrigin() + '/'); } },
        { type: 'separator' },
        { label: '连接的服务端：' + serverOrigin(), enabled: false },
        {
          label: '改回本机服务端',
          enabled: !!normalizeOrigin(prefs.serverUrl) || !!process.env.PORTAL_SERVER,
          click: () => {
            prefs.serverUrl = '';
            savePrefs();
            dialog.showMessageBox(win, {
              type: 'info',
              message: '已改回本机服务端',
              detail: '重启客户端后生效，也可以到「设置 → 打开与网络 → 桌面客户端」里改。'
            });
          }
        },
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
    ['服务端口', String(PORT)],
    ['数据目录', dataDir()]
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

/* ---------------- 下载进度 ---------------- */

/* 一个自己画的进度小窗，两种下载共用：
   - 客户端自身的更新包（https 直连 GitHub）
   - 页签里（webview）点的下载，走 will-download
   任务栏图标同时走 setProgressBar，窗口被挡在后面也能看见。 */

let dlWin = null;
let dlCancel = null;
let dlTimer = null;

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

function dlHtml(title, name) {
  return `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{margin:0;height:100vh;display:flex;flex-direction:column;justify-content:center;
      padding:16px 20px;font:12.5px/1.6 "Segoe UI","Microsoft YaHei",system-ui;color:#1a2430;background:#fff}
    .hd{display:flex;align-items:baseline;gap:8px}
    .hd b{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .hd span{margin-left:auto;flex-shrink:0;color:#7b8590;font-variant-numeric:tabular-nums}
    .nm{margin-top:2px;color:#5a6672;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .bar{margin:11px 0 8px;height:5px;border-radius:99px;background:#eef2f5;overflow:hidden}
    .bar i{display:block;height:100%;width:0;background:#2fa795;border-radius:99px;transition:width .18s linear}
    .ft{display:flex;align-items:center;gap:8px;font-size:11.5px;color:#7b8590;font-variant-numeric:tabular-nums}
    .ft button{margin-left:auto;padding:4px 11px;border:1px solid #e0e6ec;border-radius:6px;
      background:#fff;color:#41505c;font:inherit;cursor:pointer}
    .ft button:hover{background:#f4f7f9}
  </style>
  <div class="hd"><b>${escHtml(title)}</b><span id="pct">0%</span></div>
  <div class="nm">${escHtml(name)}</div>
  <div class="bar"><i id="fill"></i></div>
  <div class="ft"><span id="txt">准备中…</span><button id="cx">取消</button></div>
  <script>
    window.__dlSet = function (p, t) {
      document.getElementById('fill').style.width = p + '%';
      document.getElementById('pct').textContent = Math.round(p) + '%';
      if (t) document.getElementById('txt').textContent = t;
    };
    document.getElementById('cx').onclick = function () {
      if (window.dlTip) window.dlTip.cancel();
    };
  </script>`;
}

function openDlTip(title, name) {
  closeDlTip(0);

  const self = new BrowserWindow({
    width: 420,
    height: 152,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    parent: win || undefined,
    alwaysOnTop: true,
    backgroundColor: '#ffffff',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'dl-tip-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  dlWin = self;
  self.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(dlHtml(title, name)));
  self.once('ready-to-show', () => { if (!self.isDestroyed()) self.show(); });
  self.on('closed', () => { if (dlWin === self) dlWin = null; });
  self.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  return self;
}

function dlTick(pct, text) {
  if (!dlWin || dlWin.isDestroyed()) return;
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  dlWin.webContents.executeJavaScript(
    'window.__dlSet(' + JSON.stringify(p) + ',' + JSON.stringify(String(text || '')) + ')'
  ).catch(() => {});
}

function closeDlTip(delay) {
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
  }, delay);
}

function setTaskbarProgress(ratio) {
  if (!win || win.isDestroyed()) return;
  try { win.setProgressBar(ratio > 0 && ratio < 1 ? ratio : -1); } catch (e) {}
}

function notifyDone(name, savePath) {
  if (!Notification.isSupported()) return;
  try {
    const n = new Notification({ title: '下载完成', body: name, icon: iconPath() });
    n.on('click', () => { if (savePath) shell.showItemInFolder(savePath); });
    n.show();
  } catch (e) {}
}

/* 页签里点「下载」：Electron 默认悄悄存盘，进度条、失败提示都没有 */
function hookDownloads() {
  session.defaultSession.on('will-download', (event, item) => {
    const name = item.getFilename() || '下载文件';
    const total0 = item.getTotalBytes();

    openDlTip('正在下载', name);
    dlCancel = () => { try { item.cancel(); } catch (e) {} };

    item.on('updated', (e, state) => {
      if (state === 'interrupted') {
        dlTick(0, '连接中断，正在重试…');
        setTaskbarProgress(-1);
        return;
      }
      if (state !== 'progressing') return;

      const got = item.getReceivedBytes();
      const tot = item.getTotalBytes() || total0;

      if (tot > 0) {
        dlTick((got / tot) * 100, fmtSize(got) + ' / ' + fmtSize(tot));
        setTaskbarProgress(got / tot);
      } else {
        dlTick(0, '已接收 ' + fmtSize(got));
      }
    });

    item.on('done', (e, state) => {
      dlCancel = null;
      setTaskbarProgress(-1);

      if (state === 'completed') {
        dlTick(100, '下载完成');
        closeDlTip(700);
        notifyDone(name, item.getSavePath());
      } else if (state === 'cancelled') {
        closeDlTip(0);
      } else {
        dlTick(0, '下载失败');
        closeDlTip(4000);
      }
    });
  });
}

/* ---------------- 渲染层（门户设置页）来的请求 ---------------- */

ipcMain.handle('portal:server-info', () => {
  const origin = serverOrigin();
  return {
    origin: origin,
    configured: !!normalizeOrigin(prefs.serverUrl),
    local: isLocalOrigin(origin),
    packaged: PACKAGED,
    dataDir: dataDir(),
    version: app.getVersion()
  };
});

ipcMain.handle('portal:set-server', (e, value) => {
  prefs.serverUrl = normalizeOrigin(value);
  savePrefs();
  return { ok: true, origin: prefs.serverUrl || ('http://127.0.0.1:' + PORT) };
});

ipcMain.on('portal:relaunch', () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.on('dl-tip-cancel', () => {
  const fn = dlCancel;
  dlCancel = null;
  if (fn) { try { fn(); } catch (e) {} }
  dlTick(0, '已取消');
  setTaskbarProgress(-1);
  closeDlTip(600);
});

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
      dialog.showMessageBox(win, {
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
      dialog.showMessageBox(win, {
        type: 'info',
        title: '检查更新',
        message: '已是最新版本',
        detail: '当前 v' + app.getVersion()
      });
    }
    return;
  }

  const ans = await dialog.showMessageBox(win, {
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

function downloadAndInstall(rel) {
  const assets = rel.assets || [];
  const asset = assets.find((a) => /setup.*\.exe$/i.test(a.name)) ||
                assets.find((a) => /\.exe$/i.test(a.name)) ||
                null;

  if (!asset) {
    shell.openExternal(rel.html_url);
    return;
  }

  const target = path.join(app.getPath('temp'), asset.name);
  openDlTip('正在下载新版本 ' + String(rel.tag_name || ''), asset.name);
  dlTick(0, '连接中…');

  let cancelled = false;

  const dl = (url, redirects) => {
    const req = https.get(url, { headers: { 'User-Agent': 'corp-portal-desktop' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return dl(res.headers.location, redirects - 1);
      }
      if (res.statusCode !== 200) {
        res.resume();
        closeDlTip(0);
        dialog.showMessageBox(win, { type: 'error', message: '下载失败', detail: 'HTTP ' + res.statusCode + '，请到发布页手动下载。' });
        shell.openExternal(rel.html_url);
        return;
      }

      const total = Number(res.headers['content-length']) || 0;
      let got = 0;

      res.on('data', (chunk) => {
        got += chunk.length;
        if (total > 0) {
          dlTick((got / total) * 100, fmtSize(got) + ' / ' + fmtSize(total) + '（' + fmtSize(total - got) + ' 剩余）');
          setTaskbarProgress(got / total);
        } else {
          dlTick(0, '已下载 ' + fmtSize(got));
        }
      });

      const file = fs.createWriteStream(target);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          setTaskbarProgress(-1);
          dlTick(100, '下载完成');
          closeDlTip(400);
          const go = dialog.showMessageBoxSync(win, {
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
        setTaskbarProgress(-1);
        closeDlTip(0);
        dialog.showMessageBox(win, { type: 'error', message: '保存失败', detail: target });
      });
    });

    req.on('error', () => {
      if (cancelled) return;
      setTaskbarProgress(-1);
      closeDlTip(0);
      dialog.showMessageBox(win, { type: 'error', message: '下载失败', detail: '网络中断，请到发布页手动下载。' });
    });

    dlCancel = () => { cancelled = true; req.destroy(); };
  };

  dl(asset.browser_download_url, 3);
}

/* ---------------- 生命周期 ---------------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(async () => {
    try { app.setAppUserModelId('cn.szwl.portal'); } catch (e) {}

    loadPrefs();

    session.defaultSession.setUserAgent(
      session.defaultSession.getUserAgent() + ' CorpPortalDesktop/' + app.getVersion()
    );

    hookDownloads();
    buildMenu();

    const ok = await ensureServer();
    if (!ok) console.error('后端没起来，端口 ' + PORT);

    createWindow();

    // 打包版启动后静默查一次更新，连不上就算了
    if (PACKAGED) setTimeout(() => checkUpdate(false), 5000);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    stopServer();
    app.quit();
  });

  app.on('quit', stopServer);
}
