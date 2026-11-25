/* ===========================================================
   角色管理页
   =========================================================== */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var roles = [];
  var allLinks = [];
  var cats = [];
  var me = null;
  var editingId = null;
  var busy = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

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
    }, 2600);
  }

  function api(method, url, body) {
    var opt = { method: method, headers: { 'Accept': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    return fetch(url, opt).then(function (res) {
      return res.json().catch(function () { return { ok: false, error: '服务端返回异常' }; })
        .then(function (d) {
          if (res.status === 401) { location.replace('/login.html?next=/roles.html'); throw new Error('未登录'); }
          if (!res.ok || d.ok === false) throw new Error(d.error || ('请求失败（HTTP ' + res.status + '）'));
          return d;
        });
    });
  }

  function capText(role) {
    if (role.id === 'admin') return '全部';
    var out = [];
    if (role.caps.links) out.push('服务');
    if (role.caps.settings) out.push('设置');
    if (role.caps.users) out.push('用户');
    return out.length ? out.join(' / ') : '只读';
  }

  function visText(role) {
    if (role.id === 'admin' || role.seeAll) return '全部';
    var n = (role.links || []).length;
    var c = (role.cats || []).length;
    if (!n && !c) return '<span class="muted-warn">什么都看不到</span>';
    return (c ? c + ' 个分类' : '') + (c && n ? ' + ' : '') + (n ? n + ' 个服务' : '');
  }

  function render() {
    $('#countText').textContent = '共 ' + roles.length + ' 个角色';

    $('#tbody').innerHTML = roles.map(function (r) {
      return '<tr data-id="' + esc(r.id) + '">' +
        '<td><div class="ucell"><span class="role role-' + (r.builtin ? esc(r.id) : 'custom') + '">' +
          esc(r.name) + '</span>' + (r.id === 'admin' ? '<i class="u-me">内置</i>' : '') + '</div></td>' +
        '<td class="muted">' + esc(capText(r)) + '</td>' +
        '<td class="muted">' + visText(r) + '</td>' +
        '<td class="muted">' + r.users + ' 人</td>' +
        '<td class="ta-r">' +
          '<button class="link-btn" type="button" data-act="edit">编辑</button>' +
          (r.id === 'admin' ? '' : '<button class="link-btn danger" type="button" data-act="del">删除</button>') +
        '</td>' +
      '</tr>';
    }).join('');
  }

  function load() {
    return api('GET', '/api/roles').then(function (d) {
      roles = d.roles || [];
      allLinks = d.links || [];
      cats = d.cats || [];
      render();
    }).catch(function (e) {
      if (e.message === '未登录') return;
      if (String(e.message).indexOf('权限') > -1) { location.replace('/'); return; }
      toast(e.message);
      $('#countText').textContent = '加载失败：' + e.message;
    });
  }

  /* ---------------- 弹窗 ---------------- */
  function openModal(el) { el.hidden = false; document.body.style.overflow = 'hidden'; }
  function closeModal(el) { el.hidden = true; document.body.style.overflow = ''; }

  function buildVisBox(role) {
    var selLinks = {};
    (role && role.links || []).forEach(function (id) { selLinks[id] = 1; });
    var selCats = {};
    (role && role.cats || []).forEach(function (c) { selCats[c] = 1; });

    var byCat = {};
    allLinks.forEach(function (l) {
      var c = l.cat || '未分类';
      if (!byCat[c]) byCat[c] = [];
      byCat[c].push(l);
    });

    $('#visBox').innerHTML = cats.map(function (c) {
      var items = (byCat[c] || []).map(function (l) {
        return '<label class="vis-item"><input type="checkbox" data-link="' + esc(l.id) + '"' +
          (selLinks[l.id] || selCats[c] ? ' checked' : '') + '><span>' + esc(l.name) + '</span></label>';
      }).join('');

      return '<div class="vis-cat">' +
        '<label class="vis-cat-head"><input type="checkbox" data-cat="' + esc(c) + '"' +
          (selCats[c] ? ' checked' : '') + '><span>' + esc(c) + '</span></label>' +
        '<div class="vis-links">' + items + '</div>' +
      '</div>';
    }).join('');
  }

  function openRole(role) {
    editingId = role ? role.id : null;
    $('#modalTitle').textContent = role ? ('编辑角色 · ' + role.name) : '新增角色';

    $('#r-name').value = role ? role.name : '';
    $('#r-name').disabled = !!(role && role.id === 'admin');

    $('#c-links').checked = !!(role && role.caps.links);
    $('#c-settings').checked = !!(role && role.caps.settings);
    $('#c-users').checked = !!(role && role.caps.users);

    var seeAll = !(role && role.seeAll === false);
    if (role && role.id === 'admin') seeAll = true;
    document.querySelector('input[name="seeAll"][value="' + (seeAll ? '1' : '0') + '"]').checked = true;

    var locked = !!(role && role.id === 'admin');
    [$('#c-links'), $('#c-settings'), $('#c-users')].forEach(function (el) { el.disabled = locked; });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="seeAll"]'), function (el) {
      el.disabled = locked;
    });

    buildVisBox(role);
    $('#visBox').hidden = seeAll;
    $('#rWarn').hidden = true;

    openModal($('#roleModal'));
    setTimeout(function () { if (!$('#r-name').disabled) $('#r-name').focus(); }, 80);
  }

  function collect() {
    var picked = document.querySelector('input[name="seeAll"]:checked');
    var seeAll = !picked || picked.value === '1';

    var links = [];
    var catSel = [];

    Array.prototype.forEach.call($('#visBox').querySelectorAll('input[data-link]'), function (el) {
      if (el.checked) links.push(el.getAttribute('data-link'));
    });
    Array.prototype.forEach.call($('#visBox').querySelectorAll('input[data-cat]'), function (el) {
      if (el.checked) catSel.push(el.getAttribute('data-cat'));
    });

    var coverByCat = {};
    catSel.forEach(function (c) { coverByCat[c] = 1; });

    links = links.filter(function (id) {
      var l = allLinks.filter(function (x) { return x.id === id; })[0];
      return !(l && coverByCat[l.cat || '未分类']);
    });

    return {
      name: $('#r-name').value.trim(),
      seeAll: seeAll,
      caps: {
        links: $('#c-links').checked,
        settings: $('#c-settings').checked,
        users: $('#c-users').checked
      },
      links: seeAll ? [] : links,
      cats: seeAll ? [] : catSel
    };
  }

  function save() {
    if (busy) return;

    var data = collect();
    var warn = $('#rWarn');

    function fail(msg) { warn.textContent = msg; warn.hidden = false; }

    if (!data.name) return fail('给角色起个名字');
    if (!data.seeAll && !data.links.length && !data.cats.length) {
      return fail('选了「只给勾选的」，但一个服务都没勾，这个角色登录后什么都看不到');
    }

    var btn = $('#saveRoleBtn');
    busy = true;
    btn.disabled = true;
    btn.textContent = '保存中…';

    var req = editingId
      ? api('PUT', '/api/roles/' + encodeURIComponent(editingId), data)
      : api('POST', '/api/roles', data);

    req.then(function () {
      closeModal($('#roleModal'));
      toast(editingId ? '角色已保存' : '角色已创建');
      return load();
    }).catch(function (e) {
      fail(e.message);
    }).then(function () {
      busy = false;
      btn.disabled = false;
      btn.textContent = '保存';
    });
  }

  function remove(role) {
    if (!window.askConfirm) {
      if (!confirm('删除角色「' + role.name + '」？')) return;
      return doRemove(role);
    }
    window.askConfirm({
      title: '删除这个角色？',
      text: '「' + role.name + '」删除后不可恢复；还有用户在用的话会先让你换角色。',
      okText: '删除',
      danger: true
    }).then(function (yes) { if (yes) doRemove(role); });
  }

  function doRemove(role) {
    api('DELETE', '/api/roles/' + encodeURIComponent(role.id))
      .then(function () { toast('已删除'); return load(); })
      .catch(function (e) { toast(e.message); });
  }

  /* ---------------- 事件 ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    load();

    if (window.initSubnav) window.initSubnav();

    $('#addRoleBtn').addEventListener('click', function () { openRole(null); });
    $('#saveRoleBtn').addEventListener('click', save);
    $('#logoutBtn').addEventListener('click', function () {
      fetch('/api/logout', { method: 'POST' }).then(function () { location.replace('/login.html'); });
    });

    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) {
        var m = e.target.closest('.modal');
        if (m) closeModal(m);
        return;
      }

      var act = e.target.closest('[data-act]');
      if (!act) return;

      var tr = act.closest('tr');
      var role = roles.filter(function (r) { return r.id === tr.dataset.id; })[0];
      if (!role) return;

      if (act.getAttribute('data-act') === 'edit') openRole(role);
      else remove(role);
    });

    document.addEventListener('change', function (e) {
      if (e.target.name === 'seeAll') {
        $('#visBox').hidden = e.target.value === '1';
        return;
      }

      // 勾分类时把它下面的服务一起勾上
      if (e.target.matches('input[data-cat]')) {
        var box = e.target.closest('.vis-cat');
        var on = e.target.checked;
        Array.prototype.forEach.call(box.querySelectorAll('input[data-link]'), function (el) { el.checked = on; });
      }
    });
  });
})();
