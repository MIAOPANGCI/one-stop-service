/* ============================================================
 * 企业服务大厅  —  服务端
 * ------------------------------------------------------------
 * 零第三方依赖，只需 Node.js >= 16：
 *     node server.js
 *
 * 数据文件： data/portal.json      （自动创建，含用户、链接、设置）
 * 自动备份： data/backups/          （保留最近 40 份）
 *
 * 启动方式（优先级：命令行 > 环境变量 > config.json）：
 *     node server.js --port 9000 --host 192.168.1.100
 *     PORT=9000 HOST=0.0.0.0 node server.js
 *     直接改 config.json 里的 port / host
 *
 * 环境变量：
 *     PORT=8080             监听端口
 *     HOST=0.0.0.0          监听地址（0.0.0.0 局域网可访问，127.0.0.1 仅本机）
 *     ADMIN_USER=admin      初始管理员账号
 *     ADMIN_PASSWORD=xxx    初始管理员密码（默认 admin123）
 *     COOKIE_SECURE=1       走 HTTPS 时开启
 * ============================================================ */

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;

/* 版本号唯一来源是 package.json */
const VERSION = (function () {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0'; }
  catch (e) { return '0.0.0'; }
})();

/* 更新检查指向的仓库 */
const REPO_SLUG = 'MIAOPANGCI/one-stop-service';
const UPDATE_TTL = 30 * 60 * 1000;   // 30 分钟内复用结果，避免打爆 GitHub 限流
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'portal.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const BACKUP_KEEP = 40;

/* ---------- 启动配置：命令行 > 环境变量 > config.json ---------- */
const CONFIG_FILE = path.join(ROOT, 'config.json');

function getArg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return '';
  const v = process.argv[i + 1];
  return v && v.charAt(0) !== '-' ? v : '';
}

function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, '');
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : null;
  } catch (e) {
    console.warn('[配置] config.json 解析失败，已忽略：' + e.message);
    return null;
  }
}

/* 第一次启动自动生成一份，用户直接改这个文件即可 */
function ensureConfig(hasConfig) {
  if (hasConfig || fs.existsSync(CONFIG_FILE)) return;
  try {
    const sample = {
      _说明: '改完保存并重启服务生效。host 填 0.0.0.0 局域网可访问，填 127.0.0.1 只有本机能访问；port 取值 1-65535。',
      port: 8080,
      host: '0.0.0.0'
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(sample, null, 2) + '\n', 'utf8');
  } catch (e) {}
}

function pickPort(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 0;
}

const CFG = readConfig();
ensureConfig(CFG);

const PORT = pickPort(getArg('--port')) || pickPort(process.env.PORT) || pickPort(CFG && CFG.port) || 8080;
const HOST = String(getArg('--host') || process.env.HOST || (CFG && CFG.host) || '0.0.0.0').trim();
const AUTO_OPEN = process.argv.indexOf('--open') > -1;
const ADMIN_USER = (process.env.ADMIN_USER || 'admin').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';

const SESSION_COOKIE = 'cp_sid';
const SESSION_TTL_SHORT = 12 * 3600 * 1000;        // 不勾选"保持登录"：12 小时
const SESSION_TTL_LONG = 30 * 24 * 3600 * 1000;    // 勾选：30 天
const SESSION_FILE = path.join(DATA_DIR, 'sessions.json');
const MAX_SESSIONS_PER_USER = 8;
const MAX_USERS = 200;
const ROLES = ['admin', 'editor', 'viewer'];
const ROLE_LABEL = { admin: '管理员', editor: '编辑者', viewer: '浏览者' };

const PALETTE_FALLBACK = '#2fa795';

/* ------------------------------------------------------------
 * 通用工具
 * ---------------------------------------------------------- */
function uid(prefix) {
  return (prefix || 'l') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function pad2(n) { return String(n).padStart(2, '0'); }

function nowIso() { return new Date().toISOString(); }

function cleanText(v, max) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

function cleanUrl(v) {
  const s = cleanText(v, 500);
  if (!s) return '';
  if (/^(javascript|data|vbscript|file):/i.test(s)) return '';
  if (s.charAt(0) === '/') return s;
  if (!/^https?:\/\//i.test(s)) return 'http://' + s.replace(/^\/+/, '');
  return s;
}

function cleanHexColor(v, fallback) {
  const s = String(v || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
}

function cleanColor(v) { return cleanHexColor(v, PALETTE_FALLBACK); }

/* ------------------------------------------------------------
 * 密码与会话
 * ---------------------------------------------------------- */
function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pwd), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(pwd, salt, hash) {
  try {
    const h = crypto.scryptSync(String(pwd), String(salt), 64);
    const old = Buffer.from(String(hash), 'hex');
    return h.length === old.length && crypto.timingSafeEqual(h, old);
  } catch (e) {
    return false;
  }
}

const sessions = new Map();   // token -> { uid, exp }
const loginFails = new Map(); // ip -> { count, until }

/* 会话落盘：服务重启后仍保持登录 */
function loadSessions() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    const now = Date.now();
    Object.keys(raw || {}).forEach(function (k) {
      const v = raw[k];
      if (v && v.uid && v.exp > now) sessions.set(k, { uid: v.uid, exp: v.exp });
    });
    if (sessions.size) console.log('[会话] 已恢复 ' + sessions.size + ' 个登录状态');
  } catch (e) {
    console.warn('[会话] 读取失败：' + e.message);
  }
}

function saveSessions() {
  try {
    ensureDirs();
    const now = Date.now();
    const obj = {};
    sessions.forEach(function (v, k) { if (v.exp > now) obj[k] = v; });
    const tmp = SESSION_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
    fs.renameSync(tmp, SESSION_FILE);
  } catch (e) {
    console.warn('[会话] 写入失败：' + e.message);
  }
}

function createSession(userId, ttl) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { uid: userId, exp: Date.now() + (ttl || SESSION_TTL_SHORT) });

  // 同一账号只保留最近的若干个会话，避免无限堆积
  const mine = [];
  sessions.forEach(function (v, k) { if (v.uid === userId) mine.push(k); });
  if (mine.length > MAX_SESSIONS_PER_USER) {
    mine.slice(0, mine.length - MAX_SESSIONS_PER_USER).forEach(function (k) { sessions.delete(k); });
  }

  saveSessions();
  return token;
}

function dropUserSessions(userId, keepToken) {
  let changed = false;
  sessions.forEach(function (v, k) {
    if (v.uid === userId && k !== keepToken) { sessions.delete(k); changed = true; }
  });
  if (changed) saveSessions();
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach(function (part) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function currentUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(token); return null; }
  const u = db.users.find(function (x) { return x.id === s.uid; });
  if (!u || !u.enabled) return null;
  return u;
}

function sessionToken(req) {
  return parseCookies(req)[SESSION_COOKIE] || '';
}

