#!/usr/bin/env node
/**
 * 一键启动：网页版 / 桌面客户端 / 两者
 *
 *   node scripts/launch.mjs          交互式菜单（start.bat 双击走这条，回车即可）
 *   node scripts/launch.mjs web      服务端 + 浏览器
 *   node scripts/launch.mjs desktop  只服务桌面客户端（浏览器 403）
 *   node scripts/launch.mjs both     服务端 + 浏览器 + 本机客户端
 *   node scripts/launch.mjs client   只打开本机客户端
 *   node scripts/launch.mjs web --port 9000 --host 192.168.1.20
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
import os from 'node:os';
import readline from 'node:readline';
import { spawn, execFileSync } from 'node:child_process';
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

function configHost() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
    const h = String(cfg.host || '').trim();
    return h;
  } catch (e) {}
  return '';
}

function resolvePort(override) {
  const p = Number(override);
  if (Number.isInteger(p) && p >= 1 && p <= 65535) return p;
  const env = Number(process.env.PORT);
  if (Number.isInteger(env) && env >= 1 && env <= 65535) return env;
  return configPort() || 8080;
}

let PORT = resolvePort();
let HOST = configHost();   // 跟随 config.json；命令行 --host 可以覆盖

/* ---------------- 服务端 ---------------- */

/* 探测端口上是不是我们的服务端；顺便带回它当前的启动模式 */
/* 服务端可能只绑了某块网卡（比如 172.18.0.135），探 127.0.0.1 会探不到，
   所以按实际监听地址去连 */
function probeHost() {
  return HOST && HOST !== '0.0.0.0' && HOST !== '::' ? HOST : '127.0.0.1';
}

function ping() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: probeHost(), port: PORT, path: '/api/ping', timeout: 900,
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

function localIPs() {
  const out = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((k) => {
    (nets[k] || []).forEach((n) => {
      if (n.family === 'IPv4' && !n.internal && !/^169\.254\./.test(n.address)) out.push(n.address);
    });
  });
  return out;
}

const MODE_TEXT = { both: '网页版 + 桌面客户端', web: '仅网页版', desktop: '仅桌面客户端' };

/* 更新握手用的文件：服务端要重启时写 pending，替换完由 runner 写 done */
const FLAG = path.join(ROOT, 'data', '.update-flag.json');

function readFlag() {
  try { return JSON.parse(fs.readFileSync(FLAG, 'utf8')); }
  catch (e) { return null; }
}

function clearFlag() {
  try { fs.rmSync(FLAG, { force: true }); } catch (e) {}
}

async function waitFlagDone(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const f = readFlag();
    if (f && f.stage === 'done') return f;
    await wait(500);
  }
  return null;
}

let currentServer = null;
let shuttingDown = false;

/* Ctrl+C 的时候别抢戏：服务端在同一个控制台里，它自己会打印「正在关闭，写入数据…」
   并落盘。这里只是别把自己留在那儿，也不要再插一句话把两段输出搅在一起。 */
function shutdownBySignal() {
  if (shuttingDown) return;
  shuttingDown = true;

  if (currentServer) {
    try { currentServer.once('exit', function () { setTimeout(function () { process.exit(0); }, 120); }); } catch (e) {}
  }

  setTimeout(function () { process.exit(0); }, 1200);
  setTimeout(function () { process.exit(0); }, 3000);
}

process.on('SIGINT', shutdownBySignal);
process.on('SIGBREAK', shutdownBySignal);
process.on('SIGHUP', shutdownBySignal);

function spawnServer(serverMode, openPage) {
  const args = [path.join(ROOT, 'server.js'), '--mode', serverMode, '--port', String(PORT)];
  if (HOST) args.push('--host', HOST);
  if (openPage) args.push('--open');

  try { fs.mkdirSync(path.dirname(FLAG), { recursive: true }); } catch (e) {}

  currentServer = spawn(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      // 告诉服务端：重启交给启动器，你自己别去拉新进程
      PORTAL_SUPERVISED: '1',
      PORTAL_UPDATE_FLAG: FLAG
    }
  });

  return currentServer;
}

