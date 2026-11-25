#!/usr/bin/env node
/**
 * 一键启动：网页版 / 桌面客户端 / 两者
 *
 *   node scripts/launch.mjs          交互式菜单（start.bat 双击走这条）
 *   node scripts/launch.mjs web      仅网页版（服务端 + 浏览器）
 *   node scripts/launch.mjs desktop  仅桌面客户端服务端（不打开客户端）
 *   node scripts/launch.mjs both     服务端 + 浏览器 + 本机客户端
 *   node scripts/launch.mjs client   只打开本机客户端，连已有的服务端
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
let HOST = '';   // 空 = 用 config.json 里的，默认 0.0.0.0

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

function spawnServer(serverMode, openPage) {
  const args = [path.join(ROOT, 'server.js'), '--mode', serverMode, '--port', String(PORT)];
  if (HOST) args.push('--host', HOST);
  if (openPage) args.push('--open');

  try { fs.mkdirSync(path.dirname(FLAG), { recursive: true }); } catch (e) {}

  return spawn(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      // 告诉服务端：重启交给启动器，你自己别去拉新进程
      PORTAL_SUPERVISED: '1',
      PORTAL_UPDATE_FLAG: FLAG
    }
  });
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
function startClient(onExit) {
  if (!clientDepsReady()) {
    console.log('');
    console.log('  ! 本机没装客户端依赖（cd desktop && npm install），这次不打开客户端');
    console.log('    已经装好的「企业服务大厅」在别的机器上可以直接连这个服务端');
    console.log('');
    return null;
  }

  log('启动桌面客户端');
  const proc = spawn(IS_WIN ? 'npm.cmd' : 'npm', ['--prefix', 'desktop', 'start'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: IS_WIN,
    env: {
      ...process.env,
      // 客户端自己不起服务，这里把刚启动的服务端直接告诉它，首次也不会弹引导
      PORTAL_SERVER: 'http://127.0.0.1:' + PORT
    }
  });

  proc.on('exit', (code) => {
    if (onExit) onExit(code);
    else process.exit(code || 0);
  });

  return proc;
}

function waitExit(proc) {
  return new Promise((resolve) => proc.on('exit', resolve));
}

/* mode: web | desktop | both | client */
async function run(mode, openPage) {
  if (mode === 'client') {
    log('只打开桌面客户端（连已有的服务端）');
    if (!startClient()) process.exit(1);
    return;
  }

  const srv = await ensureServer(mode, openPage);
  const hint = '服务端在跑，这个窗口别关（关了服务就停）。';

  if (mode === 'both') {
    const client = startClient((code) => {
      if (srv) { try { srv.kill(); } catch (e) {} }
      process.exit(code || 0);
    });

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

async function menu() {
  console.log('');
  console.log('  ============================================');
  console.log('    企业服务大厅 · 启动方式');
  console.log('  ============================================');
  console.log('');
  console.log('    1  仅网页版            浏览器可访问，桌面客户端连不进来');
  console.log('    2  仅桌面客户端服务端  只服务客户端（浏览器 403），不在这里开客户端');
  console.log('    3  两者都启动          服务端 + 浏览器 + 本机客户端');
  console.log('    4  只打开桌面客户端    连已有的服务端，不启动服务端');
  console.log('    5  自定义端口          先填端口，再选模式');
  console.log('    q  退出');
  console.log('');

  const ans = (await ask('  请选择 [1-5，默认 3]：') || '3').toLowerCase();

  if (ans === 'q' || ans === 'quit' || ans === 'exit') { closeAsk(); return; }

  if (ans === '1') {
    log('仅网页版：浏览器可以访问，桌面客户端连不进来');
    return run('web', true);
  }

  if (ans === '2') {
    log('仅桌面客户端服务端：浏览器会被拒绝，这里不打开客户端');
    return run('desktop', false);
  }

  if (ans === '4') return run('client');

  if (ans === '5') {
    const p = await ask('  端口号 [默认 ' + PORT + ']：');
    PORT = resolvePort(p || PORT);

    const ips = localIPs();
    if (ips.length) console.log('  本机地址：' + ips.join(' / '));

    const h = await ask('  监听地址 [回车 = 0.0.0.0 全部网卡；127.0.0.1 仅本机；也可填上面某个 IP]：');
    HOST = String(h || '').trim() || '0.0.0.0';

    const m = (await ask('  模式 [1 仅网页 / 2 仅桌面 / 3 两者，默认 3]：') || '3').trim();
    const mode = m === '1' ? 'web' : m === '2' ? 'desktop' : 'both';

    log('端口 ' + PORT + ' · 监听 ' + HOST + ' · ' + MODE_TEXT[mode]);
    return run(mode, mode !== 'desktop');
  }

  if (ans === '3') {
    log('网页版 + 桌面客户端');
    return run('both', true);
  }

  log('没看懂「' + ans + '」，按「两者都启动」处理');
  return run('both', true);
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