function publicUser(u) {
  return {
    id: u.id, username: u.username, name: u.name || '', role: u.role,
    enabled: u.enabled !== false, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null,
    theme: ['system', 'light', 'dark'].indexOf(u.theme) > -1 ? u.theme : 'system'
  };
}

/* ------------------------------------------------------------
 * 初始数据
 * ---------------------------------------------------------- */
const DEFAULT_SETTINGS = {
  company: '示例科技有限公司',
  companyEn: 'CORP · SERVICE PORTAL',
  slogan: '一站式内部服务平台',
  logo: '企',
  logoImage: '',
  brandColor: '#2fa795',
  heroImage: '',
  heroImageDark: '',
  heroFoot: '我们为你准备了丰富的内部服务',
  netMode: 'auto',
  probeUrls: [],
  openInNewTab: true,
  requireLogin: true,
  updatedAt: null
};

const SEED = [
  { name: 'OA 协同办公', desc: '审批、公文、考勤与日程', cat: '办公协同', icon: '📋', color: '#1c6fd6', urlLan: 'http://192.168.1.10:8080', urlWan: 'https://oa.example.com' },
  { name: '企业邮箱', desc: '收发邮件、共享日历', cat: '办公协同', icon: '📧', color: '#0891b2', urlLan: 'http://mail.corp.local', urlWan: 'https://mail.example.com' },
  { name: '即时通讯', desc: '内部消息与工作群组', cat: '办公协同', icon: '💬', color: '#2fa795', urlLan: '', urlWan: 'https://im.example.com' },
  { name: '知识库', desc: '制度文档、技术沉淀', cat: '办公协同', icon: '🧠', color: '#7c3aed', urlLan: 'http://192.168.1.20:3000', urlWan: 'https://wiki.example.com' },
  { name: '会议预约', desc: '会议室查询与预定', cat: '办公协同', icon: '📅', color: '#d97706', urlLan: 'http://192.168.1.21:8090', urlWan: '' },
  { name: '公文流转', desc: '发文、收文与归档', cat: '办公协同', icon: '🗂', color: '#5b6bd6', urlLan: 'http://192.168.1.22', urlWan: 'https://doc.example.com' },
  { name: '企业网盘', desc: '部门共享文件与权限', cat: '办公协同', icon: '📁', color: '#0f766e', urlLan: 'http://192.168.1.70', urlWan: 'https://file.example.com' },
  { name: '日程协同', desc: '团队日程与提醒', cat: '办公协同', icon: '💡', color: '#be185d', urlLan: 'http://192.168.1.23:8081', urlWan: '' },

  { name: 'GitLab', desc: '代码仓库与合并请求', cat: '研发', icon: '📦', color: '#d97706', urlLan: 'http://192.168.1.30:8929', urlWan: 'https://git.example.com' },
  { name: 'Jenkins', desc: '持续集成与自动发布', cat: '研发', icon: '🧰', color: '#c0392b', urlLan: 'http://192.168.1.31:8080', urlWan: '' },
  { name: '禅道', desc: '需求、任务与缺陷跟踪', cat: '研发', icon: '🧪', color: '#1c6fd6', urlLan: 'http://192.168.1.32', urlWan: 'https://zentao.example.com' },
  { name: '测试环境', desc: '预发布环境入口', cat: '研发', icon: '🚀', color: '#2fa795', urlLan: 'http://192.168.1.40:9090', urlWan: '' },
  { name: '制品库', desc: '镜像与依赖包管理', cat: '研发', icon: '🔗', color: '#334155', urlLan: 'http://192.168.1.33:8081', urlWan: '' },
  { name: '接口文档', desc: '接口定义与调试', cat: '研发', icon: '🌐', color: '#5b6bd6', urlLan: 'http://192.168.1.34:8000', urlWan: 'https://api-doc.example.com' },
  { name: '日志平台', desc: '全链路日志检索', cat: '研发', icon: '🔧', color: '#0f766e', urlLan: 'http://192.168.1.35:5601', urlWan: '' },

  { name: '财务报账', desc: '费用报销、发票查验', cat: '财务', icon: '🧾', color: '#d97706', urlLan: 'http://192.168.1.50:7001', urlWan: 'https://fin.example.com' },
  { name: 'ERP 系统', desc: '采购、库存、成本核算', cat: '财务', icon: '🏭', color: '#5b6bd6', urlLan: 'http://192.168.1.51', urlWan: '' },
  { name: '发票查验', desc: '增值税发票核验', cat: '财务', icon: '🧮', color: '#c0392b', urlLan: 'http://192.168.1.52:9000', urlWan: 'https://invoice.example.com' },
  { name: '预算管理', desc: '年度预算编制与执行', cat: '财务', icon: '📊', color: '#0891b2', urlLan: 'http://192.168.1.53', urlWan: '' },

  { name: '监控大盘', desc: 'Grafana 指标与告警', cat: '运维', icon: '📈', color: '#2fa795', urlLan: 'http://192.168.1.60:3000', urlWan: 'https://monitor.example.com' },
  { name: '堡垒机', desc: '服务器登录与审计', cat: '运维', icon: '🔐', color: '#c0392b', urlLan: 'http://192.168.1.61', urlWan: '' },
  { name: 'CMDB', desc: '资产台账与拓扑', cat: '运维', icon: '🗂', color: '#7c3aed', urlLan: 'http://192.168.1.62:8088', urlWan: '' },
  { name: '工单系统', desc: 'IT 报修与处理进度', cat: '运维', icon: '🔧', color: '#1c6fd6', urlLan: 'http://192.168.1.63', urlWan: 'https://itsm.example.com' },
  { name: '备份平台', desc: '备份任务与恢复', cat: '运维', icon: '📦', color: '#334155', urlLan: 'http://192.168.1.64:8443', urlWan: '' },
  { name: '网络设备', desc: '交换机与防火墙管理', cat: '运维', icon: '🌐', color: '#0f766e', urlLan: 'http://192.168.1.1', urlWan: '' },

  { name: '人事系统', desc: '花名册、调岗与合同', cat: '人事', icon: '🏢', color: '#5b6bd6', urlLan: 'http://192.168.1.80:8080', urlWan: 'https://hr.example.com' },
  { name: '考勤打卡', desc: '打卡记录与请假', cat: '人事', icon: '📅', color: '#2fa795', urlLan: 'http://192.168.1.81', urlWan: 'https://attend.example.com' },
  { name: '招聘平台', desc: '简历、面试与入职', cat: '人事', icon: '💡', color: '#be185d', urlLan: '', urlWan: 'https://hire.example.com' },

  { name: '公司官网', desc: '对外展示站点', cat: '对外服务', icon: '🏢', color: '#1c6fd6', urlLan: '', urlWan: 'https://www.example.com' },
  { name: '客户门户', desc: '客户下单与售后', cat: '对外服务', icon: '🛒', color: '#d97706', urlLan: '', urlWan: 'https://customer.example.com' },
  { name: '供应商协同', desc: '采购订单与对账', cat: '对外服务', icon: '🔗', color: '#0f766e', urlLan: '', urlWan: 'https://srm.example.com' }
];