async function waitUp(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await wait(250);
    if ((await ping()).ok) return true;
  }
  return false;
}

async function ensureServer(serverMode, openPage) {
  const alive = await ping();

  if (alive.ok) {
    log('端口 ' + PORT + ' 上已经有服务端在跑，直接复用（数据是同一份）');
    log('它当前的模式是「' + (MODE_TEXT[alive.mode] || alive.mode) + '」');

    if (alive.mode !== serverMode) {
      console.log('  想换成「' + MODE_TEXT[serverMode] + '」，先关掉那个服务端窗口再重新启动。');
    }
    if (openPage) openBrowser('http://' + probeHost() + ':' + PORT + '/');
    return null;
  }

  log('启动服务端（mode=' + serverMode + '，端口 ' + PORT + '）');
  const proc = spawnServer(serverMode, openPage);

  if (await waitUp(10000)) return proc;

  console.error('\n  ✗ 服务端起不来，检查端口 ' + PORT + ' 是否被别的程序占用\n');
  return proc;
}

/* 守着服务端：升级时它会退出（留个 pending 标记），
   等 runner 换完文件再按同样的参数拉起来 —— 端口、模式都不变。 */
async function supervise(srv, serverMode, openPage, hint) {
  let cur = srv;

  if (!cur) {
    console.log('\n  服务端已经在别的窗口跑着，这边不用守着。');
    return;
  }

  console.log('\n  ' + hint);

  while (cur) {
    await new Promise((resolve) => cur.on('exit', resolve));

    const flag = readFlag();
    if (!flag || flag.stage !== 'pending') break;

    log('服务端已退出，正在替换文件（' + (flag.from || '?') + ' -> ' + (flag.to || '?') + '）…');
    const done = await waitFlagDone(90000);
    clearFlag();

    if (!done) {
      console.error('\n  ✗ 更新没走完，请手动重新启动一次。');
      break;
    }

    log('文件已替换（v' + (done.version || flag.to || '?') + '），重新启动服务端…');
    cur = spawnServer(serverMode, openPage);

    if (!(await waitUp(15000))) {
      console.error('\n  ✗ 新版本没起来，看看 ' + path.join(ROOT, 'data', 'update.log'));
      break;
    }
  }
}

function clientDepsReady() {
  return fs.existsSync(path.join(ROOT, 'desktop', 'node_modules'));
}

/* 打开本机客户端。没装依赖不致命：别的机器上装好的客户端照样能连这个服务端 */
/* 本机装好的客户端（安装版 / 目录版 / 桌面上的便携版） */
function findInstalledClient() {
  const cands = [];

  const exe = '企业服务大厅.exe';
  const push = (dir) => { if (dir) cands.push(path.join(dir, exe)); };

  // NSIS 默认装到 %LOCALAPPDATA%\Programs\<产品名>
  if (process.env.LOCALAPPDATA) push(path.join(process.env.LOCALAPPDATA, 'Programs', '企业服务大厅'));
  if (process.env.ProgramFiles) push(path.join(process.env.ProgramFiles, '企业服务大厅'));
  if (process.env['ProgramFiles(x86)']) push(path.join(process.env['ProgramFiles(x86)'], '企业服务大厅'));

  // 目录版挨着源码放的、或者开发机打包出来的
  push(path.join(ROOT, '企业服务大厅'));
  push(path.join(ROOT, 'desktop', 'dist', 'win-unpacked'));

  const hit = cands.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (hit) return hit;

  // 桌面上放的便携版：文件名带版本号，且此刻没有被正在运行的客户端占用
  try {
    const desktop = path.join(os.homedir(), 'Desktop');
    const f = fs.readdirSync(desktop)
      .filter((n) => /^portal-portable-.*\.exe$/i.test(n))
      .sort()
      .pop();
    if (f) return path.join(desktop, f);
  } catch (e) {}

  return '';
}

