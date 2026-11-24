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
      netMode: 'auto', probeUrls: [], openInNewTab: true, updatedAt: null
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

    pill.className = 'net-pill is-' + currentNet;
    $('.txt', pill).textContent = label + suffix;
    pill.title = '当前网络：' + label + '\n点击切换：自动 → 锁定内网 → 锁定外网';
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

    if (state.settings.openInNewTab === false) {
      location.href = r.url;
      return;
    }

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
    $('#offline').hidden = true;

    var si = $('#searchInput');
    si.setAttribute('readonly', 'readonly');
    si.placeholder = '登录后搜索服务';

    $('#footStat').textContent = '© ' + new Date().getFullYear() + ' ' + (state.settings.company || '');
    $('#footSync').textContent = '内部服务需登录后使用';
  }

  function renderUser() {
    var menu = $('#userMenu');
    if (!authUser) { menu.hidden = true; return; }
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
      urlWan: wan
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

    openModal($('#setModal'));
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

  function waitRestart(to) {
    var started = Date.now();
    var timer = setInterval(function () {
      fetch('/api/ping', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.version === to) {
            clearInterval(timer);
            updMask('更新完成', '新版本 v' + to + ' 已就绪，正在刷新…');
            setTimeout(function () { location.reload(); }, 900);
          } else {
            updMask('正在启动新版本', '服务重启中，请稍候…');
          }
        })
        .catch(function () {
          updMask('正在重启服务', '大约需要 10 秒，请勿关闭页面…');
        });

      if (Date.now() - started > 90000) {
        clearInterval(timer);
        updMask('更新超时', '已等待 90 秒仍未恢复，请手动刷新页面或查看 data/update.log');
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
      probeUrls: $('#s-probe').value.split('\n').map(normalizeUrl).filter(Boolean)
    };
    if (isAdmin()) payload.requireLogin = $('#s-requireLogin').value !== '0';

    mutate('PUT', '/api/settings', payload, '设置已保存').then(function (ok) {
      if (!ok) return;
      closeModal($('#setModal'));
      refreshNet();
    });
  }

  function doExport() {
    if (!online) { toast('未连接服务端'); return; }
    window.location.href = '/api/export';
    toast('正在下载备份文件');
  }

  function doImport(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(String(reader.result)); }
      catch (e) { toast('文件不是合法的 JSON'); return; }

      var arr = data && data.links ? data.links : (data && data.state && data.state.links);
      if (!Array.isArray(arr)) { toast('文件里找不到 links 字段'); return; }

      askConfirm({
        title: '导入会覆盖现有数据',
        text: '服务器上现有的 ' + state.links.length + ' 个服务将被文件中的 ' + arr.length + ' 个替换，此操作无法撤销。',
        okText: '覆盖导入',
        danger: true
      }).then(function (yes) {
        if (!yes) return;
        mutate('POST', '/api/import', data, '已导入 ' + arr.length + ' 条数据').then(function (ok) {
          if (!ok) return;
          activeCat = '全部';
          keyword = '';
          $('#searchInput').value = '';
          closeModal($('#setModal'));
          render();
        });
      });
    };
    reader.readAsText(file);
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
  function applyThemeMode(mode, opts) {
    opts = opts || {};
    var m = THEME_MODES.indexOf(mode) > -1 ? mode : 'system';
    var actual = resolveTheme(m);

    document.documentElement.setAttribute('data-theme', actual);
    document.documentElement.setAttribute('data-theme-mode', m);

    try { localStorage.setItem('cp-theme', m); } catch (e) {}

    applyHeroBackground();
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
        location.replace('/login.html');
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
    applyThemeMode(currentThemeMode(), { silent: true, local: true });
    renderBrand();
    paintNet();
    bind();
    loadState().then(function (ok) {
      if (ok) refreshNet();
    });
  });
})();