function makeAdmin(username, password, name) {
  const h = hashPassword(password);
  return {
    id: uid('u'),
    username: username,
    name: name || '系统管理员',
    role: 'admin',
    salt: h.salt,
    hash: h.hash,
    enabled: true,
    createdAt: nowIso(),
    lastLoginAt: null,
    pwdChangedAt: null,
    theme: 'system'
  };
}

function defaultDb() {
  return {
    version: 2,
    settings: Object.assign({}, DEFAULT_SETTINGS, { updatedAt: nowIso() }),
    links: SEED.map(function (s, i) {
      return {
        id: uid() + i,
        name: s.name, desc: s.desc, cat: s.cat, icon: s.icon, color: s.color,
        urlLan: s.urlLan, urlWan: s.urlWan, createdAt: nowIso()
      };
    }),
    users: [makeAdmin(ADMIN_USER, ADMIN_PASSWORD)]
  };
}

/* ------------------------------------------------------------
 * 数据层
 * ---------------------------------------------------------- */
let db = null;
let writing = false;

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function loadDb() {
  ensureDirs();
  let firstRun = false;

  try {
    if (!fs.existsSync(DATA_FILE)) {
      db = defaultDb();
      firstRun = true;
      persist(true);
    } else {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (!parsed || !Array.isArray(parsed.links)) throw new Error('数据文件格式不正确');
      parsed.settings = Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {});
      db = parsed;

      // 老版本数据没有 users，补一个管理员
      if (!Array.isArray(db.users) || !db.users.length) {
        db.users = [makeAdmin(ADMIN_USER, ADMIN_PASSWORD)];
        persist(true);
        firstRun = true;
      }
    }
  } catch (e) {
    console.error('[数据] 读取失败：' + e.message + '，已使用默认数据');
    try { fs.copyFileSync(DATA_FILE, DATA_FILE + '.broken-' + Date.now()); } catch (_) {}
    db = defaultDb();
    firstRun = true;
    persist(true);
  }

  if (firstRun) {
    console.log('');
    console.log('  ┌──────────────────────────────────────────────┐');
    console.log('  │  初始管理员账号已创建                          │');
    console.log('  │  账号：' + padRight(ADMIN_USER, 36) + '│');
    console.log('  │  密码：' + padRight(ADMIN_PASSWORD, 36) + '│');
    console.log('  │  请登录后立即修改密码                          │');
    console.log('  └──────────────────────────────────────────────┘');
    console.log('');
  }
}

function padRight(s, n) {
  s = String(s);
  let len = 0;
  for (let i = 0; i < s.length; i++) len += s.charCodeAt(i) > 255 ? 2 : 1;
  let out = s;
  while (len < n) { out += ' '; len++; }
  return out;
}

function backup() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const d = new Date();
    const stamp = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' +
      pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
    fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, 'portal-' + stamp + '.json'));

    const files = fs.readdirSync(BACKUP_DIR).filter(function (f) { return /^portal-.*\.json$/.test(f); }).sort();
    while (files.length > BACKUP_KEEP) {
      const old = files.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch (_) {}
    }
  } catch (e) {
    console.warn('[备份] 失败：' + e.message);
  }
}

function persist(skipBackup) {
  if (writing) return;
  writing = true;
  try {
    ensureDirs();
    if (!skipBackup) backup();
    db.settings.updatedAt = nowIso();
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.error('[数据] 写入失败：' + e.message);
    throw e;
  } finally {
    writing = false;
  }
}

/* ------------------------------------------------------------
 * 更新检查：向 GitHub 要最新 Release，30 分钟内复用结果
 * ---------------------------------------------------------- */
let updateCache = { at: 0, data: null };
let updateBusy = null;

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

/* 只用固定地址，不接受外部传入，避免被当成 SSRF 跳板 */
function httpsJson(url, timeoutMs) {
  return new Promise(function (resolve) {
    let done = false;
    const finish = function (v) { if (!done) { done = true; resolve(v); } };

    if (process.env.DISABLE_UPDATE_CHECK === '1') return finish({ disabled: true });

    const req = https.get(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'corp-portal/' + VERSION
      }
    }, function (res) {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { if (body.length < 200000) body += c; });
      res.on('end', function () {
        try { finish({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { finish({ status: res.statusCode, data: null }); }
      });
    });

    req.setTimeout(timeoutMs, function () { req.destroy(); finish(null); });
    req.on('error', function () { finish(null); });
  });
}

function checkUpdate(force) {
  const now = Date.now();

  if (!force && updateCache.data && now - updateCache.at < UPDATE_TTL) {
    return Promise.resolve(updateCache.data);
  }
  if (updateBusy) return updateBusy;

  updateBusy = httpsJson('https://api.github.com/repos/' + REPO_SLUG + '/releases/latest', 8000)
    .then(function (r) {
      const rel = r && r.data;
      let out;

      if (r && r.disabled) {
        out = { ok: false, current: VERSION, reason: 'disabled', checkedAt: now };
      } else if (!rel || !rel.tag_name) {
        out = { ok: false, current: VERSION, reason: 'unreachable', checkedAt: now };
      } else {
        const latest = String(rel.tag_name).replace(/^v/i, '');
        const asset = (rel.assets || [])[0];
        out = {
          ok: true,
          current: VERSION,
          latest: latest,
          hasUpdate: cmpVersion(latest, VERSION) > 0,
          name: rel.name || rel.tag_name,
          publishedAt: rel.published_at || '',
          notes: String(rel.body || '').slice(0, 4000),
          url: rel.html_url || '',
          download: asset ? asset.browser_download_url : '',
          checkedAt: now
        };
      }

      updateCache = { at: now, data: out };
      return out;
    })
    .catch(function () {
      return { ok: false, current: VERSION, reason: 'error', checkedAt: Date.now() };
    })
    .then(function (out) {
      updateBusy = null;
      return out;
    });

  return updateBusy;
}

/* ------------------------------------------------------------
 * 一键更新：下载 Release 资产 → 解压 → 交给独立进程替换并重启
 * ---------------------------------------------------------- */
const UPDATE_DIR = path.join(DATA_DIR, 'update');

