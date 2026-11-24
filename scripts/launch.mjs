#!/usr/bin/env node
/**
 * 一键启动：网页版 / 桌面客户端 / 两者
 *
 *   node scripts/launch.mjs          交互式菜单（start.bat 双击走这条）
 *   node scripts/launch.mjs web      仅网页版
 *   node scripts/launch.mjs desktop  仅桌面客户端
 *   node scripts/launch.mjs both     两者都启动
 *   node scripts/launch.mjs web --port 9000
 *
 * 三种方式共用一个服务端进程、一份 data —— 桌面客户端只是连过去的壳，
 * 所以网页版和桌面版看到的永远是同一批数据。
 *
 * 菜单为什么放在 Node 里：cmd 解析 UTF-8 批处理时会在某些汉字中间断行，
 * 把后半句当命令执行（报 "xxx is not recognized"）。批处理里只留 ASCII，
 * 中文交给 Node 输出就不会踩这个坑。
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 端口 ---------------- */

function configPort() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
    const p = Number(cfg.port);
    if (Number.isInteger(p) && p >= 1 && p <= 65535) return p;
  } catch (e) {}
  return 0;
}

function resolvePort(override) {
  const p = Number(override);
  if (Number.isInteger(p) && p >= 1 && p <= 65535) return p;
  const env = Number(process.env.PORT);
  if (Number.isInteger(env) && env >= 1 && env <= 65535) return env;
  return configPort() || 8080;
}

let PORT = resolvePort();

/* ---------------- 服务端 ---------------- */

/* 探测端口上是不是我们的服务端；顺便带回它当前的启动模式 */
function ping() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: PORT, path: '/api/ping', timeout: 900,
        headers: { 'User-Agent': 'CorpPortalDesktop/launcher' } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { if (body.length < 4000) body += c; });
        res.on('end', () => {
          try {
            const d = JSON.parse(body);
            resolve(res.statusCode === 200 && d.name === 'corp-portal'
              ? { ok: true, mode: d.mode || 'both' }
              : { ok: false });
          } catch (e) { resolve({ ok: false }); }
        });
      }
    );
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
  });
}

function openBrowser(url) {
  if (!url) return;
  const cmd = IS_WIN ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = IS_WIN ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch (e) {}
}

function log(msg) { console.log('\n  ' + msg); }

const MODE_TEXT = { both: '网页版 + 桌面客户端', web: '仅网页版', desktop: '仅桌面客户端' };

async function ensureServer(serverMode, openPage) {
  const alive = await ping();

  if (alive.ok) {
    log('端口 ' + PORT + ' 上已经有服务端在跑，直接复用（数据是同一份）');
    log('它当前的模式是「' + (MODE_TEXT[alive.mode] || alive.mode) + '」');

    if (alive.mode !== serverMode) {
      console.log('  想换成「' + MODE_TEXT[serverMode] + '」，先关掉那个服务端窗口再重新启动。');
    }
    if (openPage) openBrowser('http://localhost:' + PORT + '/');
    return null;
  }

  const args = [path.join(ROOT, 'server.js'), '--mode', serverMode, '--port', String(PORT)];
  if (openPage) args.push('--open');

  log('启动服务端（mode=' + serverMode + '，端口 ' + PORT + '）');
  const proc = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });

  for (let i = 0; i < 40; i++) {
    await wait(250);
    if ((await ping()).ok) return proc;
  }

  console.error('\n  ✗ 服务端起不来，检查端口 ' + PORT + ' 是否被别的程序占用\n');
  return proc;
}

function startClient() {
  if (!fs.existsSync(path.join(ROOT, 'desktop', 'node_modules'))) {
    console.error('\n  ✗ 桌面客户端依赖没装。先执行：cd desktop && npm install\n');
    process.exit(1);
  }

  log('启动桌面客户端');
  const proc = spawn(IS_WIN ? 'npm.cmd' : 'npm', ['--prefix', 'desktop', 'start'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: IS_WIN
  });
  proc.on('exit', (code) => process.exit(code || 0));
}

/* ---------------- 交互菜单 ---------------- */

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => { rl.close(); resolve(String(ans || '').trim()); });
  });
}

async function menu() {
  console.log('');
  console.log('  ============================================');
  console.log('    企业服务大厅 · 启动方式');
  console.log('  ============================================');
  console.log('');
  console.log('    1  仅网页版        只开放浏览器访问，桌面客户端连不进来');
  console.log('    2  仅桌面客户端    浏览器打开会被拒绝，只给客户端用');
  console.log('    3  两者都启动      浏览器 + 桌面客户端，共用同一个服务端数据');
  console.log('    4  自定义端口      换一个端口启动网页版');
  console.log('    q  退出');
  console.log('');

  const ans = (await ask('  请选择 [1-4，默认 3]：') || '3').toLowerCase();

  if (ans === 'q' || ans === 'quit' || ans === 'exit') return;

  if (ans === '4') {
    const p = await ask('  端口号 [默认 ' + PORT + ']：');
    PORT = resolvePort(p || PORT);
    log('仅网页版（端口 ' + PORT + '）');
    await ensureServer('web', true);
    return;
  }

  if (ans === '2') { log('仅桌面客户端：浏览器打开会被拒绝'); await ensureServer('desktop', false); startClient(); return; }
  if (ans === '1') { log('仅网页版：浏览器可以访问，桌面客户端连不进来'); await ensureServer('web', true); return; }

  log('网页版 + 桌面客户端');
  await ensureServer('both', true);
  startClient();
}

/* ---------------- 入口 ---------------- */

const argv = process.argv.slice(2);
const modeArg = argv.find((a) => !a.startsWith('-') && ['web', 'desktop', 'both'].includes(a.toLowerCase()));
const portIdx = argv.indexOf('--port');
const portArg = portIdx > -1 ? argv[portIdx + 1] : '';

if (portArg) PORT = resolvePort(portArg);

if (modeArg) {
  const MODE = modeArg.toLowerCase();

  if (MODE === 'web') {
    log('仅网页版：浏览器可以访问，桌面客户端连不进来');
    await ensureServer('web', true);
  } else if (MODE === 'desktop') {
    log('仅桌面客户端：浏览器打开会被拒绝');
    await ensureServer('desktop', false);
    startClient();
  } else {
    log('网页版 + 桌面客户端');
    await ensureServer('both', true);
    startClient();
  }
} else {
  await menu();
}
