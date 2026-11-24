#!/usr/bin/env node
/**
 * 打包并发布到 GitHub Releases
 *
 *   node scripts/release.mjs            打包 + 打 tag + 发布
 *   node scripts/release.mjs --dry      只打包，不碰远端
 *   node scripts/release.mjs --notes "自定义更新说明"
 *
 * 版本号取自 package.json。要求工作区干净（先 commit），否则打出来的包和 tag 对不上。
 * 凭据优先读 GITHUB_TOKEN 环境变量，没有就用 git credential 里存的。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execSync } from 'node:child_process';
import zlib from 'node:zlib';
import https from 'node:https';

const OWNER = process.env.RELEASE_OWNER || 'MIAOPANGCI';
const REPO = process.env.RELEASE_REPO || 'one-stop-service';
const SLUG = `${OWNER}/${REPO}`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, '.release');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const NOTES_ARG = (() => {
  const i = args.indexOf('--notes');
  return i > -1 ? args[i + 1] || '' : '';
})();

/* ---------------- 小工具 ---------------- */

function run(cmd, argv, opts = {}) {
  return execFileSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();
}

function step(msg) { console.log('\n› ' + msg); }
function ok(msg) { console.log('  ✓ ' + msg); }
function warn(msg) { console.log('  ! ' + msg); }
function die(msg) { console.error('\n✗ ' + msg + '\n'); process.exit(1); }

/* ---------------- 自己打包 zip ----------------
   Windows 自带的压缩命令会在条目名里写反斜杠，
   Linux / macOS 上解出来是一个文件名带 \ 的东西，而不是目录结构。
   这里按规范写正斜杠 + deflate，跨平台解压都正常。 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

/* files: [{ name, data }]，name 用正斜杠 */
function zipFiles(files) {
  const { time, date } = dosTime(new Date());

  const locals = [];
  const centrals = [];
  let offset = 0;

  files.forEach((f) => {
    const nameBuf = Buffer.from(String(f.name).replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const packed = zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);            // version needed
    lh.writeUInt16LE(0x0800, 6);        // 文件名是 UTF-8
    lh.writeUInt16LE(8, 8);             // deflate
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(packed.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);

    locals.push(lh, nameBuf, packed);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);            // version made by
    ch.writeUInt16LE(20, 6);            // version needed
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(packed.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(0, 30);            // extra
    ch.writeUInt32LE(0, 32);            // comment
    ch.writeUInt16LE(0, 34);            // disk
    ch.writeUInt16LE(0, 36);            // internal attrs
    ch.writeUInt32LE(0o644 << 16, 38);  // external attrs：普通文件
    ch.writeUInt32LE(offset, 42);

    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + packed.length;
  });

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const out = execSync('git credential fill', {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      cwd: ROOT
    });
    const m = out.match(/^password=(.+)$/m);
    return m ? m[1].trim() : '';
  } catch (e) {
    return '';
  }
}