/* 只认 store / deflate 两种压缩方式，够用且不用依赖 */
function unzipTo(buf, destDir) {
  const zlib = require('zlib');

  let eocd = -1;
  const floor = Math.max(0, buf.length - 65558);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 文件');

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const cmtLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.push({ name, method, csize, lho });
    off += 46 + nameLen + extraLen + cmtLen;
  }

  entries.forEach(function (e) {
    if (/\/$/.test(e.name)) return;
    if (e.name.indexOf('..') > -1 || e.name.charAt(0) === '/') {
      throw new Error('压缩包内含非法路径：' + e.name);
    }

    const nl = buf.readUInt16LE(e.lho + 26);
    const el = buf.readUInt16LE(e.lho + 28);
    const start = e.lho + 30 + nl + el;
    const raw = buf.slice(start, start + e.csize);

    let data = null;
    if (e.method === 0) data = raw;
    else if (e.method === 8) data = zlib.inflateRawSync(raw);
    if (!data) return;

    const target = path.join(destDir, e.name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  });
}

function httpsBinary(url, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const u = new URL(url);
    const req = https.get({
      host: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'corp-portal/' + VERSION }
    }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return httpsBinary(res.headers.location, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('下载失败，HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { resolve(Buffer.concat(chunks)); });
    });
    req.setTimeout(timeoutMs, function () { req.destroy(); reject(new Error('下载超时')); });
    req.on('error', reject);
  });
}

let updateRunning = false;

/* 收到新包后：解压校验 → 写一个独立脚本 → 脚本等本进程退出再替换文件并重启 */
async function applyUpdate(assetUrl, latest) {
  if (updateRunning) throw new Error('已有更新在进行中');
  updateRunning = true;

  try {
    fs.rmSync(UPDATE_DIR, { recursive: true, force: true });
    fs.mkdirSync(UPDATE_DIR, { recursive: true });

    const zip = await httpsBinary(assetUrl, 120 * 1000);
    if (zip.length < 1024) throw new Error('安装包异常（体积过小）');

    const stage = path.join(UPDATE_DIR, 'stage');
    fs.mkdirSync(stage, { recursive: true });
    unzipTo(zip, stage);

    // 压缩包里应该有一个顶层目录
    let root = stage;
    const kids = fs.readdirSync(stage).filter(function (n) { return n.charAt(0) !== '.'; });
    if (kids.length === 1 && fs.statSync(path.join(stage, kids[0])).isDirectory()) {
      root = path.join(stage, kids[0]);
    }

    if (!fs.existsSync(path.join(root, 'server.js'))) {
      throw new Error('安装包里找不到 server.js，不是本项目的包');
    }

    let pkgVersion = '';
    try {
      pkgVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '';
    } catch (e) {}

    if (!pkgVersion) throw new Error('安装包里的 package.json 读取失败');
    if (cmpVersion(pkgVersion, latest) !== 0) {
      throw new Error('包里版本 ' + pkgVersion + ' 与预期的 ' + latest + ' 不一致');
    }
    if (cmpVersion(latest, VERSION) <= 0) {
      throw new Error('新版本不高于当前版本，无需更新');
    }

    const runner = path.join(UPDATE_DIR, 'apply.cjs');
    fs.writeFileSync(runner, buildRunnerScript(root, latest), 'utf8');

    return { root: root, runner: runner, version: pkgVersion };
  } finally {
    updateRunning = false;
  }
}

/* 生成替换脚本：它跑在 data/ 下，不会被替换过程影响 */
function buildRunnerScript(stageRoot, targetVersion) {
  const cfg = {
    root: ROOT,
    stage: stageRoot,
    port: PORT,
    host: HOST,
    from: VERSION,
    to: targetVersion
  };

  return `/* 自动生成：等主进程退出后替换文件并重启 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const CFG = ` + JSON.stringify(cfg, null, 2) + `;

const LOG = path.join(CFG.root, 'data', 'update.log');
const KEEP = ['data', 'config.json', '.git', 'node_modules', '.workbuddy'];

function log(m) {
  try { fs.appendFileSync(LOG, new Date().toISOString() + '  ' + m + '\\n'); } catch (e) {}
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* 直接探端口：能连上就说明还有进程占着，比等 HTTP 响应快得多 */
function portFree() {
  return new Promise(function (resolve) {
    const sock = require('net').connect({ port: CFG.port, host: '127.0.0.1' });
    sock.setTimeout(600);
    sock.on('connect', function () { sock.destroy(); resolve(false); });
    sock.on('error', function () { resolve(true); });
    sock.on('timeout', function () { sock.destroy(); resolve(true); });
  });
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach(function (name) {
    if (name === '.git') return;
    const src = path.join(from, name);
    const dst = path.join(to, name);
    const st = fs.statSync(src);
    if (st.isDirectory()) copyTree(src, dst);
    else fs.copyFileSync(src, dst);
  });
}

function backup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(CFG.root, 'data', 'update-backup-' + stamp);
  fs.mkdirSync(dir, { recursive: true });
  fs.readdirSync(CFG.root).forEach(function (name) {
    if (KEEP.indexOf(name) > -1) return;
    const src = path.join(CFG.root, name);
    const st = fs.statSync(src);
    if (st.isDirectory()) copyTree(src, path.join(dir, name));
    else fs.copyFileSync(src, path.join(dir, name));
  });
  return dir;
}

function replaceFiles() {
  fs.readdirSync(CFG.stage).forEach(function (name) {
    if (KEEP.indexOf(name) > -1) return;
    const src = path.join(CFG.stage, name);
    const dst = path.join(CFG.root, name);
    const st = fs.statSync(src);
    if (st.isDirectory()) {
      fs.rmSync(dst, { recursive: true, force: true });
      copyTree(src, dst);
    } else {
      try { fs.rmSync(dst, { force: true }); } catch (e) {}
      fs.copyFileSync(src, dst);
    }
  });
}

function launch() {
  const out = fs.openSync(LOG, 'a');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: CFG.root,
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true
  });
  child.unref();
}

(async function () {
  log('更新开始：' + CFG.from + ' -> ' + CFG.to);

  // 等旧进程真的退出（最多 20 秒）
  for (let i = 0; i < 24; i++) {
    if (await portFree()) break;
    await sleep(500);
  }
  await sleep(400);

  let backupDir = '';
  try {
    backupDir = backup();
    log('已备份到 ' + backupDir);

    replaceFiles();
    log('文件已替换');

    launch();
    log('已启动新进程，更新结束');
  } catch (err) {
    log('替换失败：' + err.message);
    if (backupDir) {
      try {
        Object.keys(CFG).length;
        fs.readdirSync(backupDir).forEach(function (name) {
          const src = path.join(backupDir, name);
          const dst = path.join(CFG.root, name);
          const st = fs.statSync(src);
          if (st.isDirectory()) { fs.rmSync(dst, { recursive: true, force: true }); copyTree(src, dst); }
          else fs.copyFileSync(src, dst);
        });
        log('已回滚到更新前的文件');
      } catch (e2) { log('回滚也失败了：' + e2.message); }
    }
    launch();
  }
})();
`;
}