function startClient(onExit, serverUrl, exePath) {
  const installed = exePath || findInstalledClient();

  if (installed) {
    log('启动桌面客户端：' + installed);

    const proc = spawn(installed, [], {
      cwd: path.dirname(installed),
      detached: false,
      stdio: "ignore",
      env: {
        ...process.env,
        // 让它直接连这个服务端，不用再填地址
        ...(serverUrl ? { PORTAL_SERVER: serverUrl } : {})
      }
    });

    proc.on("exit", (code) => {
      if (onExit) onExit(code);
      else process.exit(code || 0);
    });

    return proc;
  }

  // 没装 exe，但源码目录里有依赖：用开发模式跑
  if (clientDepsReady()) {
    log('启动桌面客户端（开发模式）');
    const proc = spawn(IS_WIN ? "npm.cmd" : "npm", ["--prefix", "desktop", "start"], {
      cwd: ROOT,
      stdio: "inherit",
      shell: IS_WIN,
      env: {
        ...process.env,
        ...(serverUrl ? { PORTAL_SERVER: serverUrl } : {})
      }
    });

    proc.on("exit", (code) => {
      if (onExit) onExit(code);
      else process.exit(code || 0);
    });

    return proc;
  }

  console.log('');
  console.log('  ! 这台机器上没找到桌面客户端');
  console.log('    装一个就行：发布包里的 portal-setup-x.y.z.exe（双击装完即可）');
  console.log('    或者把目录版解压到本目录下的「企业服务大厅」文件夹');
  console.log('');
  return null;
}function waitExit(proc) {
  return new Promise((resolve) => proc.on('exit', resolve));
}

/* mode: web | desktop | both | client */
async function run(mode, openPage) {
  // server：只起服务端，浏览器和客户端都能连，但不自动打开任何窗口
  if (mode === 'server') {
    const srv = await ensureServer('both', openPage);
    await supervise(srv, 'both', openPage, '服务端在跑，这个窗口别关（关了服务就停）。');
    return;
  }

  if (mode === 'client') {
    log('只打开桌面客户端（连已有的服务端）');

    // 本机这个端口上有服务端就把地址直接给它，没有就让它自己填
    const alive = await ping();
    const url = alive.ok ? 'http://' + probeHost() + ':' + PORT : '';
    if (url) console.log('  连：' + url);

    let exe = findInstalledClient();

    if (!exe) {
      // 装在别处也能用：直接问路径，比让用户去翻注册表简单
      const typed = (await ask('  客户端 exe 路径（回车 = 跳过）：') || '').replace(/^"|"$/g, '').trim();
      if (typed && fs.existsSync(typed)) exe = typed;
      else if (typed) console.log('  这个路径不存在：' + typed);
    }

    if (!startClient(undefined, url, exe)) process.exit(1);
    return;
  }

  const srv = await ensureServer(mode, openPage);
  const hint = '服务端在跑，这个窗口别关（关了服务就停）。';

  if (mode === 'both') {
    const client = startClient((code) => {
      if (srv) { try { srv.kill(); } catch (e) {} }
      process.exit(code || 0);
    }, 'http://127.0.0.1:' + PORT);

    if (client) {
      // 客户端开着的时候也要盯着服务端，不然升级后就没人把它拉起来了
      supervise(srv, mode, openPage, hint);
      return;
    }

    await supervise(srv, mode, openPage, hint);
    return;
  }

  await supervise(srv, mode, openPage, hint);
}

/* ---------------- 交互菜单 ---------------- */

/* 一个菜单共用一个 readline；输入被重定向（管道、批处理）时先整段读进来，
   否则第一问之后剩下的行会因为没人监听被丢掉 */
let rl = null;
let pipeLines = null;

function ask(question) {
  if (!process.stdin.isTTY) {
    if (!pipeLines) {
      try { pipeLines = fs.readFileSync(0, 'utf8').split(/\r?\n/).map((x) => x.trim()); }
      catch (e) { pipeLines = []; }
    }
    const a = pipeLines.length ? pipeLines.shift() : '';
    process.stdout.write(question + a + '\n');
    return Promise.resolve(a);
  }

  if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => resolve(String(ans || '').trim()));
  });
}

