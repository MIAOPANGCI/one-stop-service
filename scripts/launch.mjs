#!/usr/bin/env node
/**
 * 一键启动：网页版 / 桌面客户端 / 两者
 *
 *   node scripts/launch.mjs web       仅网页版
 *   node scripts/launch.mjs desktop   仅桌面客户端
 *   node scripts/launch.mjs both      两者都启动（默认）
 *
 * 三种方式共用一个服务端进程、一份 data —— 桌面客户端只是连过去的壳，
 * 所以网页版和桌面版看到的永远是同一批数据。
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const MODE = (process.argv[2] || 'both').toLowerCase();

/* config.json 里的端口说了算，这里只负责探测有没有人在听 */
function port() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
    const p = Number(cfg.port);
    if (Number.isInteger(p) && p >= 1 && p <= 65535) return p;
  } catch (e) {}
  return Number(process.env.PORT) || 8080;
}

const PORT = port();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
          try { resolve(res.statusCode === 200 && JSON.parse(body).name === 'corp-portal'); }
          catch (e) { resolve(false); }
        });
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function log(msg) { console.log('\n  ' + msg); }

async function ensureServer(serverMode, openBrowser) {
  if (await ping()) {
    log('端口 ' + PORT + ' 上已经有服务端在跑，直接复用（数据是同一份）');
    return null;
  }

  const args = [path.join(ROOT, 'server.js'), '--mode', serverMode];
  if (openBrowser) args.push('--open');

  log('启动服务端（mode=' + serverMode + '，端口 ' + PORT + '）');
  const proc = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });

  for (let i = 0; i < 40; i++) {
    await wait(250);
    if (await ping()) return proc;
  }

  console.error('\n  ✗ 服务端起不来，检查端口 ' + PORT + ' 是否被别的程序占用\n');
  return proc;
}

function startClient() {
  const modules = path.join(ROOT, 'desktop', 'node_modules');
  if (!fs.existsSync(modules)) {
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

if (MODE === 'web') {
  log('仅网页版：浏览器可以访问，桌面客户端连不进来');
  await ensureServer('web', true);
} else if (MODE === 'desktop') {
  log('仅桌面客户端：浏览器打开会被拒绝');
  await ensureServer('desktop', false);
  startClient();
} else if (MODE === 'both') {
  log('网页版 + 桌面客户端');
  await ensureServer('both', true);
  startClient();
} else {
  console.error('\n  用法：node scripts/launch.mjs web|desktop|both\n');
  process.exit(1);
}