/* ------------------------------------------------------------
 * 链接校验
 * ---------------------------------------------------------- */
function sanitizeLink(input, base) {
  const src = input || {};
  const out = Object.assign({}, base || {});
  if ('name' in src) out.name = cleanText(src.name, 40);
  if ('desc' in src) out.desc = cleanText(src.desc, 80);
  if ('cat' in src) out.cat = cleanText(src.cat, 20) || '未分类';
  if ('icon' in src) {
    // 图标可以是 emoji/文字，也可以是上传后的图片地址
    const raw = String(src.icon == null ? '' : src.icon).trim();
    out.icon = /^(\/|https?:\/\/)/i.test(raw) ? cleanUrl(raw) : cleanText(raw, 8);
  }
  if ('color' in src) out.color = cleanColor(src.color);
  if ('urlLan' in src) out.urlLan = cleanUrl(src.urlLan);
  if ('urlWan' in src) out.urlWan = cleanUrl(src.urlWan);
  return out;
}

function validateLink(link) {
  if (!link.name) return '名称不能为空';
  if (!link.urlLan && !link.urlWan) return '内网、外网地址至少填一个';
  return null;
}

/* ------------------------------------------------------------
 * HTTP 工具
 * ---------------------------------------------------------- */
function sendJson(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJson(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > 2 * 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('JSON 格式错误')); }
    });
    req.on('error', reject);
  });
}

function setSessionCookie(res, token, maxAge) {
  const parts = [
    SESSION_COOKIE + '=' + token,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ];
  // maxAge 为 0 时不写 Max-Age —— 变成会话 Cookie，关浏览器即失效
  if (maxAge) parts.push('Max-Age=' + Math.floor(maxAge / 1000));
  if (COOKIE_SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', SESSION_COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '-';
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

/* ---------- 图片上传 ---------- */
const MAX_UPLOAD = 6 * 1024 * 1024;   // 6MB
const UPLOAD_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg'
};

// 用文件头校验真实类型，防止改扩展名传别的东西
function magicOk(buf, ext) {
  if (buf.length < 4) return false;

  if (ext === '.png') {
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  }
  if (ext === '.jpg') {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (ext === '.gif') {
    return buf.slice(0, 4).toString('latin1') === 'GIF8';
  }
  if (ext === '.webp') {
    return buf.slice(0, 4).toString('latin1') === 'RIFF' &&
      buf.slice(8, 12).toString('latin1') === 'WEBP';
  }
  if (ext === '.svg') {
    const head = buf.slice(0, 400).toString('utf8').replace(/^\uFEFF/, '').trim().toLowerCase();
    return head.indexOf('<svg') === 0 || head.indexOf('<?xml') === 0;
  }
  return false;
}

function serveUpload(req, res, pathname) {
  const name = pathname.slice('/uploads/'.length);
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(name) || name.indexOf('..') > -1) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
    return;
  }

  const file = path.join(UPLOAD_DIR, name);
  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
    const ext = path.extname(name).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      // 文件名带随机串，可长期缓存
      'Cache-Control': 'public, max-age=31536000, immutable',
      // 万一传上来的是带脚本的 SVG，直接访问也不会执行
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(file).pipe(res);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  const allowed = /^\/(index\.html|login\.html|users\.html|favicon\.ico)$/.test(rel) ||
    /^\/assets\/[A-Za-z0-9._\-\/]+$/.test(rel);
  if (!allowed) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
    return;
  }

  const target = path.normalize(path.join(ROOT, rel));
  const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  if (target.indexOf(rootWithSep) !== 0) { res.writeHead(403).end('Forbidden'); return; }

  fs.stat(target, function (err, st) {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
    const ext = path.extname(target).toLowerCase();
    const isHtml = ext === '.html';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=300',
      'Last-Modified': st.mtime.toUTCString()
    });
    fs.createReadStream(target).pipe(res);
  });
}

/* ------------------------------------------------------------
 * 路由
 * ---------------------------------------------------------- */
