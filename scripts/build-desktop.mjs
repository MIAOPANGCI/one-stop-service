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

// 图标是拿 desktop/build/icon-src.png 现算的，没有就补一次
if (!fs.existsSync(path.join(DESK, 'build', 'icon.ico'))) {
  console.log('  图标不存在，先从 icon-src.png 生成');
  const ic = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'make-icon.mjs')], { stdio: 'inherit' });
  if (ic.status !== 0) {
    console.error('\n  ✗ 生成图标失败，检查 desktop/build/icon-src.png\n');
    process.exit(1);
  }
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

/* 额外打一个「目录版」：解压出来直接双击 exe，启动快、不写入注册表，
   适合固定办公电脑。便携版每次双击都要先解压到临时目录，启动慢。 */
(function packUnpacked() {
  const src = path.join(dist, 'win-unpacked');
  if (!fs.existsSync(src)) return;

  const sevenZip = path.join(DESK, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
  const out = path.join(dist, 'portal-unpacked-' + rootPkg.version + '.zip');
  try { fs.rmSync(out, { force: true }); } catch (e) {}

  const argv = ['a', '-tzip', '-mx=1', '-bso0', '-bsp0', out, '*'];
  const bin = fs.existsSync(sevenZip) ? sevenZip : '7z';
  const res = spawnSync(bin, argv, { cwd: src, stdio: 'ignore' });

  if (res.status === 0 && fs.existsSync(out)) {
    console.log('  已打包目录版：' + path.basename(out));
  } else {
    console.log('  ! 目录版打包失败，跳过（不影响 exe）');
  }
})();

const files = fs.existsSync(dist)
  ? fs.readdirSync(dist).filter((f) => f.endsWith('.exe'))
  : [];

console.log('\n  ------------------------------------------');
files.forEach((f) => {
  const size = fs.statSync(path.join(dist, f)).size;
  console.log('  ' + f + '  ' + (size / 1048576).toFixed(1) + ' MB');
});
console.log('  位置：' + dist + '\n');