function closeAsk() {
  if (rl) { try { rl.close(); } catch (e) {} rl = null; }
}

/* 第一次启动没有 config.json：在这里问清楚，写一份出来，
   省得用户自己去找文件改、还改错格式 */
async function ensureConfig() {
  const file = path.join(ROOT, 'config.json');
  if (fs.existsSync(file)) return;

  console.log('');
  console.log('  第一次启动，先定一下服务端地址');
  console.log('  ------------------------------------------');

  const ips = localIPs();
  if (ips.length) console.log('  本机地址：' + ips.join(' / '));
  console.log('');

  const p = await ask('  端口 [8080]：');
  const port = Number(p) >= 1 && Number(p) <= 65535 ? Number(p) : 8080;

  const h = (await ask('  监听地址 [0.0.0.0 = 局域网都能连；127.0.0.1 = 只本机]：') || '').trim();
  const host = h || '0.0.0.0';

  const cfg = {
    _说明: '改完保存并重启服务生效。host 填 0.0.0.0 局域网可访问，填 127.0.0.1 只有本机能访问；port 取值 1-65535；mode 取 both（网页+桌面）/ web（仅网页）/ desktop（仅桌面客户端）。',
    port: port,
    host: host,
    mode: 'both'
  };

  try {
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    console.log('');
    console.log('  已生成 config.json：' + host + ':' + port);
    console.log('');
  } catch (e) {
    console.log('  ! 写不了 config.json（' + e.message + '），这次先用 ' + host + ':' + port + ' 启动');
  }

  PORT = port;
  HOST = host;
}

async function menu() {
  await ensureConfig();

  console.log('');
  console.log('  ============================================');
  console.log('    企业服务大厅  ' + (HOST || '0.0.0.0') + ':' + PORT);
  console.log('  ============================================');
  console.log('');
  console.log('    1      只开 web 服务端（浏览器能访问，客户端连不进来）');
  console.log('    2      只开客户端服务端（只服务桌面客户端，浏览器打开会被拒绝）');
  console.log('    3      web 服务端 + 客户端服务端（两种都能连）');
  console.log('    q      退出');
  console.log('');

  const ans = (await ask('  请选择 [回车 = 3 并打开浏览器]：') || '3').toLowerCase();

  if (ans === 'q' || ans === 'quit' || ans === 'exit') { closeAsk(); return; }

  if (ans === '1') {
    log('只开 web 服务端，端口 ' + PORT);
    return run('web', false);
  }

  if (ans === '2') {
    log('只开客户端服务端，端口 ' + PORT);
    return run('desktop', false);
  }

  log('web 服务端 + 客户端服务端，端口 ' + PORT + '，顺手打开浏览器');
  return run('server', true);
}

/* ---------------- 入口 ---------------- */

const argv = process.argv.slice(2);
const modeArg = argv.find((a) => !a.startsWith('-') &&
  ['web', 'desktop', 'both', 'client'].includes(a.toLowerCase()));
const portIdx = argv.indexOf('--port');
const portArg = portIdx > -1 ? argv[portIdx + 1] : '';
const hostIdx = argv.indexOf('--host');
const hostArg = hostIdx > -1 ? argv[hostIdx + 1] : '';

if (portArg) PORT = resolvePort(portArg);
if (hostArg) HOST = String(hostArg).trim();

if (modeArg) {
  const MODE = modeArg.toLowerCase();

  if (MODE === 'web') {
    log('仅网页版：浏览器可以访问，桌面客户端连不进来');
    await run('web', true);
  } else if (MODE === 'desktop') {
    log('仅桌面客户端服务端：浏览器会被拒绝，这里不打开客户端');
    await run('desktop', false);
  } else if (MODE === 'client') {
    await run('client');
  } else {
    log('网页版 + 桌面客户端');
    await run('both', true);
  }
} else {
  await menu();
}