function api(method, urlPath, { token, body, contentType = 'application/json', raw = null } = {}) {
  return new Promise((resolve, reject) => {
    const host = urlPath.startsWith('https://uploads.github.com') ? 'uploads.github.com' : 'api.github.com';
    const p = urlPath.replace(/^https:\/\/[^/]+/, '');
    const payload = raw || (body ? Buffer.from(JSON.stringify(body)) : null);

    const req = https.request({
      host,
      path: p,
      method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'corp-portal-release',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(payload ? { 'Content-Type': contentType, 'Content-Length': payload.length } : {})
      }
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (e) { parsed = null; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error(`${method} ${p} → ${res.statusCode} ${data.slice(0, 200)}`));
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* ---------------- 开始 ---------------- */

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = 'v' + version;
const zipName = `one-stop-service-${tag}.zip`;

console.log('\n  企业服务大厅 · 发布 ' + tag);
console.log('  ------------------------------------------');

/* 1. 工作区必须干净 */
step('检查工作区');
const dirty = run('git', ['status', '--porcelain']);
if (dirty) {
  warn('有未提交的改动：');
  console.log(dirty.split('\n').slice(0, 10).map(l => '    ' + l).join('\n'));
  die('请先提交，否则打出来的包和 tag 对应不上。');
}
ok('工作区干净');

/* 2. 收集文件：只拿 git 已跟踪的，天然排除 data/ config.json */
step('收集要打包的文件');
const tracked = run('git', ['ls-files']).split('\n').filter(Boolean);
if (!tracked.length) die('git 里没有文件。');

ok(tracked.length + ' 个文件');

/* 3. 打 zip */
step('打包');
fs.mkdirSync(OUT_DIR, { recursive: true });
const zipPath = path.join(OUT_DIR, zipName);
fs.rmSync(zipPath, { force: true });

const entries = tracked.map((f) => ({
  name: 'one-stop-service/' + f.split(path.sep).join('/'),
  data: fs.readFileSync(path.join(ROOT, f))
}));
fs.writeFileSync(zipPath, zipFiles(entries));

const size = fs.statSync(zipPath).size;
ok(zipName + '  ' + (size / 1024).toFixed(0) + ' KB');

if (DRY) {
  console.log('\n  --dry：只打了包，没有动远端。\n  位置：' + zipPath + '\n');
  process.exit(0);
}

/* 4. 打 tag 并推送 */
step('打 tag ' + tag);
if (run('git', ['tag', '--list', tag])) {
  warn('本地已存在同名 tag，覆盖');
  run('git', ['tag', '-d', tag]);
}
run('git', ['tag', '-a', tag, '-m', 'Release ' + tag]);
run('git', ['push', 'origin', 'HEAD']);
run('git', ['push', 'origin', tag, '--force']);
ok('已推送 tag');

/* 5. 创建 Release */
step('创建 Release');
const token = getToken();
if (!token) die('拿不到 GitHub 凭据。设置 GITHUB_TOKEN 环境变量，或先 git push 一次让凭据写入。');

/* 上一个版本 tag：更新说明只列这之后的新提交，不重复带以前的 */
function previousTag() {
  const candidates = ['HEAD^', 'HEAD'];
  for (const rev of candidates) {
    try {
      const t = run('git', ['describe', '--tags', '--abbrev=0', rev]);
      if (t && t !== tag) return t;
    } catch (e) { /* 还没打过 tag */ }
  }
  return '';
}

const prevTag = previousTag();
const range = prevTag ? `${prevTag}..HEAD` : '-12';
const commits = run('git', ['log', '--pretty=format:- %s', range]).trim();

const notes = NOTES_ARG || [
  '## 更新内容',
  '',
  commits || '- 细节调整',
  '',
  prevTag ? `从 ${prevTag} 升级。` : '',
  '',
  '## 桌面客户端',
  '',
  '附件里的 portal-setup-x.y.z.exe 是 Windows 安装包（内置浏览器内核，能打开禁止被 iframe 内嵌的系统）；',
  'portal-portable-x.y.z.exe 是免安装版，解压即用。',
  '',
  '## 升级方式',
  '',
  '**方式一（推荐）**：在大厅「设置 → 检查更新」里点「立即更新」，会自动下载、替换并重启，`data/` 和 `config.json` 原样保留。',
  '',
  '**方式二（手动）**：',
  '',
  '1. 下载下面的 zip，解压',
  '2. 备份自己的 `data/` 和 `config.json`',
  '3. 用新文件覆盖旧的（保留 `data/`、`config.json`）',
  '4. 重启服务'
].filter(s => s !== null && s !== undefined).filter((s, i, arr) => !(s === '' && arr[i - 1] === '')).join('\n');

let release = null;
try {
  release = await api('GET', `/repos/${SLUG}/releases/tags/${tag}`, { token });
  warn('该 tag 已有 Release，先删掉重建');
  await api('DELETE', `/repos/${SLUG}/releases/${release.id}`, { token });
  release = null;
} catch (e) { /* 404，正常 */ }

release = await api('POST', `/repos/${SLUG}/releases`, {
  token,
  body: {
    tag_name: tag,
    name: '企业服务大厅 ' + tag,
    body: notes,
    draft: false,
    prerelease: false
  }
});
ok('Release 已创建：' + release.html_url);

/* 6. 上传附件：源码包 + 桌面端安装包（如果打过） */
step('上传附件');

async function uploadAsset(filePath, name, contentType) {
  const bin = fs.readFileSync(filePath);
  const size = (bin.length / 1048576).toFixed(1);
  process.stdout.write('  · ' + name + '  ' + size + ' MB … ');
  const asset = await api('POST',
    `https://uploads.github.com/repos/${SLUG}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
    { token, raw: bin, contentType }
  );
  console.log('ok');
  return asset;
}

const uploaded = [];
uploaded.push(await uploadAsset(zipPath, zipName, 'application/zip'));

const distDir = path.join(ROOT, 'desktop', 'dist');
if (fs.existsSync(distDir)) {
  const exes = fs.readdirSync(distDir).filter(f => /\.exe$/i.test(f));
  for (const f of exes) {
    uploaded.push(await uploadAsset(path.join(distDir, f), f, 'application/octet-stream'));
  }
  if (!exes.length) warn('desktop/dist 里没有 exe，跳过桌面端附件');
} else {
  warn('没有 desktop/dist，跳过桌面端附件');
}

ok('共上传 ' + uploaded.length + ' 个文件');

console.log('\n  ------------------------------------------');
console.log('  发布完成 ' + tag);
console.log('  ' + release.html_url);
console.log('');
