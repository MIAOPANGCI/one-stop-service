/* ===========================================================
   登录页
   =========================================================== */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var next = '';

  try {
    var q = new URLSearchParams(location.search);
    next = q.get('next') || '';
  } catch (e) {}

  // 只允许站内相对路径，避免被拿来做跳转钓鱼
  if (next && !/^\/(?!\/)/.test(next)) next = '';

  function showErr(msg) {
    var e = $('#err');
    e.textContent = msg;
    e.hidden = false;
  }

  function hideErr() { $('#err').hidden = true; }

  /* 横版 Logo：按比例放宽容器 */
  function fitAuthLogo(el, url) {
    if (!el || !url) return;
    var probe = new Image();
    probe.onload = function () {
      var w = probe.naturalWidth, h = probe.naturalHeight;
      if (!w || !h) return;
      var ratio = w / h;
      if (ratio > 1.25) {
        el.classList.add('is-wide');
        el.style.width = Math.min(Math.round(62 * ratio), 168) + 'px';
      }
    };
    probe.src = url;

    if (window.probeLogo) {
      window.probeLogo(url, function (info) { window.paintLogo(el, info, url); });
    }
  }

  /* 已登录就直接进大厅；未登录则取站点品牌信息 */
  fetch('/api/state', { cache: 'no-store' })
    .then(function (r) { return r.json().catch(function () { return null; }); })
    .then(function (d) {
      if (d && d.ok && d.user) { location.replace(next || '/'); }
    })
    .catch(function () {});

  fetch('/api/ping', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.site) return;
      var s = d.site;
      $('#authName').textContent = s.company || '企业服务大厅';
      $('#authSlogan').textContent = s.slogan || '';
      var logoEl = $('#authLogo');
      if (s.logoImage) {
        logoEl.className = 'auth-logo has-img';
        logoEl.innerHTML = '<img src="' + String(s.logoImage).replace(/"/g, '&quot;') + '" alt="">';
        fitAuthLogo(logoEl, s.logoImage);
      } else {
        var lg = s.logo || (s.company || '企').slice(0, 1);
        logoEl.className = 'auth-logo' + (lg.length > 1 ? ' two' : '');
        logoEl.textContent = lg;
      }
      document.title = '登录 · ' + (s.company || '企业服务大厅');

      if (window.setFavicon) {
        window.setFavicon({ image: s.logoImage, text: s.logo, company: s.company, color: s.brandColor });
      }
      $('#authFoot').textContent = '© ' + new Date().getFullYear() + ' ' + (s.company || '');

      if (/^#[0-9a-fA-F]{6}$/.test(s.brandColor || '')) {
        document.documentElement.style.setProperty('--brand', s.brandColor);
      }

      // 壁纸跟随主题：夜间优先用夜间图，没设就沿用日间
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      var wall = dark ? (s.heroImageDark || s.heroImage) : s.heroImage;
      if (wall) {
        var bg = document.querySelector('.auth-bg');
        if (bg) bg.style.backgroundImage = 'url("' + String(wall).replace(/"/g, '%22') + '")';
      }
    })
    .catch(function () {});

  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    hideErr();

    var username = $('#username').value.trim();
    var password = $('#password').value;
    var remember = $('#remember') ? $('#remember').checked : true;

    if (!username) { showErr('请输入账号'); $('#username').focus(); return; }
    if (!password) { showErr('请输入密码'); $('#password').focus(); return; }

    var btn = $('#submitBtn');
    btn.disabled = true;
    btn.textContent = '登录中…';

    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ username: username, password: password, remember: remember })
    })
      .then(function (r) {
        return r.json().catch(function () { return { ok: false, error: '服务端返回异常' }; })
          .then(function (d) { d._status = r.status; return d; });
      })
      .then(function (d) {
        if (d.ok) {
          location.replace(next || '/');
          return;
        }
        showErr(d.error || '登录失败');
        $('#password').value = '';
        $('#password').focus();
      })
      .catch(function () {
        showErr('无法连接服务器，请确认服务已启动');
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = '登 录';
      });
  });
})();