const server = http.createServer(function (req, res) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = url.pathname;
  const method = req.method || 'GET';

  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (method === 'OPTIONS') { res.writeHead(204).end(); return; }

  if (pathname.indexOf('/uploads/') === 0) {
    serveUpload(req, res, pathname);
    return;
  }

  if (pathname.indexOf('/api/') !== 0) {
    serveStatic(req, res, pathname);
    return;
  }

  const user = currentUser(req);

  const statePayload = function () {
    return {
      ok: true,
      state: { settings: db.settings, links: db.links, version: VERSION },
      user: user ? publicUser(user) : null,
      roles: ROLE_LABEL
    };
  };

  const deny = function (code, msg) {
    sendJson(res, code, { ok: false, error: msg });
  };

  /* ---------- 健康检查 / 公开站点信息（免登录） ---------- */
  if (pathname === '/api/ping' && method === 'GET') {
    const s = db.settings;
    sendJson(res, 200, {
      ok: true, name: 'corp-portal', version: VERSION, links: db.links.length,
      users: db.users.length, requireLogin: s.requireLogin !== false,
      uptime: Math.round(process.uptime()),
      // 只暴露登录页需要的品牌信息，不含任何业务数据
      site: {
        company: s.company, companyEn: s.companyEn, slogan: s.slogan,
        logo: s.logo, logoImage: s.logoImage, brandColor: s.brandColor,
        heroImage: s.heroImage, heroImageDark: s.heroImageDark
      }
    });
    return;
  }

  /* ---------- 登录 ---------- */
  if (pathname === '/api/login' && method === 'POST') {
    const ip = clientIp(req);
    const rec = loginFails.get(ip);
    if (rec && rec.until > Date.now()) {
      const mins = Math.ceil((rec.until - Date.now()) / 60000);
      deny(429, '尝试次数过多，请 ' + mins + ' 分钟后再试');
      return;
    }

    readJson(req).then(function (body) {
      const username = cleanText(body.username, 40);
      const password = String(body.password || '');

      if (!username || !password) return deny(400, '请输入账号和密码');

      const u = db.users.find(function (x) { return x.username.toLowerCase() === username.toLowerCase(); });
      if (!u || !u.enabled || !verifyPassword(password, u.salt, u.hash)) {
        const cur = loginFails.get(ip) || { count: 0, until: 0 };
        cur.count += 1;
        if (cur.count >= 5) { cur.until = Date.now() + 5 * 60000; cur.count = 0; }
        loginFails.set(ip, cur);
        return deny(401, '账号或密码不正确');
      }

      loginFails.delete(ip);
      u.lastLoginAt = nowIso();
      persist(true);

      const remember = body.remember === true || body.remember === 'true';
      const ttl = remember ? SESSION_TTL_LONG : SESSION_TTL_SHORT;
      const token = createSession(u.id, ttl);
      setSessionCookie(res, token, remember ? SESSION_TTL_LONG : 0);
      sendJson(res, 200, {
        ok: true, remember: remember,
        user: publicUser(u),
        state: { settings: db.settings, links: db.links }
      });
    }).catch(function (e) { deny(400, e.message); });
    return;
  }

  /* ---------- 登出 ---------- */
  if (pathname === '/api/logout' && method === 'POST') {
    const tk = sessionToken(req);
    if (tk) { sessions.delete(tk); saveSessions(); }
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  /* ---------- 当前用户 ---------- */
  /* ---------- 检查更新 ---------- */
  if (pathname === '/api/update/check' && method === 'GET') {
    if (!user) return deny(401, '请先登录');
    const force = /[?&]force=1/.test(req.url || '');
    checkUpdate(force).then(function (d) { sendJson(res, 200, d); });
    return;
  }

  /* ---------- 一键更新（仅管理员） ---------- */
  if (pathname === '/api/system/update' && method === 'POST') {
    if (!user) return deny(401, '请先登录');
    if (user.role !== 'admin') return deny(403, '只有管理员可以更新系统');

    (async function () {
      try {
        const info = await checkUpdate(true);
        if (!info || !info.ok) throw new Error('暂时查不到最新版本，等会儿再试');
        if (!info.hasUpdate) throw new Error('已经是最新版本了');
        if (!info.download) throw new Error('该版本没有上传安装包');

        const r = await applyUpdate(info.download, info.latest);

        sendJson(res, 200, { ok: true, from: VERSION, to: r.version, restart: true });

        // 先把响应发出去，再退出进程，让后台脚本接手替换和重启
        setTimeout(function () {
          try { persist(true); } catch (e) {}
          try {
            const child = require('child_process').spawn(process.execPath, [r.runner], {
              cwd: DATA_DIR,
              detached: true,
              stdio: 'ignore',
              windowsHide: true
            });
            child.unref();
          } catch (e) {}
          process.exit(0);
        }, 700);
      } catch (e) {
        deny(400, e.message || '更新失败');
      }
    })();

    return;
  }

  if (pathname === '/api/me' && method === 'GET') {
    if (!user) return deny(401, '未登录');
    sendJson(res, 200, { ok: true, user: publicUser(user) });
    return;
  }

  /* ---------- 修改自己的密码 ---------- */
  if (pathname === '/api/me/password' && method === 'POST') {
    if (!user) return deny(401, '未登录');
    readJson(req).then(function (body) {
      const oldPwd = String(body.oldPassword || '');
      const newPwd = String(body.newPassword || '');
      if (!verifyPassword(oldPwd, user.salt, user.hash)) return deny(400, '原密码不正确');
      if (newPwd.length < 6) return deny(400, '新密码至少 6 位');

      const h = hashPassword(newPwd);
      user.salt = h.salt;
      user.hash = h.hash;
      user.pwdChangedAt = nowIso();
      persist();

      // 踢掉该用户的其他会话（当前这个保留）
      dropUserSessions(user.id, sessionToken(req));

      sendJson(res, 200, { ok: true });
    }).catch(function (e) { deny(400, e.message); });
    return;
  }

  /* ---------- 个人主题偏好（跟账号走，管理员改不了） ---------- */
  if (pathname === '/api/me/theme' && method === 'PUT') {
    if (!user) return deny(401, '未登录');
    readJson(req).then(function (body) {
      const t = ['system', 'light', 'dark'].indexOf(body.theme) > -1 ? body.theme : 'system';
      user.theme = t;
      persist(true);   // 高频小改动，跳过备份
      sendJson(res, 200, { ok: true, theme: t });
    }).catch(function (e) { deny(400, e.message); });
    return;
  }

  /* ---------- 读取整体状态 ---------- */
  if (pathname === '/api/state' && method === 'GET') {
    const open = db.settings.requireLogin === false;
    if (!user && !open) return deny(401, '请先登录');
    sendJson(res, 200, statePayload());
    return;
  }

  /* ---------- 以下写操作都需要权限 ---------- */
  function needRole(roles) {
    if (!user) { deny(401, '请先登录'); return false; }
    if (roles && roles.indexOf(user.role) < 0) { deny(403, '没有权限执行此操作'); return false; }
    return true;
  }

  /* ---------- 上传图片（原始二进制，不走 multipart） ---------- */
  if (pathname === '/api/upload' && method === 'POST') {
    if (!needRole(['admin', 'editor'])) return;

    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = UPLOAD_TYPES[type];
    if (!ext) return deny(400, '只支持 PNG / JPG / WebP / GIF / SVG 图片');

    const chunks = [];
    let size = 0;
    let tooBig = false;

    req.on('data', function (c) {
      if (tooBig) return;
      size += c.length;
      if (size > MAX_UPLOAD) {
        tooBig = true;
        deny(413, '图片不能超过 6MB');
        req.destroy();
        return;
      }
      chunks.push(c);
    });

    req.on('end', function () {
      if (tooBig) return;
      if (!chunks.length) return deny(400, '没有收到图片内容');

      const buf = Buffer.concat(chunks);
      if (!magicOk(buf, ext)) return deny(400, '文件内容与图片格式不符');

      const name = Date.now().toString(36) + crypto.randomBytes(4).toString('hex') + ext;
      try {
        ensureDirs();
        fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
      } catch (e) {
        return deny(500, '保存失败：' + e.message);
      }

      console.log('[上传] ' + (user ? user.username : '-') + ' 上传 ' + name +
        '（' + Math.round(buf.length / 1024) + ' KB）');
      sendJson(res, 200, { ok: true, url: '/uploads/' + name, size: buf.length });
    });

    req.on('error', function () { deny(400, '接收图片失败'); });
    return;
  }

  /* ---------- 设置 ---------- */
  if (pathname === '/api/settings' && method === 'PUT') {
    if (!needRole(['admin', 'editor'])) return;
    readJson(req).then(function (body) {
      const s = db.settings;
      if ('company' in body) s.company = cleanText(body.company, 24) || '企业门户';
      if ('companyEn' in body) s.companyEn = cleanText(body.companyEn, 48);
      if ('slogan' in body) s.slogan = cleanText(body.slogan, 30);
      if ('logo' in body) s.logo = cleanText(body.logo, 2);
      if ('brandColor' in body) s.brandColor = cleanHexColor(body.brandColor, '#2fa795');
      if ('logoImage' in body) s.logoImage = cleanUrl(body.logoImage);
      if ('heroImage' in body) s.heroImage = cleanUrl(body.heroImage);
      if ('heroImageDark' in body) s.heroImageDark = cleanUrl(body.heroImageDark);
      if ('heroFoot' in body) s.heroFoot = cleanText(body.heroFoot, 40);
      if ('netMode' in body) s.netMode = ['auto', 'lan', 'wan'].indexOf(body.netMode) > -1 ? body.netMode : 'auto';
      if ('openInNewTab' in body) s.openInNewTab = Boolean(body.openInNewTab);
      if ('probeUrls' in body) {
        s.probeUrls = (Array.isArray(body.probeUrls) ? body.probeUrls : [])
          .map(function (u) { return cleanUrl(u); }).filter(Boolean).slice(0, 5);
      }
      if ('requireLogin' in body && user.role === 'admin') s.requireLogin = Boolean(body.requireLogin);

      persist();
      sendJson(res, 200, statePayload());
    }).catch(function (e) { deny(400, e.message); });
    return;
  }

  /* ---------- 新增链接 ---------- */
  if (pathname === '/api/links' && method === 'POST') {
    if (!needRole(['admin', 'editor'])) return;
    readJson(req).then(function (body) {
      const link = sanitizeLink(body, { id: uid(), createdAt: nowIso(), cat: '未分类' });
      const err = validateLink(link);
      if (err) return deny(400, err);
      link.owner = user ? user.username : '';
      db.links.unshift(link);
      persist();
      sendJson(res, 200, statePayload());
    }).catch(function (e) { deny(400, e.message); });
    return;
  }

  /* ---------- 排序 ---------- */
  if (pathname === '/api/links/order' && method === 'POST') {
    if (!needRole(['admin', 'editor'])) return;
    readJson(req).then(function (body) {
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      const map = {};
      db.links.forEach(function (l) { map[l.id] = l; });
      const next = [];
      ids.forEach(function (id) { if (map[id]) { next.push(map[id]); delete map[id]; } });
      db.links.forEach(function (l) { if (map[l.id]) next.push(l); });
      db.links = next;
      persist();
      sendJson(res, 200, statePayload());
    }).catch(function (e) { deny(400, e.message); });
    return;
  }

  /* ---------- 单条链接 ---------- */
  const lm = pathname.match(/^\/api\/links\/([A-Za-z0-9_-]+)$/);
  if (lm) {
    const id = lm[1];
    const idx = db.links.findIndex(function (l) { return l.id === id; });
    if (idx < 0) { deny(404, '未找到该服务'); return; }

    if (method === 'PUT') {
      if (!needRole(['admin', 'editor'])) return;
      readJson(req).then(function (body) {
        const link = sanitizeLink(body, db.links[idx]);
        const err = validateLink(link);
        if (err) return deny(400, err);
        link.updatedAt = nowIso();
        db.links[idx] = link;
        persist();
        sendJson(res, 200, statePayload());
      }).catch(function (e) { deny(400, e.message); });
      return;
    }

    if (method === 'DELETE') {
      if (!needRole(['admin', 'editor'])) return;
      db.links.splice(idx, 1);
      persist();
      sendJson(res, 200, statePayload());
      return;
    }
  }

  /* ---------- 导出 ---------- */
  if (pathname === '/api/export' && method === 'GET') {
    if (!needRole(['admin', 'editor'])) return;
    const clone = JSON.parse(JSON.stringify(db));
    clone.users = clone.users.map(publicUser);   // 绝不导出密码哈希
    const body = Buffer.from(JSON.stringify(clone, null, 2), 'utf8');
    const d = new Date();
    const name = 'portal-backup-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '.json';
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Content-Disposition': 'attachment; filename="' + name + '"'
    });
    res.end(body);
    return;
  }

  /* ---------- 导入 ---------- */
  if (pathname === '/api/import' && method === 'POST') {
    if (!needRole(['admin', 'editor'])) return;
    readJson(req).then(function (body) {
      const src = body && body.links ? body : (body && body.state ? body.state : null);
      if (!src || !Array.isArray(src.links)) return deny(400, '导入文件格式不正确');

      const links = [];
      src.links.forEach(function (raw) {
        const link = sanitizeLink(raw, {
          id: raw && raw.id ? String(raw.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || uid() : uid(),
          createdAt: nowIso(),
          cat: '未分类'
        });
        if (link.name && (link.urlLan || link.urlWan)) links.push(link);
      });
      if (!links.length) return deny(400, '没有可导入的有效数据');

      db.links = links;
      if (src.settings) {
        const s = db.settings;
        if (src.settings.company) s.company = cleanText(src.settings.company, 24);
        if (src.settings.companyEn) s.companyEn = cleanText(src.settings.companyEn, 48);
        if (src.settings.slogan) s.slogan = cleanText(src.settings.slogan, 30);
        if (src.settings.logo) s.logo = cleanText(src.settings.logo, 2);
        if (src.settings.logoImage) s.logoImage = cleanUrl(src.settings.logoImage);
        if (src.settings.brandColor) s.brandColor = cleanHexColor(src.settings.brandColor, '#2fa795');
        if (src.settings.heroImage) s.heroImage = cleanUrl(src.settings.heroImage);
        if (src.settings.heroImageDark) s.heroImageDark = cleanUrl(src.settings.heroImageDark);
        if (src.settings.heroFoot) s.heroFoot = cleanText(src.settings.heroFoot, 40);
        if (src.settings.netMode) s.netMode = ['auto', 'lan', 'wan'].indexOf(src.settings.netMode) > -1 ? src.settings.netMode : 'auto';
        if (Array.isArray(src.settings.probeUrls)) {
          s.probeUrls = src.settings.probeUrls.map(function (u) { return cleanUrl(u); }).filter(Boolean).slice(0, 5);
        }
      }
      persist();
      console.log('[数据] ' + (user ? user.username : '-') + ' 导入了 ' + links.length + ' 条服务');
      sendJson(res, 200, statePayload());
    }).catch(function (e) { deny(400, e.message); });
    return;
  }

  /* ==================== 用户管理（仅管理员） ==================== */

  if (pathname === '/api/users' && method === 'GET') {
    if (!needRole(['admin'])) return;
    sendJson(res, 200, {
      ok: true,
      users: db.users.map(publicUser),
      roles: ROLE_LABEL,
      me: publicUser(user)
    });
    return;
  }

  if (pathname === '/api/users' && method === 'POST') {
    if (!needRole(['admin'])) return;
    readJson(req).then(function (body) {
      const username = cleanText(body.username, 40);
      const name = cleanText(body.name, 30);
      const password = String(body.password || '');
      const role = ROLES.indexOf(body.role) > -1 ? body.role : 'viewer';

      if (!/^[A-Za-z0-9._-]{2,40}$/.test(username)) return deny(400, '账号只能包含字母、数字、点、下划线、短横线，2-40 位');
      if (password.length < 6) return deny(400, '密码至少 6 位');
      if (db.users.length >= MAX_USERS) return deny(400, '用户数量已达上限');
      if (db.users.some(function (u) { return u.username.toLowerCase() === username.toLowerCase(); })) {
        return deny(400, '该账号已存在');
      }

      const h = hashPassword(password);
      const u = {
        id: uid('u'), username: username, name: name, role: role,
        salt: h.salt, hash: h.hash, enabled: true,
        createdAt: nowIso(), lastLoginAt: null, pwdChangedAt: null, theme: 'system'
      };
      db.users.push(u);
      persist();
      console.log('[用户] ' + user.username + ' 创建了 ' + username + '（' + role + '）');
      sendJson(res, 200, { ok: true, user: publicUser(u), users: db.users.map(publicUser), roles: ROLE_LABEL });
    }).catch(function (e) { deny(400, e.message); });
    return;
  }

  const um = pathname.match(/^\/api\/users\/([A-Za-z0-9_-]+)$/);
  if (um) {
    if (!needRole(['admin'])) return;
    const target = db.users.find(function (u) { return u.id === um[1]; });
    if (!target) { deny(404, '未找到该用户'); return; }

    if (method === 'PUT') {
      readJson(req).then(function (body) {
        const adminCount = db.users.filter(function (u) { return u.role === 'admin' && u.enabled; }).length;

        if ('name' in body) target.name = cleanText(body.name, 30);

        if ('role' in body) {
          const role = ROLES.indexOf(body.role) > -1 ? body.role : target.role;
          if (target.role === 'admin' && role !== 'admin' && adminCount <= 1) {
            return deny(400, '至少需要保留一名管理员');
          }
          target.role = role;
        }

        if ('enabled' in body) {
          const enabled = Boolean(body.enabled);
          if (!enabled && target.id === user.id) return deny(400, '不能停用当前登录的账号');
          if (!enabled && target.role === 'admin' && adminCount <= 1) {
            return deny(400, '至少需要保留一名启用状态的管理员');
          }
          target.enabled = enabled;
          if (!enabled) dropUserSessions(target.id);
        }

        persist();
        sendJson(res, 200, { ok: true, users: db.users.map(publicUser), roles: ROLE_LABEL });
      }).catch(function (e) { deny(400, e.message); });
      return;
    }

    if (method === 'DELETE') {
      if (target.id === user.id) return deny(400, '不能删除当前登录的账号');
      if (target.role === 'admin' && db.users.filter(function (u) { return u.role === 'admin'; }).length <= 1) {
        return deny(400, '至少需要保留一名管理员');
      }
      db.users = db.users.filter(function (u) { return u.id !== target.id; });
      dropUserSessions(target.id);
      persist();
      console.log('[用户] ' + user.username + ' 删除了 ' + target.username);
      sendJson(res, 200, { ok: true, users: db.users.map(publicUser), roles: ROLE_LABEL });
      return;
    }
  }

  const pm = pathname.match(/^\/api\/users\/([A-Za-z0-9_-]+)\/password$/);
  if (pm && method === 'POST') {
    if (!needRole(['admin'])) return;
    const target = db.users.find(function (u) { return u.id === pm[1]; });
    if (!target) { deny(404, '未找到该用户'); return; }

    readJson(req).then(function (body) {
      const password = String(body.password || '');
      if (password.length < 6) return deny(400, '密码至少 6 位');
      const h = hashPassword(password);
      target.salt = h.salt;
      target.hash = h.hash;
      target.pwdChangedAt = nowIso();
      persist();
      console.log('[用户] ' + user.username + ' 重置了 ' + target.username + ' 的密码');
      sendJson(res, 200, { ok: true });
    }).catch(function (e) { deny(400, e.message); });
    return;
  }

  deny(404, '接口不存在：' + method + ' ' + pathname);
});

