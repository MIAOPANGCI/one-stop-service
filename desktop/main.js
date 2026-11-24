/**
 * 企业服务大厅 · Electron 壳
 *
 * 干三件网页版做不到的事：
 *   1. 用 <webview> 代替 iframe —— 不受 X-Frame-Options / frame-ancestors 限制
 *   2. 主进程拦截 guest 的 window.open，转成应用内页签
 *   3. guest preload 覆盖 parent 指向，绕开 "读父页面属性" 的同源报错
 *
 * 后端复用仓库根目录的 server.js：8080 已经在跑就直接连，没跑就用
 * ELECTRON_RUN_AS_NODE 拉一个，退出时收走。
 */

const { app, BrowserWindow, Menu, shell, session } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;
const ORIGIN = 'http://127.0.0.1:' + PORT;
const DEV = process.argv.includes('--dev');

let win = null;
let serverProc = null;
let quitting = false;

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

  serverProc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(PORT) },
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
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'host-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,          // 页签要用 <webview>
      spellcheck: false
    }
  });

  // 页签里的 <webview> 一律强制使用我们的 preload
  win.webContents.on('will-attach-webview', guardWebview);

  win.loadURL(ORIGIN + '/');

  if (DEV) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.webContents.on('did-fail-load', () => {
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<body style="font:15px/1.9 system-ui;padding:60px;color:#334">' +
      '<h2>连不上本地服务</h2>' +
      '<p>端口 ' + PORT + ' 没有响应。先单独跑一次 <code>node server.js</code> 看看报什么错。</p>' +
      '</body>'
    ));
  });

  // 页面里的外链一律交给系统浏览器，别把壳变成浏览器
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

app.on('web-contents-created', (event, contents) => {
  if (contents.getType() !== 'webview') return;

  // 页签里的 window.open / target=_blank：不开浏览器窗口，交给宿主开新页签
  contents.setWindowOpenHandler(({ url }) => {
    if (isHttp(url) && win && !win.isDestroyed()) {
      win.webContents.send('guest-open-tab', url);
    }
    return { action: 'deny' };
  });

  // 别让 guest 自己弹出各种权限框
  contents.session.setPermissionRequestHandler((wc, permission, callback) => {
    callback(['clipboard-sanitized-write', 'fullscreen'].includes(permission));
  });
});

function guardWebview(event, webPreferences, params) {
  if (!isHttp(params.src)) {
    event.preventDefault();
    return;
  }

  // preload 由壳统一指定，页面传什么都不认
  delete webPreferences.preload;
  webPreferences.preload = path.join(__dirname, 'guest-preload.js');
  webPreferences.nodeIntegration = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.contextIsolation = true;
  webPreferences.sandbox = false;          // preload 需要 require
  webPreferences.webSecurity = true;       // 保持同源策略，只是不再管 XFO

}

/* ---------------- 生命周期 ---------------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);

    // 全局 UA 加个标记，前端据此决定用不用 webview
    session.defaultSession.setUserAgent(session.defaultSession.getUserAgent() + ' CorpPortalDesktop/1.0');

    const ok = await ensureServer();
    if (!ok) {
      console.error('后端没起来，端口 ' + PORT);
    }
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => { quitting = true; });

  app.on('window-all-closed', () => {
    stopServer();
    app.quit();
  });

  app.on('quit', () => { if (!quitting) stopServer(); });
}
