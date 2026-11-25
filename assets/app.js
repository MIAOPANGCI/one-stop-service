/* ===========================================================
   企业服务大厅  —  前端逻辑
   数据由服务端 /api/* 提供，全公司共享同一份。
   浏览器本地只保存「管理口令」，不存业务数据。
   =========================================================== */
(function () {
  'use strict';

  var PALETTE = ['#2fa795', '#1c6fd6', '#5b6bd6', '#d97706', '#c0392b', '#0f766e', '#334155', '#7c3aed', '#0891b2', '#be185d'];
  var BRAND_THEMES = [
    { name: '松石绿', color: '#2fa795' },
    { name: '深海蓝', color: '#1c6fd6' },
    { name: '靛青', color: '#4f46e5' },
    { name: '晴空', color: '#0891b2' },
    { name: '森林绿', color: '#15803d' },
    { name: '墨青', color: '#0f766e' },
    { name: '琥珀', color: '#d97706' },
    { name: '砖红', color: '#c0392b' },
    { name: '玫瑰', color: '#be185d' },
    { name: '午夜紫', color: '#7c3aed' },
    { name: '石墨', color: '#334155' },
    { name: '咖棕', color: '#92400e' },
    { name: '青柠', color: '#65a30d' },
    { name: '珊瑚', color: '#f97316' },
    { name: '天青', color: '#0ea5e9' },
    { name: '酒红', color: '#9f1239' }
  ];

  /* 内置壁纸：url 为空表示用默认的矢量山景 */
  var WALLPAPERS = [
    { name: '默认', url: '' },
    { name: '晨雾', url: '/assets/wallpapers/mist-dawn.svg' },
    { name: '暖纸', url: '/assets/wallpapers/paper-light.svg' },
    { name: '极简', url: '/assets/wallpapers/minimal-blue.svg' },
    { name: '星空', url: '/assets/wallpapers/star-night.svg' },
    { name: '城市夜', url: '/assets/wallpapers/city-night.svg' },
    { name: '深林', url: '/assets/wallpapers/forest-deep.svg' },
    { name: '极光', url: '/assets/wallpapers/aurora-night.svg' }
  ];
  var EMOJIS = ['🔗', '📋', '📊', '📁', '📧', '💬', '🧰', '🔐', '🧾', '🗂', '📈', '🧮', '🏢', '🔧', '🧠', '🌐', '💻', '📦', '🧪', '🚀', '📅', '💡', '🛒', '🏭'];

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* ---------------- 状态 ---------------- */
  var state = {
    settings: {
      company: '企业服务大厅', companyEn: 'CORP · SERVICE PORTAL', slogan: '一站式内部服务平台',
      logo: '企', brandColor: '#2fa795', heroImage: '', heroFoot: '我们为你准备了丰富的内部服务',
      netMode: 'auto', probeUrls: [], openInNewTab: true, openMode: 'new',
      fontFamily: '', inkLight: '', inkDark: '',
      heroGlow: true, glowColor: '', tabPopups: 'allow', updatedAt: null
    },
    links: [],
    version: '',
    lan: []
  };
  var authUser = null;
  var roles = { admin: '管理员', editor: '编辑者', viewer: '浏览者' };
  var online = false;
  var guest = false;
  var guestLinks = 0;
  var activeCat = '全部';
  var keyword = '';
  var currentNet = 'unknown';
  var editingId = null;
  var formIcon = '';
  var formColor = PALETTE[0];
  var formBrand = BRAND_THEMES[0].color;
  var formLogoImage = '';
  var formGlow = '';
  var formTabPop = 'allow';
  var formInkLight = '';
  var formInkDark = '';
  var formHeroImage = '';
  var formHeroDark = '';
  var busy = false;
  var jumpedToService = false;

  /* ---------------- 颜色工具 ---------------- */
  function shade(hex, pct) {
    var n = parseInt(String(hex).replace('#', ''), 16);
    if (isNaN(n)) return hex;
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var f = 1 + pct / 100;
    var c = function (x) { return Math.max(0, Math.min(255, Math.round(x * f))); };
    return '#' + ((1 << 24) + (c(r) << 16) + (c(g) << 8) + c(b)).toString(16).slice(1);
  }

  function revertBrand() {
    applyBrand(state.settings.brandColor || '#2fa795');
  }

  /* 按图片实际宽高比调整 Logo 容器：横版图不会被裁掉两侧 */
  function fitLogoBox(el, url, baseH, maxRatio) {
    if (!el) return;

    var reset = function () {
      el.classList.remove('is-wide');
      el.style.removeProperty('width');
    };

    if (!url) { reset(); return; }

    var probe = new Image();
    probe.onload = function () {
      var w = probe.naturalWidth;
      var h = probe.naturalHeight;
      if (!w || !h) { reset(); return; }

      var ratio = w / h;
      if (ratio > 1.25) {
        var limit = maxRatio || 3.4;
        var target = Math.min(Math.round(baseH * ratio), Math.round(baseH * limit));
        el.classList.add('is-wide');
        el.style.width = target + 'px';
        el.style.setProperty('--logo-h', baseH + 'px');
      } else {
        reset();
      }
    };
    probe.onerror = reset;
    probe.src = url;
  }

  function applyBrand(hex) {
    var root = document.documentElement;
    root.style.setProperty('--brand', hex);
    root.style.setProperty('--brand-dark', shade(hex, -24));
    var meta = $('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = hex;
  }

  /* ---------------- 接口 ---------------- */
  function api(method, url, body) {
    var opt = { method: method, headers: { 'Accept': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    return fetch(url, opt).then(function (res) {
      return res.json().catch(function () { return { ok: false, error: '服务端返回了无法解析的内容' }; })
        .then(function (data) {
          if (!res.ok || data.ok === false) {
            var err = new Error(data.error || ('请求失败（HTTP ' + res.status + '）'));
            err.status = res.status;
            throw err;
          }
          return data;
        });
    });
  }

  function applyPayload(data) {
    if (data && data.state) {
      state.settings = Object.assign({}, state.settings, data.state.settings || {});
      state.links = Array.isArray(data.state.links) ? data.state.links : [];
      if (data.state.version) state.version = data.state.version;
      if (Array.isArray(data.state.lan)) state.lan = data.state.lan;
      applyType();
    }
    if (data && data.user !== undefined) authUser = data.user;
    if (data && data.roles) roles = data.roles;
    online = true;
    paintOffline(null);

    // 首次拿到用户信息时，采用账号里保存的主题偏好（跟着人走，换设备也一致）
    if (!themeSynced && authUser) {
      themeSynced = true;
      if (authUser.theme && authUser.theme !== currentThemeMode()) {
        applyThemeMode(authUser.theme, { silent: true, local: true });
      } else {
        paintThemeBtn(currentThemeMode(), resolveTheme(currentThemeMode()));
      }
    }

    render();
  }

  function canEdit() {
    return online && authUser && (authUser.role === 'admin' || authUser.role === 'editor');
  }

  function isAdmin() {
    return online && authUser && authUser.role === 'admin';
  }

  function loadState(silent) {
    return api('GET', '/api/state').then(function (data) {
      var first = state.links.length === 0;
      applyPayload(data);
      if (first && state.links.length) refreshNet();
      return true;
    }).catch(function (e) {
      if (e.status === 401) {
        enterGuestMode();
        return false;
      }
      online = false;
      paintOffline(e);
      if (!silent) {
        render();
        toast('读取失败：' + e.message);
      }
      return false;
    });
  }

  function mutate(method, url, body, okMsg) {
    if (busy) return Promise.resolve(false);
    busy = true;
    setSaving(true);

    return api(method, url, body).then(function (data) {
      applyPayload(data);
      if (okMsg) toast(okMsg);
      return true;
    }).catch(function (e) {
      if (e.status === 401) {
        toast('登录已失效，请重新登录');
        setTimeout(function () { location.replace('/login.html'); }, 900);
      } else if (e.status === 403) {
        toast('当前账号没有这个操作权限');
      } else if (e instanceof TypeError || e.message === 'Failed to fetch') {
        online = false;
        paintOffline(e);
        toast('连接服务器失败，修改未保存');
      } else {
        toast(e.message);
      }
      return false;
    }).then(function (r) {
      busy = false;
      setSaving(false);
      return r;
    });
  }

  function setSaving(on) {
    [$('#saveBtn'), $('#setSaveBtn')].forEach(function (b) {
      if (!b) return;
      if (on) { b.dataset.txt = b.textContent; b.textContent = '保存中…'; b.disabled = true; }
      else { if (b.dataset.txt) b.textContent = b.dataset.txt; b.disabled = false; }
    });
  }

  /* ---------------- 网络识别 ---------------- */
  function isPrivateHost(h) {
    if (!h) return false;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true;
    return /^10\./.test(h) || /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) ||
      /\.local$/i.test(h) || /\.lan$/i.test(h);
  }

  function probeOnce(url, timeout) {
    return new Promise(function (resolve) {
      var ctrl = new AbortController();
      var done = false;
      var t = setTimeout(function () {
        if (done) return;
        done = true;
        try { ctrl.abort(); } catch (e) {}
        resolve(false);
      }, timeout || 1400);

      fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal })
        .then(function () { if (done) return; done = true; clearTimeout(t); resolve(true); })
        .catch(function () { if (done) return; done = true; clearTimeout(t); resolve(false); });
    });
  }

  function detectNet() {
    if (!navigator.onLine) return Promise.resolve('offline');
    var probes = (state.settings.probeUrls || []).filter(Boolean);
    if (probes.length) {
      return Promise.all(probes.map(function (u) { return probeOnce(u); }))
        .then(function (rs) { return rs.some(Boolean) ? 'lan' : 'wan'; });
    }

    var host = location.hostname;
    var byHost = !host ? 'lan' : (isPrivateHost(host) ? 'lan' : 'wan');

    // 没填探测地址时，拿门户自己的内网地址试一次：
    // 这台机器一定开着网页端口，而且这个地址外网访问不到，
    // 比单纯猜主机名可靠，也不依赖局域网里有没有别的可探测设备。
    // HTTPS 页面探 http:// 会被浏览器当混合内容拦掉，所以这招只在 http 页面用。
    var self = location.protocol === 'https:' ? [] : (state.lan || []).filter(function (u) {
      return u && u !== location.origin;
    });
    if (!self.length) return Promise.resolve(byHost);

    return Promise.all(self.map(function (u) { return probeOnce(u); }))
      .then(function (rs) { return rs.some(Boolean) ? 'lan' : byHost; });
  }

  function refreshNet() {
    return detectNet().then(function (net) {
      var changed = net !== currentNet;
      currentNet = net;
      paintNet();
      if (changed) renderGroups();
    });
  }

  function paintNet() {
    var pill = $('#netPill');
    if (!pill) return;
    var mode = state.settings.netMode;
    var label = currentNet === 'lan' ? '内网' : currentNet === 'wan' ? '外网'
      : currentNet === 'offline' ? '离线' : '检测中';
    var suffix = mode === 'auto' ? '' : mode === 'lan' ? ' · 锁内网' : ' · 锁外网';

    var canSwitch = canEdit();
    if (!canSwitch) suffix = '';
    pill.className = 'net-pill is-' + currentNet + (canSwitch ? '' : ' is-fixed');
    $('.txt', pill).textContent = label + suffix;
    pill.title = canSwitch
      ? '当前网络：' + label + '\n点击切换：自动 → 锁定内网 → 锁定外网'
      : '当前网络：' + label + '\n登录后可切换网络模式';
  }

  /* ---------------- 地址选择 ---------------- */
  function pickUrl(link) {
    var lan = (link.urlLan || '').trim();
    var wan = (link.urlWan || '').trim();
    var mode = state.settings.netMode;
    var preferLan = mode === 'lan' ? true : mode === 'wan' ? false : currentNet === 'lan';

    if (preferLan) {
      if (lan) return { url: lan, net: 'lan' };
      if (wan) return { url: wan, net: 'wan' };
    } else {
      if (wan) return { url: wan, net: 'wan' };
      if (lan) return { url: lan, net: 'lan' };
    }
    return { url: '', net: '' };
  }

  function openLink(link) {
    var r = pickUrl(link);
    if (!r.url) { toast('「' + link.name + '」还没有配置访问地址'); return; }

    var mode = state.settings.openMode || (state.settings.openInNewTab === false ? 'same' : 'new');
    if (mode === 'tab') {
      // 桌面壳里 webview 能正常内嵌，这个标记只对网页版生效
      if (link.noFrame && !DESKTOP) { openInNewTab(r.url); return; }
      openTab(link.name, r.url);
      return;
    }
    if (mode === 'same') { location.href = r.url; return; }

    // 用临时 <a> 打开：既能带 noopener，又不会被 window.open 的返回值坑到
    // （带 noopener 时 window.open 按规范必定返回 null，不能用它判断是否被拦截）
    var a = document.createElement('a');
    a.href = r.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); }, 0);
  }

  /* ---------------- 站内页标签 ---------------- */
  // Electron 壳里用 <webview>，它不受 X-Frame-Options 限制
  var DESKTOP = !!(window.desktopAPI && window.desktopAPI.isDesktop);

  function frameOf(id) {
    return $('#tabFrames').querySelector('[data-id="' + id + '"]');
  }

  /* 建一个页面容器：网页版是 iframe，桌面版是 webview */
  function makeFrame(t) {
    var box = $('#tabFrames');
    var el;

    var onOk = function () {
      if (t.failed) { t.failed = false; paintTabFail(t.id, false); }
    };
    var onFail = function () {
      t.failed = true;
      paintTabFail(t.id, true);
    };

    if (DESKTOP) {
      el = document.createElement('webview');
      el.setAttribute('data-id', t.id);
      el.setAttribute('allowpopups', '');
      // src 留到入 DOM 之后再设：webview 只有附着到文档后才会真正挂载

      var doneW = false;
      el.addEventListener('did-finish-load', function () { doneW = true; onOk(); });
      // 页签显示网页自己的标题，比域名好认
      el.addEventListener('page-title-updated', function (e) {
        if (e && e.title) setTabName(t.id, e.title);
      });
      el.addEventListener('did-fail-load', function (e) {
        if (e && e.errorCode === -3) return;     // 主动中止，不算失败
        doneW = true;
        onFail();
      });
      setTimeout(function () { if (!doneW) onFail(); }, 9000);
    } else {
      el = document.createElement('iframe');
      el.setAttribute('data-id', t.id);
      el.setAttribute('referrerpolicy', 'no-referrer');
      el.setAttribute('sandbox', tabSandbox());
      el.src = t.url;

      var doneI = false;
      el.addEventListener('load', function () {
        doneI = true;
        onOk();
        adoptSameOrigin(el);
        // 同源页面能读到标题；跨域会被拦，页签先留原名字
        try {
          var tt = el.contentDocument && el.contentDocument.title;
          if (tt) setTabName(t.id, tt);
        } catch (e) {}
      });
      setTimeout(function () { if (!doneI) onFail(); }, 7000);
    }

    box.appendChild(el);
    if (DESKTOP) el.src = t.url;
    return el;
  }
  var tabs = [];        // 真实页签，「门户」不占位
  var activeId = 0;     // 0 = 门户
  var tabSeq = 0;
  var lastNewId = 0;

  function openTab(name, url) {
    if (!url) return;

    var hit = null;
    tabs.forEach(function (t) { if (t.url === url) hit = t; });

    if (hit) {
      activeId = hit.id;
    } else {
      tabs.push({ id: ++tabSeq, name: name || url, url: url, failed: false });
      activeId = tabSeq;
      lastNewId = tabSeq;
    }
    hidePicker();
    syncTabs();
  }

  function findTab(id) {
    var out = null;
    tabs.forEach(function (t) { if (t.id === id) out = t; });
    return out;
  }

  function activeTab() { return findTab(activeId); }

  /* 回门户：页签栏留着，数量一眼能看见 */
  function goHome() {
    activeId = 0;
    hidePicker();
    syncTabs();
  }

  function tabSandbox() {
    var base = 'allow-scripts allow-forms allow-same-origin allow-modals allow-downloads';
    // 默认放行弹出窗口：静默拦掉会让「点了没反应」，比弹一个新标签更糟
    if (state.settings.tabPopups !== 'block') {
      base += ' allow-popups allow-popups-to-escape-sandbox';
    }
    return base;
  }

  function syncTabs() {
    var host = $('#tabHost');
    if (!host) return;

    var show = tabs.length > 0;
    host.hidden = !show;
    document.body.classList.toggle('has-tabs', show);
    if (!show) { $('#tabFrames').innerHTML = ''; return; }

    if (activeId !== 0 && !findTab(activeId)) activeId = 0;
    var homeOn = activeId === 0;

    var homeIco = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M3.5 10.6 12 3.6l8.5 7"></path><path d="M5.8 9.6V20h12.4V9.6"></path></svg>';

    var html = '<button class="tabitem tab-home' + (homeOn ? ' on' : '') + '" type="button" data-id="0">' +
      '<i class="tabico">' + homeIco + '</i><span>门户</span></button>';

    html += tabs.map(function (t) {
      return '<button class="tabitem' + (t.id === activeId ? ' on' : '') + '" type="button" data-id="' + t.id + '" title="' + esc(t.name) + '">' +
        '<span>' + esc(t.name) + '</span>' +
        '<i class="tabx" data-close="' + t.id + '" title="关闭">✕</i>' +
        '</button>';
    }).join('');

    $('#tabList').innerHTML = html;

    // 只有刚加进来的那个播放进场动画，重建列表时不该整排一起动
    if (lastNewId) {
      var fresh = $('#tabList').querySelector('[data-id="' + lastNewId + '"]');
      if (fresh) fresh.classList.add('in');
      lastNewId = 0;
    }

    // 页签多了横向滚动，把当前这个滚进可视范围
    var list = $('#tabList');
    var cur = list.querySelector('.tabitem.on');
    if (cur) {
      var a = cur.getBoundingClientRect();
      var b = list.getBoundingClientRect();
      if (a.left < b.left) list.scrollLeft -= (b.left - a.left) + 12;
      else if (a.right > b.right) list.scrollLeft += (a.right - b.right) + 12;
    }

    var box = $('#tabFrames');
    box.hidden = homeOn;

    tabs.forEach(function (t) {
      var f = frameOf(t.id) || makeFrame(t);
      f.hidden = homeOn || t.id !== activeId;
    });
  }

  /* 页面标题变了就改页签名，不用整排重建 */
  function setTabName(id, name) {
    name = String(name || '').replace(/\s+/g, ' ').trim();
    if (!name) return;

    var t = findTab(id);
    if (!t || t.name === name) return;
    t.name = name;

    var btn = $('#tabList').querySelector('.tabitem[data-id="' + id + '"]');
    if (!btn) return;
    var label = btn.querySelector('span');
    if (label) { label.textContent = name; label.title = name; }
    btn.title = name;
  }

  /* 同源页面才拿得到它的 window：把新窗口截下来，开成我们的页签。
     跨域页面受同源策略限制，改不了它的链接，只能交给浏览器。 */
  function adoptSameOrigin(f) {
    try {
      var w = f.contentWindow;
      if (!w || w.location.origin !== location.origin) return;
      if (w.__tabAdopted) return;
      w.__tabAdopted = true;

      w.open = function (url) {
        if (url) openTab(String(url), String(url));
        return w;
      };

      w.addEventListener('click', function (e) {
        var a = e.target && e.target.closest && e.target.closest('a[target="_blank"]');
        if (!a || !a.href) return;
        e.preventDefault();
        openTab((a.textContent || '').trim() || a.href, a.href);
      }, true);
    } catch (e) { /* 跨域访问会抛，正常 */ }
  }

  /* 内嵌被拒或者一直不响应，给条退路，别让人对着白屏 */
  function paintTabFail(id, on) {
    var box = $('#tabFrames');
    var old = box.querySelector('.tabfail[data-for="' + id + '"]');
    if (old) old.parentNode.removeChild(old);
    if (!on) return;

    var d = document.createElement('div');
    d.className = 'tabfail';
    d.setAttribute('data-for', id);
    d.innerHTML = '<div><b>这个页面没能嵌进来</b>' +
      '<p>对方站点可能禁止被内嵌（X-Frame-Options），或者一直没有响应。</p>' +
      '<button class="btn-line sm" type="button" data-pop="' + id + '">在新标签页打开</button>' +
      '<button class="btn-line sm" type="button" data-retry="' + id + '">重试</button></div>';
    box.appendChild(d);
  }

  function closeTab(id) {
    var el = $('#tabList').querySelector('[data-id="' + id + '"]');
    if (el && !el.classList.contains('out')) {
      el.classList.add('out');
      setTimeout(function () { removeTab(id); }, 170);
      return;
    }
    removeTab(id);
  }

  function removeTab(id) {
    var box = $('#tabFrames');
    var f = frameOf(id);
    if (f) f.parentNode.removeChild(f);
    var d = box.querySelector('.tabfail[data-for="' + id + '"]');
    if (d) d.parentNode.removeChild(d);

    var idx = tabs.map(function (t) { return t.id; }).indexOf(id);
    tabs = tabs.filter(function (t) { return t.id !== id; });

    if (activeId === id) {
      var prev = tabs[idx - 1] || tabs[idx] || null;
      activeId = prev ? prev.id : 0;
    }
    syncTabs();
  }

  function reloadActiveTab() {
    var t = activeTab();
    if (!t) { toast('先打开一个页签'); return; }
    var f = frameOf(t.id);
    if (!f) return;
    paintTabFail(t.id, false);
    if (DESKTOP) {
      try { f.reload(); } catch (e) { f.src = t.url; }
    } else {
      try { f.contentWindow.location.reload(); } catch (e) { f.src = t.url; }
    }
    toast('已刷新');
  }

  function openInNewTab(url) {
    var a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); }, 0);
  }

  /* ---------------- 服务选择面板 ---------------- */
  function buildPicker(keyword) {
    var box = $('#tabPickList');
    if (!box) return;
    var kw = String(keyword || '').trim().toLowerCase();

    var groups = {};
    var order = [];

    (state.links || []).forEach(function (l) {
      if (kw) {
        var hay = [l.name, l.desc, l.cat].join(' ').toLowerCase();
        if (hay.indexOf(kw) === -1) return;
      }
      var cat = l.cat || '未分类';
      if (!groups[cat]) { groups[cat] = []; order.push(cat); }
      groups[cat].push(l);
    });

    if (!order.length) {
      box.innerHTML = '<div class="pick-empty">没有匹配的服务</div>';
      return;
    }

    box.innerHTML = order.map(function (cat) {
      var items = groups[cat].map(function (l) {
        var url = pickUrl(l).url;
        var raw = (l.icon || '').trim();
        var ico = /^(\/|https?:\/\/)/i.test(raw)
          ? '<img src="' + esc(raw) + '" alt="">'
          : esc(raw || (l.name || '?').slice(0, 1));
        return '<button class="pick-item" type="button" data-link="' + esc(l.id) + '"' +
          (url ? '' : ' disabled') + (l.noFrame ? ' title="在新标签页打开"' : '') +
          '><i class="pick-ico">' + ico + '</i>' +
          '<span>' + esc(l.name) + '</span>' +
          (l.noFrame ? '<i class="pick-ext">↗</i>' : '') + '</button>';
      }).join('');
      return '<div class="pick-cat">' + esc(cat) + '</div>' + items;
    }).join('');
  }

  function showPicker() {
    $('#tabPick').hidden = false;
    var s = $('#tabPickSearch');
    s.value = '';
    buildPicker('');
    s.focus();
  }

  function hidePicker() {
    var p = $('#tabPick');
    if (p) p.hidden = true;
  }

  /* ---------------- 渲染：品牌与首屏 ---------------- */
  function renderBrand() {
    var s = state.settings;
    var brand = /^#[0-9a-fA-F]{6}$/.test(s.brandColor || '') ? s.brandColor : '#2fa795';
    applyBrand(brand);

    $('#navName').textContent = s.company || '企业服务大厅';

    var logoEl = $('#navLogo');
    if (s.logoImage) {
      logoEl.className = 'nav-logo has-img';
      logoEl.innerHTML = '<img src="' + esc(s.logoImage) + '" alt="">';
      fitLogoBox(logoEl, s.logoImage, 46, 2.6);
      if (window.probeLogo) window.probeLogo(s.logoImage, function (info) { window.paintLogo(logoEl, info, s.logoImage); });
    } else {
      var lg = s.logo || (s.company || '企').slice(0, 1);
      logoEl.className = 'nav-logo' + (lg.length > 1 ? ' two' : '');
      logoEl.textContent = lg;
      logoEl.style.removeProperty('width');
      logoEl.classList.remove('is-alpha', 'tone-dark', 'tone-light');
    }

    $('#heroTitle').textContent = s.company || '企业服务大厅';
    $('#heroEn').textContent = s.companyEn || '';
    $('#heroSlogan').textContent = s.slogan || '';
    $('#heroFoot').textContent = s.heroFoot || '我们为你准备了丰富的内部服务';
    document.title = (s.company || '企业服务大厅');

    if (window.setFavicon) {
      window.setFavicon({ image: s.logoImage, text: s.logo, company: s.company, color: brand });
    }

    applyHeroBackground();
  }

  /* 按当前主题选择对应壁纸；夜间没设就沿用日间 */
  function applyHeroBackground() {
    var bg = $('#heroBg');
    if (!bg) return;

    var s = state.settings;
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var img = dark ? (s.heroImageDark || s.heroImage) : s.heroImage;

    if (img) {
      bg.style.backgroundImage = 'url("' + String(img).replace(/"/g, '%22') + '")';
    } else {
      bg.style.backgroundImage = '';
    }
  }

  /* ---------------- 渲染：分类与图标墙 ---------------- */
  function categories() {
    var seen = {}, out = [];
    state.links.forEach(function (l) {
      var c = (l.cat || '未分类').trim();
      if (!seen[c]) { seen[c] = 0; out.push(c); }
      seen[c]++;
    });
    return { list: out, count: seen };
  }

  function renderCats() {
    var c = categories();
    if (activeCat !== '全部' && c.list.indexOf(activeCat) === -1) activeCat = '全部';

    var items = [{ name: '全部', n: state.links.length }];
    c.list.forEach(function (n) { items.push({ name: n, n: c.count[n] }); });

    $('#catBar').innerHTML = items.map(function (it) {
      return '<button class="tab' + (it.name === activeCat ? ' on' : '') + '" data-cat="' + esc(it.name) + '" type="button">' +
        esc(it.name) + '<span class="tab-n">' + it.n + '</span></button>';
    }).join('');

    $('#catList').innerHTML = c.list.map(function (n) {
      return '<option value="' + esc(n) + '"></option>';
    }).join('');

    $('#svcCount').textContent = '共 ' + state.links.length + ' 个服务 · ' + c.list.length + ' 个分类';
  }

  function filtered() {
    var kw = keyword.trim().toLowerCase();
    return state.links.filter(function (l) {
      if (activeCat !== '全部' && (l.cat || '未分类') !== activeCat) return false;
      if (!kw) return true;
      return [l.name, l.desc, l.cat, l.urlLan, l.urlWan].join(' ').toLowerCase().indexOf(kw) > -1;
    });
  }

  /* 图标字符数：变体选择符、零宽连接符、键帽组合符不单独占位 */
  function iconUnits(s) {
    var arr = Array.from(String(s || ''));
    var n = 0;
    for (var i = 0; i < arr.length; i++) {
      var c = arr[i].codePointAt(0);
      if (c === 0xFE0F || c === 0x200D || c === 0x20E3) continue;
      n++;
    }
    return n;
  }

  /* 按字符数缩放字号，58px 的方块里塞得下且不折行 */
  function iconFontSize(s) {
    var n = iconUnits(s);
    if (n <= 1) return 27;
    if (n === 2) return 20;
    if (n === 3) return 16;
    return 13;
  }

  /* 按"字"（码点）截断，避免 slice 把 emoji 劈成半个乱码 */
  function clipIcon(s, max) {
    var arr = Array.from(String(s || ''));
    var out = [];
    for (var i = 0; i < arr.length && out.length < max; i++) {
      var c = arr[i].codePointAt(0);
      if ((c === 0xFE0F || c === 0x200D || c === 0x20E3) && out.length) {
        out[out.length - 1] += arr[i];
        continue;
      }
      out.push(arr[i]);
    }
    return out.join('').trim();
  }

  function tileHtml(l) {
    var r = pickUrl(l);
    var raw = (l.icon || '').trim();
    var imgIcon = isIconUrl(raw) ? raw : '';
    var icon = raw || (l.name || '?').slice(0, 1);
    var color = /^#[0-9a-fA-F]{6}$/.test(l.color || '') ? l.color : '#2fa795';
    var tip = (l.desc || l.name) + (r.url ? '\n' + (r.net === 'lan' ? '内网地址' : '外网地址') + '：' + r.url : '\n未配置地址');
    var pen = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"></path></svg>';

    return '<div class="tile" role="link" tabindex="0" data-id="' + esc(l.id) + '" style="--c:' + esc(color) + '" title="' + esc(tip) + '">' +
      '<span class="tile-ico' + (imgIcon ? ' has-img' : '') + '"' +
        (imgIcon ? '' : ' style="--ico-fs:' + iconFontSize(icon) + 'px"') + '>' +
        (imgIcon ? '<img src="' + esc(imgIcon) + '" alt="">' : esc(icon)) +
        (r.url ? '<i class="tile-dot ' + r.net + '"></i>' : '') +
      '</span>' +
      '<span class="tile-name">' + esc(l.name) + '</span>' +
      (canEdit() ? '<button class="tile-edit" type="button" data-act="edit" title="编辑">' + pen + '</button>' : '') +
    '</div>';
  }

  function renderGroups() {
    if (guest) return;
    var list = filtered();
    var box = $('#groups');
    var empty = $('#empty');

    if (!list.length) {
      box.innerHTML = '';
      empty.hidden = false;
      $('#emptyAddBtn').hidden = !canEdit();
      if (!state.links.length) {
        $('#emptyTitle').textContent = online ? '这里还没有服务' : '读不到数据';
        $('#emptyHint').textContent = online
          ? '添加第一个服务，把常用系统都收进大厅。'
          : '请确认服务端已启动，然后点右下角「重试」。';
      } else {
        $('#emptyTitle').textContent = '没有找到匹配的服务';
        $('#emptyHint').textContent = '换个关键词，或切回「全部」看看。';
      }
      return;
    }
    empty.hidden = true;

    // 按分类分组，保持原始出现顺序
    var order = [], map = {};
    list.forEach(function (l) {
      var c = (l.cat || '未分类').trim();
      if (!map[c]) { map[c] = []; order.push(c); }
      map[c].push(l);
    });

    box.innerHTML = order.map(function (cat) {
      var arr = map[cat];
      return '<section class="group">' +
        '<div class="group-head"><h3>' + esc(cat) + '</h3><span class="group-n">' + arr.length + ' 项</span></div>' +
        '<div class="tiles">' + arr.map(tileHtml).join('') + '</div>' +
      '</section>';
    }).join('');
  }

  function renderFoot() {
    $('#footStat').textContent = '© ' + new Date().getFullYear() + ' ' + (state.settings.company || '');
    $('#footSync').textContent = online
      ? ('数据存于服务端 · 最后更新 ' + fmtTime(state.settings.updatedAt) +
         (state.version ? ' · v' + state.version : ''))
      : '未连接服务端';
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------------- 访客模式（未登录看首屏） ---------------- */
  function enterGuestMode() {
    guest = true;
    online = false;

    fetch('/api/ping', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && typeof d.links === 'number') guestLinks = d.links;
        if (d && d.version) state.version = d.version;
        if (d && Array.isArray(d.lan)) state.lan = d.lan;
        if (d && d.site) {
          var s = state.settings;
          s.company = d.site.company || s.company;
          s.companyEn = d.site.companyEn || '';
          s.slogan = d.site.slogan || '';
          s.logo = d.site.logo || s.logo;
          s.logoImage = d.site.logoImage || '';
          s.heroImage = d.site.heroImage || '';
          s.heroImageDark = d.site.heroImageDark || '';
          if (/^#[0-9a-fA-F]{6}$/.test(d.site.brandColor || '')) s.brandColor = d.site.brandColor;
        }
        renderGuest();
      })
      .catch(function () { renderGuest(); });
  }

  function renderGuest() {
    renderBrand();
    paintNet();

    $('#catBar').innerHTML = '';
    $('#groups').innerHTML = '';
    $('#svcCount').textContent = '';
    $('#empty').hidden = true;
    $('#services').classList.add('is-locked');
    $('#locked').hidden = false;
    $('#lockedDesc').textContent = guestLinks
      ? '共 ' + guestLinks + ' 个内部系统入口，登录后即可访问。'
      : '使用公司账号登录后，即可访问全部内部系统入口。';

    $('#addBtn').hidden = true;
    $('#netPill').hidden = true;
    $('#settingsBtn').hidden = true;
    $('#userMenu').hidden = true;
    if ($('#loginBtn')) $('#loginBtn').hidden = false;
    $('#offline').hidden = true;

    var si = $('#searchInput');
    si.setAttribute('readonly', 'readonly');
    si.placeholder = '登录后搜索服务';

    $('#footStat').textContent = '© ' + new Date().getFullYear() + ' ' + (state.settings.company || '');
    $('#footSync').textContent = '内部服务需登录后使用';
  }

  function renderUser() {
    var menu = $('#userMenu');

    // 没登录：藏掉添加/设置，右上角换成「登录」
    if (!authUser) {
      menu.hidden = true;
      $('#addBtn').hidden = true;
      $('#settingsBtn').hidden = true;
      if ($('#loginBtn')) $('#loginBtn').hidden = false;
      return;
    }

    if ($('#loginBtn')) $('#loginBtn').hidden = true;
    menu.hidden = false;

    var name = authUser.name || authUser.username;
    $('#userAvatar').textContent = (name || '?').slice(0, 1).toUpperCase();
    $('#dropName').textContent = name;
    $('#dropRole').textContent = authUser.username + ' · ' + (roles[authUser.role] || authUser.role);
    $('#usersItem').hidden = authUser.role !== 'admin';

    var ed = canEdit();
    $('#addBtn').hidden = !ed;
    $('#settingsBtn').hidden = !ed;
  }

  function render() {
    $('#services').classList.remove('is-locked');
    renderBrand();
    renderCats();
    renderGroups();
    renderFoot();
    renderUser();
    paintNet();
  }

  /* ---------------- 离线提示 ---------------- */
  function paintOffline(err) {
    var box = $('#offline');
    if (online) { box.hidden = true; return; }
    box.hidden = false;
    var span = box.querySelector('span');
    span.textContent = '⚠ 未连接服务端，页面为只读状态' + (err && err.message ? '（' + err.message + '）' : '');
  }

  /* ---------------- 弹窗 ---------------- */
  function openModal(el) { el.hidden = false; document.body.style.overflow = 'hidden'; }
  function closeModal(el) { el.hidden = true; document.body.style.overflow = ''; }
  function closeAll() {
    closeModal($('#linkModal'));
    closeModal($('#setModal'));
    closeModal($('#pwdModal'));
    revertBrand();
  }

  /* ---------------- 服务表单 ---------------- */
  /* 图标是不是一个图片地址 */
  function isIconUrl(v) {
    return /^(\/|https?:\/\/)/i.test(String(v || '').trim());
  }

  function paintIconPreview() {
    var box = $('#iconPrev');
    if (!box) return;
    var url = isIconUrl(formIcon) ? formIcon : '';

    if (url) {
      box.className = 'ico-prev has-img';
      box.innerHTML = '<img src="' + esc(url) + '" alt="">';
      $('#iconClearBtn').hidden = false;
    } else {
      var show = formIcon || ($('#f-name') ? ($('#f-name').value.trim() || '图').slice(0, 1) : '图');
      box.className = 'ico-prev';
      box.innerHTML = '<span style="font-size:' + Math.round(iconFontSize(show) * 0.8) + 'px">' + esc(show) + '</span>';
      $('#iconClearBtn').hidden = true;
    }
  }

  function buildIconPicker() {
    $('#iconPick').innerHTML = EMOJIS.map(function (e) {
      return '<button class="pick' + (e === formIcon ? ' on' : '') + '" type="button" data-icon="' + e + '">' + e + '</button>';
    }).join('');
  }

  function buildColorPicker() {
    $('#colorPick').innerHTML = PALETTE.map(function (c) {
      return '<button class="pick color' + (c === formColor ? ' on' : '') + '" type="button" data-color="' + c +
        '" style="color:' + c + '"><i style="background:' + c + '"></i></button>';
    }).join('');
  }

  function buildBrandPicker() {
    var cur = String(formBrand || '').toLowerCase();

    $('#brandPick').innerHTML = BRAND_THEMES.map(function (t) {
      var on = t.color.toLowerCase() === cur;
      return '<button class="swatch' + (on ? ' on' : '') + '" type="button" data-brand="' + t.color +
        '" style="color:' + t.color + '" title="' + esc(t.name) + '">' +
        '<i style="background:' + t.color + '"></i><span>' + esc(t.name) + '</span></button>';
    }).join('');

    $('#brandColor').value = /^#[0-9a-fA-F]{6}$/.test(formBrand) ? formBrand : '#2fa795';
    $('#brandHex').value = formBrand;
  }

  function syncSwatchSelection() {
    var cur = String(formBrand || '').toLowerCase();
    Array.prototype.forEach.call($('#brandPick').querySelectorAll('.swatch'), function (el) {
      el.classList.toggle('on', String(el.dataset.brand).toLowerCase() === cur);
    });
  }

  /* HSL -> HEX */
  function hslToHex(h, sat, lig) {
    sat /= 100; lig /= 100;
    var k = function (n) { return (n + h / 30) % 12; };
    var a = sat * Math.min(lig, 1 - lig);
    var f = function (n) {
      var c = lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }

  /* 12 色相 × 4 明度 = 48 色 */
  function buildPalette() {
    var cells = [];
    for (var row = 0; row < 4; row++) {
      for (var col = 0; col < 12; col++) {
        cells.push(hslToHex(col * 30, row === 0 ? 58 : 70, 78 - row * 17));
      }
    }
    $('#palette').innerHTML = cells.map(function (c) {
      return '<button class="pcell" type="button" data-color="' + c + '" style="background:' + c + '" title="' + c + '"></button>';
    }).join('');
    syncPaletteSelection();
  }

  function syncPaletteSelection() {
    var box = $('#palette');
    if (!box) return;
    var cur = String(formBrand || '').toLowerCase();
    Array.prototype.forEach.call(box.querySelectorAll('.pcell'), function (el) {
      el.classList.toggle('on', el.dataset.color === cur);
    });
  }

  /* 统一入口：设定主题色并刷新所有控件 */
  function setBrandColor(hex) {
    var v = String(hex || '').toLowerCase();
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) return;
    formBrand = v;
    $('#brandColor').value = v;
    $('#brandHex').value = v;
    syncSwatchSelection();
    syncPaletteSelection();
    applyBrand(v);
  }

  function openLinkModal(link) {
    if (!online) { toast('未连接服务端，暂时无法编辑'); return; }
    if (!canEdit()) { toast('当前账号没有编辑权限'); return; }

    editingId = link ? link.id : null;
    $('#linkModalTitle').textContent = link ? '编辑服务' : '添加服务';
    $('#f-name').value = link ? link.name || '' : '';
    $('#f-cat').value = link ? link.cat || '' : (activeCat === '全部' ? '' : activeCat);
    $('#f-desc').value = link ? link.desc || '' : '';
    $('#f-lan').value = link ? link.urlLan || '' : '';
    $('#f-wan').value = link ? link.urlWan || '' : '';
    $('#f-noframe').checked = !!(link && link.noFrame);

    formIcon = link ? (link.icon || '') : '';
    formColor = link ? (/^#[0-9a-fA-F]{6}$/.test(link.color || '') ? link.color : PALETTE[0])
      : PALETTE[Math.floor(Math.random() * PALETTE.length)];

    $('#f-icon').value = isIconUrl(formIcon) ? '' : formIcon;
    $('#urlWarn').hidden = true;
    $('#deleteBtn').hidden = !link;

    buildIconPicker();
    paintIconPreview();
    buildColorPicker();
    openModal($('#linkModal'));
    setTimeout(function () { $('#f-name').focus(); }, 80);
  }

  function normalizeUrl(v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (/^(javascript|data|vbscript|file):/i.test(v)) return '';
    if (v.charAt(0) === '/') return v;
    if (!/^https?:\/\//i.test(v)) return 'http://' + v.replace(/^\/+/, '');
    return v;
  }

  function saveLink() {
    var name = $('#f-name').value.trim();
    var lan = normalizeUrl($('#f-lan').value);
    var wan = normalizeUrl($('#f-wan').value);

    if (!name) { $('#f-name').focus(); toast('请填写服务名称'); return; }
    if (!lan && !wan) { $('#urlWarn').hidden = false; $('#f-lan').focus(); return; }
    $('#urlWarn').hidden = true;

    var payload = {
      name: name,
      cat: $('#f-cat').value.trim() || '未分类',
      desc: $('#f-desc').value.trim(),
      icon: isIconUrl(formIcon) ? formIcon : clipIcon(formIcon || '', 4),
      color: formColor,
      urlLan: lan,
      urlWan: wan,
      noFrame: $('#f-noframe').checked
    };

    var p = editingId
      ? mutate('PUT', '/api/links/' + encodeURIComponent(editingId), payload, '已更新')
      : mutate('POST', '/api/links', payload, '已添加');

    p.then(function (ok) {
      if (!ok) return;
      closeModal($('#linkModal'));
      if (!editingId) {
        activeCat = '全部';
        keyword = '';
        $('#searchInput').value = '';
        render();
      }
      editingId = null;
    });
  }

  function deleteLink(id) {
    var link = state.links.find(function (l) { return l.id === id; });
    if (!link) return;

    askConfirm({
      title: '删除这个服务？',
      text: '删除后，所有同事都将看不到「' + link.name + '」这个入口。',
      okText: '删除',
      danger: true
    }).then(function (yes) {
      if (!yes) return;
      mutate('DELETE', '/api/links/' + encodeURIComponent(id), undefined, '已删除').then(function (ok) {
        if (ok) closeModal($('#linkModal'));
      });
    });
  }

  /* ---------------- 图片上传 ---------------- */
  function uploadImage(file) {
    if (!file) return Promise.reject(new Error('没有选择文件'));
    if (file.size > 6 * 1024 * 1024) return Promise.reject(new Error('图片不能超过 6MB'));

    var type = file.type || '';
    if (!/^image\//.test(type)) return Promise.reject(new Error('请选择图片文件'));

    return fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': type },
      body: file
    })
      .then(function (r) {
        return r.json().catch(function () { return { ok: false, error: '上传失败' }; })
          .then(function (d) { d._status = r.status; return d; });
      })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || '上传失败');
        return d.url;
      });
  }

  function paintLogoPreview() {
    var img = $('#logoImg');
    var txt = $('#logoText');
    var box = $('#logoBox');

    if (formLogoImage) {
      img.src = formLogoImage;
      img.hidden = false;
      txt.hidden = true;
      box.classList.add('has-img');
      $('#logoClearBtn').hidden = false;
      fitLogoBox(box, formLogoImage, 70, 2.4);
      if (window.probeLogo) {
        window.probeLogo(formLogoImage, function (info) {
          if (formLogoImage !== img.getAttribute('src')) return;   // 期间又换了图
          window.paintLogo(box, info, formLogoImage);
        });
      }
    } else {
      img.hidden = true;
      img.removeAttribute('src');
      txt.hidden = false;
      txt.textContent = ($('#s-logo').value.trim() || '企').slice(0, 2);
      box.classList.remove('has-img', 'is-alpha', 'tone-dark', 'tone-light');
      $('#logoClearBtn').hidden = true;
      box.style.removeProperty('width');
    }
  }

  function paintWall(boxSel, url, clearSel) {
    var box = $(boxSel);
    if (!box) return;
    var wrap = box.closest('.hero-upl');

    if (url) {
      box.style.setProperty('--hero-thumb', 'url("' + String(url).replace(/"/g, '%22') + '")');
      wrap.classList.add('has-img');
      $(clearSel).hidden = false;
    } else {
      box.style.removeProperty('--hero-thumb');
      wrap.classList.remove('has-img');
      $(clearSel).hidden = true;
    }
  }

  function paintHeroPreview() {
    paintWall('#heroImgBox', formHeroImage, '#heroClearBtn');
    paintWall('#heroImgBoxDark', formHeroDark, '#heroClearBtnDark');
    syncWallPresets();
  }

  function buildWallPresets() {
    var html = WALLPAPERS.map(function (w) {
      var bg = w.url
        ? 'url("' + w.url + '")'
        : 'url("/assets/bg-default.svg")';
      return '<button class="wp" type="button" data-url="' + w.url + '" data-name="' + esc(w.name) +
        '" style="background-image:' + bg.replace(/"/g, '&quot;') + '"></button>';
    }).join('');

    var l = $('#presetLight');
    var d = $('#presetDark');
    if (l) l.innerHTML = html;
    if (d) d.innerHTML = html;
    syncWallPresets();
  }

  function syncWallPresets() {
    [['#presetLight', formHeroImage], ['#presetDark', formHeroDark]].forEach(function (pair) {
      var box = $(pair[0]);
      if (!box) return;
      var cur = String(pair[1] || '');
      Array.prototype.forEach.call(box.querySelectorAll('.wp'), function (el) {
        el.classList.toggle('on', el.dataset.url === cur);
      });
    });
  }

  /* ---------------- 设置 ---------------- */
  function openSettings() {
    var s = state.settings;
    $('#s-company').value = s.company || '';
    $('#s-companyEn').value = s.companyEn || '';
    $('#s-slogan').value = s.slogan || '';
    $('#s-heroFoot').value = s.heroFoot || '';
    $('#s-heroImage').value = s.heroImage || '';
    $('#s-logo').value = s.logo || '';

    Array.prototype.forEach.call(document.querySelectorAll('.wall-tab'), function (x, i) {
      x.classList.toggle('on', i === 0);
    });
    $('#wallLight').hidden = false;
    $('#wallDark').hidden = true;

    formLogoImage = s.logoImage || '';
    formHeroImage = s.heroImage || '';
    formHeroDark = s.heroImageDark || '';
    paintLogoPreview();
    paintHeroPreview();
    $('#s-mode').value = s.netMode || 'auto';
    $('#s-probe').value = (s.probeUrls || []).join('\n');
    $('#lanFillBtn').hidden = !(state.lan && state.lan.length);

    $('#s-font').value = s.fontFamily || '';
    $('#s-tabpop').value = s.tabPopups === 'allow' ? 'allow' : 'block';
    formTabPop = $('#s-tabpop').value;
    $('#s-open').value = s.openMode || (s.openInNewTab === false ? 'same' : 'new');
    $('#s-glow').value = s.heroGlow === false ? '0' : '1';
    formGlow = /^#[0-9a-fA-F]{6}$/.test(s.glowColor || '') ? s.glowColor : '';
    $('#glowColor').value = formGlow || '#69e7c7';
    formInkLight = /^#[0-9a-fA-F]{6}$/.test(s.inkLight || '') ? s.inkLight : '';
    formInkDark = /^#[0-9a-fA-F]{6}$/.test(s.inkDark || '') ? s.inkDark : '';
    paintInk();
    setPane(0);

    var admin = isAdmin();
    $('#loginRow').hidden = !admin;
    $('#usersBtn2').hidden = !admin;
    if (admin) $('#s-requireLogin').value = s.requireLogin === false ? '0' : '1';

    formBrand = /^#[0-9a-fA-F]{6}$/.test(s.brandColor || '') ? s.brandColor.toLowerCase() : BRAND_THEMES[0].color;
    buildBrandPicker();
    buildPalette();
    buildWallPresets();

    if ($('#verTag')) $('#verTag').textContent = state.version ? 'v' + state.version : 'v—';
    loadUploadStat();
    if ($('#updBox')) { $('#updBox').hidden = true; $('#updBox').className = 'upd-box'; }

    $('#serverInfo').textContent = online
      ? ('服务端已连接 · ' + state.links.length + ' 个服务 · 最后更新 ' + fmtTime(s.updatedAt) +
         (s.requireLogin === false ? ' · 游客可浏览' : ' · 需登录访问'))
      : '服务端未连接';

    if (DESKTOP) loadServerInfo();

    openModal($('#setModal'));
  }

  /* ---------------- 桌面端：连哪个服务端 ---------------- */
  function loadServerInfo() {
    if (!DESKTOP || !window.desktopAPI.getServerInfo) return;
    if ($('#deskSec')) $('#deskSec').hidden = false;

    window.desktopAPI.getServerInfo().then(function (info) {
      if (!$('#s-server')) return;
      $('#s-server').value = info.configured ? info.origin : '';
      $('#serverNow').textContent = !info.origin
        ? '还没连接服务端'
        : ('当前 ' + info.origin + (info.local ? '（本机）' : '（远端，数据在对方机器上）'));
      if ($('#s-proxy')) $('#s-proxy').value = info.updateProxy || '';
    }).catch(function () {});
  }

  /* ---------------- 检查更新 ---------------- */
  function paintUpdate(d) {
    var box = $('#updBox');
    if (!box) return;
    box.hidden = false;
    box.className = 'upd-box';

    if (!d || !d.ok) {
      box.classList.add('warn');
      box.textContent = d && d.reason === 'disabled'
        ? '更新检查已被关闭（DISABLE_UPDATE_CHECK=1）'
        : '暂时连不上更新服务，可能这台机器不能访问外网';
      return;
    }

    if (d.hasUpdate) {
      box.classList.add('new');
      box.innerHTML =
        '<b>发现新版本 v' + esc(d.latest) + '</b>' +
        '<span class="upd-cur">当前 v' + esc(d.current) + '</span>' +
        (d.notes ? '<pre class="upd-notes">' + esc(d.notes) + '</pre>' : '') +
        (isAdmin() ? '<button class="btn-primary sm upd-go" id="doUpdateBtn" type="button" data-ver="' + esc(d.latest) + '">立即更新</button>' : '') +
        (d.download ? '<a class="upd-link" href="' + esc(d.download) + '" target="_blank" rel="noopener">下载更新包</a>' : '') +
        (d.url ? '<a class="upd-link" href="' + esc(d.url) + '" target="_blank" rel="noopener">查看更新说明</a>' : '');
    } else {
      box.classList.add('ok');
      box.textContent = '已是最新版本 v' + d.current;
    }
  }

  function isAdmin() {
    return !!(authUser && authUser.role === 'admin');
  }

  /* ---------- 一键更新 ---------- */
  function updMask(text, hint) {
    var mask = document.getElementById('updMask');
    if (!mask) {
      mask = document.createElement('div');
      mask.className = 'upd-mask';
      mask.id = 'updMask';
      mask.innerHTML = '<div class="upd-card"><div class="upd-spin"></div>' +
        '<h3 id="updTitle"></h3><p id="updHint"></p></div>';
      document.body.appendChild(mask);
    }
    document.getElementById('updTitle').textContent = text || '正在更新';
    document.getElementById('updHint').textContent = hint || '';
  }

  function dropMask() {
    var mask = document.getElementById('updMask');
    if (mask) mask.parentNode.removeChild(mask);
  }

  /* 更新完不能只 reload：浏览器可能还拿缓存里的旧 app.js / style.css，
     表现是界面写着新版本号、行为却还是老的。带一个时间戳把缓存绕开。 */
  function hardReload() {
    var u = new URL(location.href);
    u.searchParams.set('_r', Date.now().toString(36));
    location.replace(u.toString());
  }

  function waitRestart(to) {
    var started = Date.now();
    var timer = setInterval(function () {
      fetch('/api/ping', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.version === to) {
            clearInterval(timer);
            updMask('更新完成', '新版本 v' + to + ' 已就绪，正在重新加载…');
            setTimeout(hardReload, 900);
          } else {
            updMask('正在启动新版本', '服务重启中，请稍候…');
          }
        })
        .catch(function () {
          updMask('正在重启服务', '大约需要 10 秒，请勿关闭页面…');
        });

      if (Date.now() - started > 90000) {
        clearInterval(timer);
        updMask('更新超时', '已等待 90 秒仍未恢复，请按 Ctrl+F5 强制刷新，或查看 data/update.log');
      }
    }, 1500);
  }

  function doAutoUpdate(to) {
    window.askConfirm({
      title: '更新到 v' + to,
      text: '会下载安装包并自动重启服务，期间约 10 秒无法访问。data 目录和 config.json 会原样保留，旧文件自动备份到 data 下。',
      okText: '开始更新',
      danger: true
    }).then(function (yes) {
      if (!yes) return;

      updMask('正在下载安装包', '请勿关闭页面…');

      fetch('/api/system/update', { method: 'POST', cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) throw new Error(d.error || '更新失败');
          updMask('正在重启服务', '大约需要 10 秒…');
          waitRestart(d.to);
        })
        .catch(function (e) {
          dropMask();
          toast(e.message || '更新失败');
        });
    });
  }

  /* ---------- 上传文件统计与清理 ---------- */
  function paintUploadStat(d) {
    var el = $('#uploadStat');
    if (!el) return;
    if (!d || !d.ok) { el.textContent = ''; return; }
    el.textContent = '上传目录 ' + d.count + ' 个文件 · ' + (d.size / 1048576).toFixed(1) + ' MB' +
      (d.unused ? '，其中 ' + d.unused + ' 个没被引用' : '');
  }

  function loadUploadStat() {
    if (!isAdmin()) return;
    $('#sweepBtn').hidden = false;
    fetch('/api/system/uploads', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(paintUploadStat)
      .catch(function () {});
  }

  function doSweepUploads() {
    window.askConfirm({
      title: '清理未使用的图片',
      text: '上传过但现在已经没人引用的 Logo、壁纸、图标会被删掉。正在使用的不会动。',
      okText: '清理',
      danger: true
    }).then(function (yes) {
      if (!yes) return;
      fetch('/api/system/sweep-uploads', { method: 'POST', cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) throw new Error(d.error || '清理失败');
          paintUploadStat(d);
          toast(d.removed
            ? ('已清理 ' + d.removed + ' 个文件，释放 ' + (d.freed / 1048576).toFixed(1) + ' MB')
            : '没有需要清理的文件');
        })
        .catch(function (e) { toast(e.message || '清理失败'); });
    });
  }

  function checkUpdate() {
    var btn = $('#checkUpdateBtn');
    btn.disabled = true;
    btn.textContent = '检查中…';
    fetch('/api/update/check?force=1', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(paintUpdate)
      .catch(function () { paintUpdate({ ok: false, reason: 'error' }); })
      .then(function () {
        btn.disabled = false;
        btn.textContent = '检查更新';
      });
  }

  /* ---------- 测试探测地址是否真的能连通 ---------- */
  function testProbes() {
    var btn = $('#probeTestBtn');
    var box = $('#probeRes');
    var list = $('#s-probe').value.split('\n').map(normalizeUrl).filter(Boolean);

    if (!list.length) {
      box.className = 'probe-res warn';
      box.textContent = '还没填地址';
      return;
    }

    // HTTPS 页面里探测 http:// 会被浏览器当混合内容拦掉，一定失败
    var hasHttp = list.some(function (u) { return /^http:\/\//i.test(u); });
    if (location.protocol === 'https:' && hasHttp) {
      box.className = 'probe-res warn';
      box.textContent = '页面是 HTTPS，探测 HTTP 地址会被浏览器拦截，请改成 https:// 开头';
      return;
    }

    btn.disabled = true;
    btn.textContent = '测试中…';
    box.className = 'probe-res';
    box.textContent = '';

    Promise.all(list.map(function (u) { return probeOnce(u, 2500); })).then(function (rs) {
      var ok = rs.filter(Boolean).length;
      var bad = list.filter(function (u, i) { return !rs[i]; });

      if (ok === 0) {
        box.className = 'probe-res warn';
        box.textContent = '全部连不上：' + bad.join('、') + '。地址写错或端口不通；只响应 ping、没开网页端口的设备也测不通（浏览器发不了 ICMP），换成有网页端口的地址';
      } else if (ok === list.length) {
        box.className = 'probe-res ok';
        box.textContent = '全部可连通（' + ok + '/' + list.length + '），保存后按内网处理';
      } else {
        box.className = 'probe-res ok';
        box.textContent = ok + '/' + list.length + ' 可连通，连不上的：' + bad.join('、');
      }

      btn.disabled = false;
      btn.textContent = '测试连通';
    });
  }

  /* 颜色输入框：没设过就显示主题默认色，保存时留空表示跟随主题 */
  function paintInk() {
    $('#inkLight').value = formInkLight || '#1a2430';
    $('#inkDark').value = formInkDark || '#e7edf3';
    $('#inkReset').textContent = (formInkLight || formInkDark) ? '跟随主题' : '已是跟随主题';
  }

  /* 设置分页：一次只看一类，别堆在一起 */
  function setPane(idx) {
    Array.prototype.forEach.call(document.querySelectorAll('#setNav .set-nav-btn'), function (b, i) {
      b.classList.toggle('on', i === idx);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#setPanes .set-pane'), function (p, i) {
      p.hidden = i !== idx;
    });
    var box = $('#setPanes');
    if (box) box.scrollTop = 0;
  }

  function saveSettings() {
    var payload = {
      company: $('#s-company').value.trim() || '企业服务大厅',
      companyEn: $('#s-companyEn').value.trim(),
      slogan: $('#s-slogan').value.trim(),
      heroFoot: $('#s-heroFoot').value.trim(),
      heroImage: formHeroImage,
      heroImageDark: formHeroDark,
      logoImage: formLogoImage,
      logo: $('#s-logo').value.trim().slice(0, 2),
      brandColor: formBrand,
      netMode: $('#s-mode').value,
      probeUrls: $('#s-probe').value.split('\n').map(normalizeUrl).filter(Boolean),
      openMode: $('#s-open').value,
      tabPopups: $('#s-tabpop').value,
      fontFamily: $('#s-font').value,
      heroGlow: $('#s-glow').value === '1',
      glowColor: formGlow,
      inkLight: formInkLight,
      inkDark: formInkDark
    };
    if (isAdmin()) payload.requireLogin = $('#s-requireLogin').value !== '0';

    mutate('PUT', '/api/settings', payload, '设置已保存').then(function (ok) {
      if (!ok) return;
      closeModal($('#setModal'));
      applyType();
      refreshNet();

      // 弹窗策略是写在 iframe 的 sandbox 上的，改了得重建页签才生效
      if (payload.tabPopups !== formTabPop && tabs.length) {
        formTabPop = payload.tabPopups;
        var box = $('#tabFrames');
        Array.prototype.slice.call(box.querySelectorAll('iframe, .tabfail')).forEach(function (el) {
          el.parentNode.removeChild(el);
        });
        syncTabs();
      }
    });
  }

  /* ---------- 下载进度卡 ---------- */
  /* 备份包动辄几 MB，点完到浏览器弹出下载条之间是全黑的：
     用户不知道是在打包、在传、还是根本没点上。这里边收边显示。 */
  function fmtSize(n) {
    if (!isFinite(n) || n < 0) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function dlCard(name) {
    var box = document.getElementById('dlStack');
    if (!box) {
      box = document.createElement('div');
      box.className = 'dl-stack';
      box.id = 'dlStack';
      document.body.appendChild(box);
    }

    var el = document.createElement('div');
    el.className = 'dl-card';
    el.innerHTML =
      '<div class="dl-top">' +
        '<span class="dl-name"></span>' +
        '<span class="dl-pct">0%</span>' +
      '</div>' +
      '<div class="dl-bar"><i></i></div>' +
      '<div class="dl-sub"><span class="dl-state">正在打包…</span><span class="dl-size"></span></div>';
    el.querySelector('.dl-name').textContent = name;
    box.appendChild(el);

    requestAnimationFrame(function () { el.classList.add('show'); });

    return {
      node: el,
      setName: function (v) { el.querySelector('.dl-name').textContent = v; },
      set: function (p, state, size) {
        var pct = Math.max(0, Math.min(100, Math.round(p * 100)));
        el.querySelector('.dl-pct').textContent = pct + '%';
        el.querySelector('.dl-bar i').style.width = pct + '%';
        if (state) el.querySelector('.dl-state').textContent = state;
        el.querySelector('.dl-size').textContent = size || '';
      },
      close: function (delay) {
        setTimeout(function () {
          el.classList.remove('show');
          setTimeout(function () { el.parentNode && el.parentNode.removeChild(el); }, 260);
        }, delay || 0);
      }
    };
  }

  function downloadWithProgress(url, fallbackName) {
    var name = fallbackName || 'download';

    // 没有流式读取的老内核就老老实实交给浏览器
    if (!window.fetch || !window.AbortController || !window.ReadableStream) {
      location.href = url;
      return;
    }

    var card = dlCard(name);
    var got = 0;
    var total = 0;

    function save(blob) {
      var href = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = href;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(href);
        a.parentNode && a.parentNode.removeChild(a);
      }, 1200);

      card.node.classList.add('is-ok');
      card.set(1, '下载完成', fmtSize(blob.size));
      card.close(2800);
    }

    fetch(url, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('服务器返回 HTTP ' + res.status);

        var cd = res.headers.get('Content-Disposition') || '';
        var m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
        if (m && m[1]) {
          try {
            name = decodeURIComponent(m[1].trim());
            card.setName(name);
          } catch (e) {}
        }

        total = parseInt(res.headers.get('Content-Length') || '0', 10) || 0;

        if (!res.body || !res.body.getReader) return res.blob().then(save);

        var reader = res.body.getReader();
        var chunks = [];
        var type = res.headers.get('Content-Type') || 'application/octet-stream';

        card.set(0, '正在接收…', total ? ('0 / ' + fmtSize(total)) : '');

        (function pump() {
          return reader.read().then(function (r) {
            if (r.done) return save(new Blob(chunks, { type: type }));

            chunks.push(r.value);
            got += r.value.length;

            if (total) {
              card.set(got / total,
                got >= total ? '正在保存…' : '正在接收…',
                fmtSize(got) + ' / ' + fmtSize(total));
            } else {
              // 没给长度就按「已接收多少」显示，进度条只走到 95%
              card.set(Math.min(0.95, got / (got + 2 * 1048576)), '正在接收…', fmtSize(got));
            }

            return pump();
          });
        })();
      })
      .catch(function (e) {
        card.node.classList.add('is-err');
        card.set(0, (e && e.message) || '下载失败', '');
        card.close(5000);
      });
  }

  function doExport() {
    if (!online) { toast('未连接服务端'); return; }
    downloadWithProgress('/api/export', 'portal-backup.zip');
  }

  function doImport(file) {
    var reader = new FileReader();

    reader.onload = function () {
      var buf = reader.result;
      var head = new Uint8Array(buf.slice(0, 4));
      var isZip = /\.zip$/i.test(file.name || '') ||
        (head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4);

      var data = null;
      if (!isZip) {
        try { data = JSON.parse(new TextDecoder('utf-8').decode(buf)); }
        catch (e) { toast('文件不是合法的 JSON'); return; }
      }

      var arr = data && data.links ? data.links : (data && data.state ? data.state.links : null);
      if (!isZip && !Array.isArray(arr)) { toast('文件里找不到 links 字段'); return; }

      askConfirm({
        title: '导入会覆盖现有数据',
        text: '服务器上现有的 ' + state.links.length + ' 个服务将被' +
          (isZip ? '压缩包里的服务' : '文件中的 ' + arr.length + ' 个服务') + '替换，此操作无法撤销。',
        okText: '覆盖导入',
        danger: true
      }).then(function (yes) {
        if (!yes) return;

        var done = function (msg) {
          activeCat = '全部';
          keyword = '';
          $('#searchInput').value = '';
          closeModal($('#setModal'));
          render();
          if (msg) toast(msg);
        };

        if (isZip) {
          // zip 里带图片，走二进制，不能用 mutate 的 JSON 封装
          fetch('/api/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/zip' },
            body: file,
            cache: 'no-store'
          })
            .then(function (r) {
              return r.json().then(function (d) { return { ok: r.ok, d: d }; });
            })
            .then(function (res) {
              if (!res.ok || !res.d || !res.d.ok) throw new Error((res.d && res.d.error) || '导入失败');
              applyPayload(res.d);
              done('已导入 ' + res.d.imported + ' 个服务' +
                (res.d.images ? '、' + res.d.images + ' 张图片' : ''));
              if (res.d.missing) {
                setTimeout(function () { toast('有 ' + res.d.missing + ' 个图片不在包里，可能显示不出来'); }, 1900);
              }
            })
            .catch(function (e) { toast(e.message || '导入失败'); });
          return;
        }

        mutate('POST', '/api/import', data, '已导入 ' + arr.length + ' 条数据').then(function (ok) {
          if (ok) done();
        });
      });
    };

    reader.readAsArrayBuffer(file);
  }

  /* ---------------- Toast ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    requestAnimationFrame(function () { t.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.hidden = true; }, 240);
    }, 2400);
  }

  /* ---------------- 主题 ---------------- */
  var THEME_MODES = ['system', 'light', 'dark'];
  var themeSynced = false;

  function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function currentThemeMode() {
    try {
      var v = localStorage.getItem('cp-theme');
      if (THEME_MODES.indexOf(v) > -1) return v;
    } catch (e) {}
    return 'system';
  }

  function resolveTheme(mode) {
    if (mode === 'dark' || mode === 'light') return mode;
    return systemPrefersDark() ? 'dark' : 'light';
  }

  function paintThemeBtn(mode, actual) {
    var btn = $('#themeBtn');
    if (!btn) return;
    var label = mode === 'system'
      ? ('跟随系统（当前' + (actual === 'dark' ? '深色' : '浅色') + '）')
      : (mode === 'dark' ? '深色模式' : '浅色模式');
    btn.title = label + '　点击切换：跟随系统 → 浅色 → 深色';
  }

  /* 应用主题偏好：system | light | dark（存本地 + 同步到账号） */
  var FONT_STACKS = {
    '': '"PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, -apple-system, sans-serif',
    yahei: '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif',
    songti: '"Source Han Serif SC", "Noto Serif SC", SimSun, "Songti SC", serif',
    simhei: 'SimHei, "Heiti SC", "Microsoft YaHei", sans-serif',
    kaiti: 'KaiTi, "Kaiti SC", STKaiti, serif',
    fangsong: 'FangSong, STFangsong, "Songti SC", serif',
    dengxian: 'DengXian, "Microsoft YaHei", system-ui, sans-serif',
    segoe: '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif'
  };

  /* 字体与文字颜色：留空就跟主题走，不写死 */
  function applyType() {
    var root = document.documentElement;
    var st = state.settings;

    root.style.setProperty('--font-sans', FONT_STACKS[st.fontFamily] || FONT_STACKS['']);

    var dark = root.getAttribute('data-theme') === 'dark';
    var ink = dark ? st.inkDark : st.inkLight;
    if (/^#[0-9a-fA-F]{6}$/.test(ink || '')) root.style.setProperty('--ink', ink);
    else root.style.removeProperty('--ink');

    /* 首屏光晕：关闭就整个去掉，改色按亮度派生亮/暗两层 */
    var glowOn = st.heroGlow !== false;
    root.setAttribute('data-glow', glowOn ? 'on' : 'off');

    var gc = /^#[0-9a-fA-F]{6}$/.test(st.glowColor || '') ? st.glowColor : '';
    if (!gc) {
      root.style.removeProperty('--glow-soft');
      root.style.removeProperty('--glow-deep');
    } else {
      var r = parseInt(gc.slice(1, 3), 16);
      var g = parseInt(gc.slice(3, 5), 16);
      var b = parseInt(gc.slice(5, 7), 16);
      var dim = function (v) { return Math.round(v * 0.32); };
      root.style.setProperty('--glow-soft', 'rgba(' + r + ',' + g + ',' + b + ',.20)');
      root.style.setProperty('--glow-deep', 'rgba(' + dim(r) + ',' + dim(g) + ',' + dim(b) + ',.62)');
    }
  }


  function applyThemeMode(mode, opts) {
    opts = opts || {};
    var m = THEME_MODES.indexOf(mode) > -1 ? mode : 'system';
    var actual = resolveTheme(m);

    document.documentElement.setAttribute('data-theme', actual);
    document.documentElement.setAttribute('data-theme-mode', m);

    try { localStorage.setItem('cp-theme', m); } catch (e) {}

    applyHeroBackground();
    applyType();
    paintThemeBtn(m, actual);

    // 登录用户把偏好存到自己的账号上，换设备也跟着走
    if (!opts.local && authUser) {
      authUser.theme = m;
      api('PUT', '/api/me/theme', { theme: m }).catch(function () {});
    }

    if (!opts.silent) {
      toast(m === 'system'
        ? ('跟随系统 · 当前' + (actual === 'dark' ? '深色' : '浅色'))
        : (m === 'dark' ? '深色模式' : '浅色模式'));
    }
    return m;
  }

  function cycleTheme() {
    var cur = currentThemeMode();
    var next = THEME_MODES[(THEME_MODES.indexOf(cur) + 1) % THEME_MODES.length];
    applyThemeMode(next);
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    /* 导航随滚动变色 */
    var nav = $('#nav');
    var hero = $('#top');
    function onScroll() {
      var limit = (hero ? hero.offsetHeight : 400) * 0.72;
      nav.classList.toggle('scrolled', window.scrollY > limit);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    /* 进入门户：未登录先去登录，已登录平滑滚到服务区 */
    function goPortal(e) {
      if (e) e.preventDefault();
      if (guest) {
        location.href = '/login.html?next=' + encodeURIComponent('/');
        return;
      }
      var svc = $('#services');
      if (svc) svc.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    $('#enterBtn').addEventListener('click', goPortal);
    $('#heroFootLink').addEventListener('click', goPortal);

    /* 搜索 */
    var si = $('#searchInput');
    si.addEventListener('input', function () {
      keyword = si.value;
      renderGroups();
      if (keyword && !jumpedToService) {
        jumpedToService = true;
        var svc = $('#services');
        if (svc) svc.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      if (!keyword) jumpedToService = false;
    });
    si.addEventListener('focus', function () {
      if (guest) { location.href = '/login.html?next=/'; return; }
      if (window.scrollY < window.innerHeight * 0.5) {
        var svc = $('#services');
        if (svc) svc.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    /* 分类 */
    $('#catBar').addEventListener('click', function (e) {
      var tab = e.target.closest('.tab');
      if (!tab) return;
      activeCat = tab.dataset.cat;
      renderCats();
      renderGroups();
    });

    /* 图标墙交互 */
    var groups = $('#groups');

    groups.addEventListener('click', function (e) {
      var tile = e.target.closest('.tile');
      if (!tile) return;
      var id = tile.dataset.id;

      var act = e.target.closest('[data-act]');
      if (act) {
        e.stopPropagation();
        var link = state.links.find(function (l) { return l.id === id; });
        if (link) openLinkModal(link);
        return;
      }
      var l = state.links.find(function (x) { return x.id === id; });
      if (l) openLink(l);
    });

    groups.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var tile = e.target.closest('.tile');
      if (!tile) return;
      e.preventDefault();
      var l = state.links.find(function (x) { return x.id === tile.dataset.id; });
      if (l) openLink(l);
    });

    /* 新增 */
    $('#addBtn').addEventListener('click', function () { openLinkModal(null); });
    $('#emptyAddBtn').addEventListener('click', function () { openLinkModal(null); });

    /* 弹窗关闭 */
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) {
        var m = e.target.closest('.modal');
        if (m) {
          closeModal(m);
          if (m.id === 'setModal') revertBrand();
        }
      }
    });

    /* ---- 图片上传 ---- */
    function onPickFile(inputId, handler) {
      var input = $(inputId);
      input.addEventListener('change', function () {
        var f = this.files && this.files[0];
        this.value = '';
        if (f) handler(f);
      });
    }

    $('#iconUploadBtn').addEventListener('click', function () { $('#iconFile').click(); });

    $('#iconClearBtn').addEventListener('click', function () {
      formIcon = '';
      $('#f-icon').value = '';
      buildIconPicker();
      paintIconPreview();
    });

    onPickFile('#iconFile', function (f) {
      uploadImage(f).then(function (url) {
        formIcon = url;
        $('#f-icon').value = '';
        buildIconPicker();
        paintIconPreview();
        toast('图标已上传，点保存后生效');
      }).catch(function (e) { if (e.message) toast(e.message); });
    });

    $('#logoUploadBtn').addEventListener('click', function () { $('#logoFile').click(); });
    $('#heroUploadBtn').addEventListener('click', function () { $('#heroFile').click(); });

    onPickFile('#logoFile', function (f) {
      uploadImage(f).then(function (url) {
        formLogoImage = url;
        paintLogoPreview();
        toast('Logo 已上传，点保存后生效');
      }).catch(function (e) { if (e.message) toast(e.message); });
    });

    onPickFile('#heroFile', function (f) {
      uploadImage(f).then(function (url) {
        formHeroImage = url;
        $('#s-heroImage').value = url;
        paintHeroPreview();
        toast('背景图已上传，点保存后生效');
      }).catch(function (e) { if (e.message) toast(e.message); });
    });

    $('#logoClearBtn').addEventListener('click', function () {
      formLogoImage = '';
      paintLogoPreview();
    });

    $('#heroClearBtn').addEventListener('click', function () {
      formHeroImage = '';
      $('#s-heroImage').value = '';
      paintHeroPreview();
    });

    $('#s-heroImage').addEventListener('input', function () {
      formHeroImage = this.value.trim();
      paintHeroPreview();
    });

    /* 夜间壁纸 */
    $('#heroUploadBtnDark').addEventListener('click', function () { $('#heroFileDark').click(); });

    onPickFile('#heroFileDark', function (f) {
      uploadImage(f).then(function (url) {
        formHeroDark = url;
        $('#s-heroImageDark').value = url;
        paintHeroPreview();
        toast('夜间壁纸已上传，点保存后生效');
      }).catch(function (e) { if (e.message) toast(e.message); });
    });

    /* 预置壁纸 */
    function bindPreset(sel, target) {
      var box = $(sel);
      if (!box) return;
      box.addEventListener('click', function (e) {
        var b = e.target.closest('.wp');
        if (!b) return;
        var url = b.dataset.url || '';

        if (target === 'light') {
          formHeroImage = url;
          $('#s-heroImage').value = url;
        } else {
          formHeroDark = url;
          $('#s-heroImageDark').value = url;
        }
        paintHeroPreview();
        toast(url ? ('已选用「' + b.dataset.name + '」壁纸') : '已恢复默认壁纸');
      });
    }
    bindPreset('#presetLight', 'light');
    bindPreset('#presetDark', 'dark');

    $('#heroClearBtnDark').addEventListener('click', function () {
      formHeroDark = '';
      $('#s-heroImageDark').value = '';
      paintHeroPreview();
    });

    $('#s-heroImageDark').addEventListener('input', function () {
      formHeroDark = this.value.trim();
      paintHeroPreview();
    });

    /* 日间 / 夜间 壁纸页签 */
    $('.wall-tabs').addEventListener('click', function (e) {
      var t = e.target.closest('.wall-tab');
      if (!t) return;
      var wall = t.dataset.wall;

      Array.prototype.forEach.call(this.querySelectorAll('.wall-tab'), function (x) {
        x.classList.toggle('on', x === t);
      });
      $('#wallLight').hidden = wall !== 'light';
      $('#wallDark').hidden = wall !== 'dark';
    });

    $('#s-logo').addEventListener('input', paintLogoPreview);

    /* 表单里的选择器 */
    $('#iconPick').addEventListener('click', function (e) {
      var b = e.target.closest('.pick');
      if (!b) return;
      formIcon = b.dataset.icon;
      $('#f-icon').value = formIcon;
      buildIconPicker();
      paintIconPreview();
    });

    $('#colorPick').addEventListener('click', function (e) {
      var b = e.target.closest('.pick');
      if (!b) return;
      formColor = b.dataset.color;
      buildColorPicker();
    });

    $('#brandPick').addEventListener('click', function (e) {
      var b = e.target.closest('.swatch');
      if (!b) return;
      setBrandColor(b.dataset.brand);
    });

    /* 调色板选色 */
    $('#palette').addEventListener('click', function (e) {
      var b = e.target.closest('.pcell');
      if (!b) return;
      setBrandColor(b.dataset.color);
    });

    /* 任意取色：原生取色器 */
    $('#brandColor').addEventListener('input', function () {
      setBrandColor(this.value);
    });

    /* 手输 hex */
    $('#brandHex').addEventListener('input', function () {
      var v = this.value.trim().replace(/^#/, '');
      if (!/^[0-9a-fA-F]{6}$/.test(v)) return;
      setBrandColor('#' + v);
    });

    $('#brandHex').addEventListener('blur', function () {
      var v = this.value.trim().replace(/^#/, '');
      this.value = /^[0-9a-fA-F]{6}$/.test(v) ? '#' + v.toLowerCase() : formBrand;
    });

    $('#f-icon').addEventListener('input', function () {
      var v = clipIcon(this.value, 4);
      if (v !== this.value) this.value = v;
      formIcon = v;
      buildIconPicker();
      paintIconPreview();
    });

    $('#saveBtn').addEventListener('click', saveLink);
    $('#linkForm').addEventListener('submit', function (e) { e.preventDefault(); saveLink(); });
    $('#deleteBtn').addEventListener('click', function () { if (editingId) deleteLink(editingId); });

    /* 设置 */
    $('#settingsBtn').addEventListener('click', openSettings);

    $('#setNav').addEventListener('click', function (e) {
      var b = e.target.closest('[data-pane]');
      if (b) setPane(Number(b.getAttribute('data-pane')));
    });

    $('#inkLight').addEventListener('input', function () { formInkLight = this.value; paintInk(); });
    $('#inkDark').addEventListener('input', function () { formInkDark = this.value; paintInk(); });
    $('#inkReset').addEventListener('click', function () {
      formInkLight = '';
      formInkDark = '';
      paintInk();
      toast('保存后跟随深浅主题');
    });

    /* ---- 站内页标签 ---- */
    $('#tabList').addEventListener('click', function (e) {
      var x = e.target.closest('[data-close]');
      if (x) { closeTab(Number(x.getAttribute('data-close'))); return; }

      var b = e.target.closest('[data-id]');
      if (!b) return;
      var id = Number(b.getAttribute('data-id'));
      if (id === 0) goHome();
      else { activeId = id; syncTabs(); }
    });

    // 页签排不下时，滚轮直接横着滚，不用去够那条看不见的滚动条
    $('#tabList').addEventListener('wheel', function (e) {
      var list = e.currentTarget;
      if (list.scrollWidth <= list.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      list.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });

    $('#tabFrames').addEventListener('click', function (e) {
      var pop = e.target.closest('[data-pop]');
      if (pop) {
        var t1 = findTab(Number(pop.getAttribute('data-pop')));
        if (t1) openInNewTab(t1.url);
        return;
      }
      var re = e.target.closest('[data-retry]');
      if (re) {
        var rid = Number(re.getAttribute('data-retry'));
        var t2 = findTab(rid);
        var f = frameOf(rid);
        paintTabFail(rid, false);
        if (f && t2) {
          if (DESKTOP) {
            try { f.reload(); } catch (e) { f.src = t2.url; }
          } else {
            f.src = 'about:blank';
            setTimeout(function () { f.src = t2.url; }, 60);
          }
        }
      }
    });

    $('#tabNew').addEventListener('click', function (e) {
      e.stopPropagation();
      if ($('#tabPick').hidden) showPicker();
      else hidePicker();
    });

    $('#tabPick').addEventListener('click', function (e) {
      if (e.target.closest('#tabPickSearch')) return;
      var b = e.target.closest('[data-link]');
      if (!b) return;
      var id = b.getAttribute('data-link');
      var l = null;
      (state.links || []).forEach(function (x) { if (x.id === id) l = x; });
      if (!l) return;
      var u = pickUrl(l).url;
      if (l.noFrame && !DESKTOP) { openInNewTab(u); hidePicker(); return; }
      openTab(l.name, u);
    });

    $('#tabPickSearch').addEventListener('input', function () {
      buildPicker(this.value);
    });

    document.addEventListener('click', function (e) {
      if ($('#tabPick') && !$('#tabPick').hidden &&
          !e.target.closest('#tabPick') && !e.target.closest('#tabNew')) {
        hidePicker();
      }
    });

    if (DESKTOP && window.desktopAPI.onOpenTab) {
      window.desktopAPI.onOpenTab(function (url) {
        var name = url;
        try { name = new URL(url).hostname || url; } catch (e) {}
        openTab(name, url);
      });
    }

    $('#tabReload').addEventListener('click', reloadActiveTab);
    $('#tabPopup').addEventListener('click', function () {
      var t = activeTab();
      if (t) openInNewTab(t.url);
    });
    $('#tabCloseAll').addEventListener('click', function () {
      // 一起淡出，别一个个等，不然中间会重建列表
      Array.prototype.slice.call($('#tabList').querySelectorAll('.tabitem:not(.tab-home)'))
        .forEach(function (el) { el.classList.add('out'); });
      setTimeout(function () { tabs = []; activeId = 0; syncTabs(); }, 170);
    });
    $('#setSaveBtn').addEventListener('click', saveSettings);

    /* 按钮在 <label> 里，不拦一下会被 label 的默认行为把焦点丢给 textarea */
    $('#probeTestBtn').addEventListener('click', function (e) {
      e.preventDefault();
      testProbes();
    });

    $('#lanFillBtn').addEventListener('click', function (e) {
      e.preventDefault();
      var url = (state.lan || [])[0];
      if (!url) return;
      var list = $('#s-probe').value.split('\n')
        .map(function (v) { return v.trim(); })
        .filter(Boolean);
      if (list.indexOf(url) === -1) list.push(url);
      $('#s-probe').value = list.join('\n');
      toast('已填入 ' + url);
    });
    $('#checkUpdateBtn').addEventListener('click', checkUpdate);
    $('#sweepBtn').addEventListener('click', doSweepUploads);

    if (DESKTOP && $('#serverSaveBtn')) {
      $('#deskSec').hidden = false;
      loadServerInfo();

      if ($('#proxySaveBtn')) {
        $('#proxySaveBtn').addEventListener('click', function () {
          var btn = this;
          var v = $('#s-proxy').value.trim();
          btn.disabled = true;

          window.desktopAPI.setUpdateProxy(v).then(function (r) {
            btn.disabled = false;
            if (!r || !r.ok) { toast((r && r.error) || '保存失败'); return; }
            $('#s-proxy').value = r.updateProxy;
            toast(r.updateProxy ? '代理已保存，下次下载走它' : '已改为直连');
          }).catch(function () {
            btn.disabled = false;
            toast('保存失败');
          });
        });
      }

      $('#serverSaveBtn').addEventListener('click', function () {
        var v = $('#s-server').value.trim();
        var btn = this;

        // 主进程会先验证能不能连上，存好了自己重启；连不上就把原因带回来
        btn.disabled = true;
        btn.textContent = '连接中…';

        window.desktopAPI.setServer(v).then(function (r) {
          if (!r || !r.ok) {
            toast((r && r.error) || '保存失败');
            btn.disabled = false;
            btn.textContent = '保存';
            return;
          }
          toast('已连接，正在重启客户端…');
        }).catch(function () {
          toast('保存失败');
          btn.disabled = false;
          btn.textContent = '保存';
        });
      });
    }

    $('#updBox').addEventListener('click', function (e) {
      var b = e.target.closest('#doUpdateBtn');
      if (b) doAutoUpdate(b.dataset.ver);
    });
    $('#exportBtn').addEventListener('click', doExport);
    $('#importBtn').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', function () {
      if (this.files && this.files[0]) doImport(this.files[0]);
      this.value = '';
    });
    /* ---- 用户菜单 ---- */
    var drop = $('#userDrop');

    $('#userBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      drop.hidden = !drop.hidden;
    });

    document.addEventListener('click', function (e) {
      if (!drop.hidden && !e.target.closest('#userMenu')) drop.hidden = true;
    });

    $('#pwdItem').addEventListener('click', function () {
      drop.hidden = true;
      $('#p-old').value = '';
      $('#p-new').value = '';
      $('#p-new2').value = '';
      $('#pWarn').hidden = true;
      openModal($('#pwdModal'));
      setTimeout(function () { $('#p-old').focus(); }, 80);
    });

    $('#usersItem').addEventListener('click', function () { location.href = '/users.html'; });
    $('#usersBtn2').addEventListener('click', function () { location.href = '/users.html'; });

    $('#logoutItem').addEventListener('click', function () {
      drop.hidden = true;
      fetch('/api/logout', { method: 'POST' }).then(function () {
        // 退出后回大厅首页（访客视图），不停在登录页
        try { sessionStorage.setItem('cp-logged-out', '1'); } catch (e) {}
        location.replace('/');
      });
    });

    $('#pwdSaveBtn').addEventListener('click', function () {
      var warn = $('#pWarn');
      var bad = function (m) { warn.textContent = m; warn.hidden = false; };

      var oldPwd = $('#p-old').value;
      var p1 = $('#p-new').value;
      var p2 = $('#p-new2').value;

      if (!oldPwd) { bad('请输入原密码'); return; }
      if (p1.length < 6) { bad('新密码至少 6 位'); return; }
      if (p1 !== p2) { bad('两次输入的新密码不一致'); return; }
      warn.hidden = true;

      var btn = this;
      btn.disabled = true;
      btn.textContent = '提交中…';

      fetch('/api/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: p1 })
      })
        .then(function (r) { return r.json().then(function (d) { d._status = r.status; return d; }); })
        .then(function (d) {
          if (!d.ok) throw new Error(d.error || '修改失败');
          closeModal($('#pwdModal'));
          toast('密码已修改，其他设备需重新登录');
        })
        .catch(function (e) { bad(e.message); })
        .then(function () {
          btn.disabled = false;
          btn.textContent = '确认修改';
        });
    });

    $('#retryBtn').addEventListener('click', function () {
      loadState().then(function (ok) { if (ok) { toast('已重新连接'); refreshNet(); } });
    });

    /* 网络模式切换 */
    $('#netPill').addEventListener('click', function () {
      if (!canEdit()) {
        toast(authUser ? '当前账号没有切换网络模式的权限' : '登录后可切换网络模式');
        return;
      }
      var order = ['auto', 'lan', 'wan'];
      var cur = order.indexOf(state.settings.netMode);
      var next = order[(cur + 1) % order.length];
      state.settings.netMode = next;
      paintNet();
      renderGroups();
      mutate('PUT', '/api/settings', { netMode: next }, '网络模式：' +
        (next === 'auto' ? '自动识别' : next === 'lan' ? '锁定内网' : '锁定外网'));
    });

    /* 快捷键 */
    document.addEventListener('keydown', function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === 'Escape') { closeAll(); return; }
      if (typing) return;
      if (e.key === '/') { e.preventDefault(); $('#searchInput').focus(); }
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); cycleTheme(); }
      if ((e.key === 'n' || e.key === 'N') && canEdit()) { e.preventDefault(); openLinkModal(null); }
    });

    $('#themeBtn').addEventListener('click', cycleTheme);

    /* 同步与网络状态 */
    /* 系统深浅色变化时，跟随模式要实时响应 */
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onSchemeChange = function () {
        if (currentThemeMode() === 'system') {
          applyThemeMode('system', { silent: true, local: true });
        }
      };
      if (mq.addEventListener) mq.addEventListener('change', onSchemeChange);
      else if (mq.addListener) mq.addListener(onSchemeChange);
    }

    window.addEventListener('online', function () { loadState(true); refreshNet(); });
    window.addEventListener('offline', refreshNet);

    setInterval(function () {
      if (document.body.style.overflow === 'hidden') return;   // 弹窗打开时不同步
      if (document.activeElement === $('#searchInput')) return; // 正在搜索时不打断
      loadState(true);
    }, 20000);
  }

  /* ---------------- 启动 ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    /* 更新后硬刷新带的时间戳，用完从地址栏抹掉 */
    try {
      if (location.search.indexOf('_r=') > -1) {
        var clean = new URL(location.href);
        clean.searchParams.delete('_r');
        history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
      }
    } catch (e) {}

    applyType();
    applyThemeMode(currentThemeMode(), { silent: true, local: true });
    renderBrand();
    paintNet();
    bind();
    loadState().then(function (ok) {
      if (ok) refreshNet();
    });

    /* 刚退出登录跳回大厅：给一句话，别让人以为没生效 */
    try {
      if (sessionStorage.getItem('cp-logged-out') === '1') {
        sessionStorage.removeItem('cp-logged-out');
        setTimeout(function () { toast('已退出登录'); }, 500);
      }
    } catch (e) {}
  });
})();

