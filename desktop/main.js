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

const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const PACKAGED = app.isPackaged;
const APP_ROOT = PACKAGED ? path.join(process.resourcesPath, 'app-root') : path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;
const ORIGIN = 'http://127.0.0.1:' + PORT;
const DEV = process.argv.includes('--dev');
const REPO = 'MIAOPANGCI/one-stop-service';

let win = null;
let aboutWin = null;
let serverProc = null;

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

/* ---------------- 后端 ---------------- */

function ping() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };

    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/ping', timeout: 900 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 4000) body += c; });
      res.on('end', () => {
        try { finish(res.statusCode === 200 && JSON.parse(body).name === 'corp-portal'); }
        catch (e) { finish(false); }
      });
    });
    req.on('error', () => finish(false));
    req.on('timeout', () => { req.destroy(); finish(false); });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureServer() {
  if (await ping()) return true;

  fs.mkdirSync(dataDir(), { recursive: true });

  serverProc = spawn(process.execPath, [path.join(APP_ROOT, 'server.js')], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(PORT),
      PORTAL_DATA_DIR: dataDir(),
      PORTAL_CONFIG: configPath()
    },
    stdio: 'ignore',
    windowsHide: true
  });

  for (let i = 0; i < 48; i++) {
    await wait(250);
    if (await ping()) return true;
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
    webPreferences: {
      preload: path.join(__dirname, 'host-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false
    }
  });

  // 页签里的 <webview> 一律强制使用我们的 preload
  win.webContents.on('will-attach-webview', guardWebview);

  win.loadURL(ORIGIN + '/');

  if (DEV) win.webContents.openDevTools({ mode: 'detach' });

  win.webContents.on('did-fail-load', () => {
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<body style="font:15px/1.9 system-ui;padding:60px;color:#334">' +
      '<h2>连不上本地服务</h2>' +
      '<p>端口 ' + PORT + ' 没有响应。数据目录：' + dataDir() + '</p>' +
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

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '打开数据目录', click: () => { shell.openPath(app.getPath('userData')); } },
        { label: '在浏览器中打开', click: () => { shell.openExternal(ORIGIN + '/'); } },
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
        { role: 'togglefullscreen', label: '全屏' }
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

  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:26px 28px;font:13px/1.7 "Segoe UI","Microsoft YaHei",system-ui;color:#1a2430;background:#fff}
    .head{overflow:hidden;margin-bottom:16px}
    .logo{width:46px;height:46px;border-radius:12px;background:#2fa795;color:#fff;
      display:grid;place-items:center;font-size:24px;font-weight:700;float:left;margin-right:12px}
    h1{margin:0 0 3px;font-size:16px;font-weight:600}
    p.sub{margin:0;color:#7b8590;font-size:12px}
    table{border-collapse:collapse;width:100%}
    td{padding:5px 0;vertical-align:top;font-size:12.5px}
    td.k{color:#7b8590;width:78px;white-space:nowrap}
    td.v{color:#1a2430;word-break:break-all;font-family:ui-monospace,Consolas,monospace}
  </style>
  <div class="head">
    <div class="logo">万</div>
    <h1>企业服务大厅</h1>
    <p class="sub">桌面客户端 · v${app.getVersion()}</p>
  </div>
  <table>${rows.map(r => `<tr><td class="k">${r[0]}</td><td class="v">${String(r[1]).replace(/</g, '&lt;')}</td></tr>`).join('')}</table>`;

  aboutWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  aboutWin.on('closed', () => { aboutWin = null; });
}

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
  const tip = new BrowserWindow({
    width: 360,
    height: 130,
    frame: false,
    resizable: false,
    parent: win || undefined,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: false }
  });
  tip.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<body style="margin:0;display:grid;place-items:center;height:100vh;font:13px/1.7 \'Microsoft YaHei\',system-ui;color:#1a2430;background:#fff">' +
    '<div style="text-align:center">正在下载 ' + rel.tag_name + '…<br><span style="color:#7b8590;font-size:12px">' + asset.name + '</span></div></body>'
  ));

  const dl = (url, redirects) => {
    https.get(url, { headers: { 'User-Agent': 'corp-portal-desktop' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return dl(res.headers.location, redirects - 1);
      }
      if (res.statusCode !== 200) {
        res.resume();
        if (!tip.isDestroyed()) tip.destroy();
        dialog.showMessageBox(win, { type: 'error', message: '下载失败', detail: 'HTTP ' + res.statusCode + '，请到发布页手动下载。' });
        shell.openExternal(rel.html_url);
        return;
      }

      const file = fs.createWriteStream(target);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          if (!tip.isDestroyed()) tip.destroy();
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
        if (!tip.isDestroyed()) tip.destroy();
        dialog.showMessageBox(win, { type: 'error', message: '保存失败', detail: target });
      });
    }).on('error', () => {
      if (!tip.isDestroyed()) tip.destroy();
      dialog.showMessageBox(win, { type: 'error', message: '下载失败', detail: '网络中断，请到发布页手动下载。' });
    });
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
    session.defaultSession.setUserAgent(
      session.defaultSession.getUserAgent() + ' CorpPortalDesktop/' + app.getVersion()
    );

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
