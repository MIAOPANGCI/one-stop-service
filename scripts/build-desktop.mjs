#!/usr/bin/env node
/**
 * 打包桌面客户端
 *
 *   npm run build:desktop
 *
 * 先用根 package.json 的版本号同步 desktop/package.json，再交给 electron-builder。
 * 产物在 desktop/dist/：安装包（portal-setup-x.y.z.exe）和绿色版（portal-portable-x.y.z.exe）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESK = path.join(ROOT, 'desktop');

const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const deskPkgPath = path.join(DESK, 'package.json');
const deskPkg = JSON.parse(fs.readFileSync(deskPkgPath, 'utf8'));

if (deskPkg.version !== rootPkg.version) {
  deskPkg.version = rootPkg.version;
  fs.writeFileSync(deskPkgPath, JSON.stringify(deskPkg, null, 2) + '\n');
  console.log('  版本同步为 ' + rootPkg.version);
}

if (!fs.existsSync(path.join(DESK, 'build', 'icon.ico'))) {
  console.error('\n  ✗ 缺少 desktop/build/icon.ico，先跑一次 desktop/make-icon.ps1 再转 ico\n');
  process.exit(1);
}

if (!fs.existsSync(path.join(DESK, 'node_modules', 'electron-builder'))) {
  console.error('\n  ✗ 没装 electron-builder，先执行：cd desktop && npm install\n');
  process.exit(1);
}

console.log('\n  打包桌面客户端 v' + rootPkg.version);
console.log('  ------------------------------------------');

const r = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron-builder', '--win'],
  {
    cwd: DESK,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      // 两个镜像都必须给：构建时 @electron/get 还要拉 SHASUMS256.txt，走 GitHub 会卡死
      ELECTRON_BUILDER_BINARIES_MIRROR: process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
        'https://npmmirror.com/mirrors/electron-builder-binaries/',
      ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/'
    }
  }
);

if (r.status !== 0) {
  console.error('\n  ✗ 打包失败，退出码 ' + r.status + '\n');
  process.exit(r.status || 1);
}

const dist = path.join(DESK, 'dist');
const files = fs.existsSync(dist)
  ? fs.readdirSync(dist).filter((f) => f.endsWith('.exe'))
  : [];

console.log('\n  ------------------------------------------');
files.forEach((f) => {
  const size = fs.statSync(path.join(dist, f)).size;
  console.log('  ' + f + '  ' + (size / 1048576).toFixed(1) + ' MB');
});
console.log('  位置：' + dist + '\n');