/* ------------------------------------------------------------
 * 启动
 * ---------------------------------------------------------- */
loadDb();
loadSessions();

setInterval(function () {
  const t = Date.now();
  let cleaned = false;
  sessions.forEach(function (v, k) { if (v.exp < t) { sessions.delete(k); cleaned = true; } });
  loginFails.forEach(function (v, k) { if (v.until && v.until < t) loginFails.delete(k); });
  if (cleaned) saveSessions();
}, 10 * 60 * 1000);

function openBrowser(url) {
  const cmd = process.platform === 'win32'
    ? 'start "" "' + url + '"'
    : process.platform === 'darwin'
      ? 'open "' + url + '"'
      : 'xdg-open "' + url + '"';
  try { require('child_process').exec(cmd, function () {}); } catch (e) {}
}

server.listen(PORT, HOST, function () {
  const nets = require('os').networkInterfaces();
  const lan = [];
  Object.keys(nets).forEach(function (k) {
    (nets[k] || []).forEach(function (n) {
      if (n.family === 'IPv4' && !n.internal) lan.push(n.address);
    });
  });

  const exposeAll = HOST === '0.0.0.0' || HOST === '::' || HOST === '::0' || HOST === '';
  const localOnly = HOST === '127.0.0.1' || HOST === 'localhost';

  console.log('');
  console.log('  企业服务大厅已启动');
  console.log('  ------------------------------------------');
  console.log('  本机访问 : http://localhost:' + PORT + '/');

  if (exposeAll) {
    lan.forEach(function (ip) {
      console.log('  内网访问 : http://' + ip + ':' + PORT + '/');
    });
    if (!lan.length) console.log('  内网访问 : 未检测到局域网地址');
  } else if (localOnly) {
    console.log('  内网访问 : 仅本机（要放开局域网，把 host 改成 0.0.0.0）');
  } else {
    console.log('  内网访问 : http://' + HOST + ':' + PORT + '/');
  }

  console.log('  监听地址 : ' + HOST + ':' + PORT);
  console.log('  配置文件 : ' + CONFIG_FILE);
  console.log('  数据文件 : ' + DATA_FILE);
  console.log('  用户数量 : ' + db.users.length);
  console.log('  ------------------------------------------');
  console.log('');

  if (AUTO_OPEN) openBrowser('http://localhost:' + PORT + '/');
});

server.on('error', function (e) {
  if (e.code === 'EADDRINUSE') {
    console.error('');
    console.error('  端口 ' + PORT + ' 已被占用。');
    console.error('  改 ' + CONFIG_FILE + ' 里的 port，');
    console.error('  或临时用 node server.js --port 8081 换一个。');
    console.error('');
  } else if (e.code === 'EADDRNOTAVAIL') {
    console.error('');
    console.error('  监听地址 ' + HOST + ' 在这台机器上不存在。');
    console.error('  用 ipconfig 看一下本机 IP，或把 host 改成 0.0.0.0。');
    console.error('');
  } else {
    console.error('服务启动失败：' + e.message);
  }
  process.exit(1);
});

['SIGINT', 'SIGTERM'].forEach(function (sig) {
  process.on(sig, function () {
    console.log('\n正在关闭，写入数据…');
    try { persist(true); } catch (_) {}
    server.close(function () { process.exit(0); });
    setTimeout(function () { process.exit(0); }, 1500);
  });
});
