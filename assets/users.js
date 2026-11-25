/* ===========================================================
   用户管理页
   =========================================================== */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var users = [];
  var me = null;
  var roles = { admin: '管理员', editor: '编辑者', viewer: '浏览者' };
  var keyword = '';
  var editingId = null;
  var busy = false;
  var picked = {};   // 批量改角色：勾中的账号 id

  var COLORS = ['#2fa795', '#1c6fd6', '#5b6bd6', '#7c3aed', '#0f766e', '#d97706', '#be185d', '#334155'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(iso) {
    if (!iso) return '从未登录';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function colorOf(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return COLORS[h % COLORS.length];
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

  /* ---------------- 渲染 ---------------- */
  function filtered() {
    var kw = keyword.trim().toLowerCase();
    if (!kw) return users;
    return users.filter(function (u) {
      return (u.username + ' ' + (u.name || '')).toLowerCase().indexOf(kw) > -1;
    });
  }

  function render() {
    var list = filtered();
    var tbody = $('#tbody');

    $('#countText').textContent = '共 ' + users.length + ' 个账号' +
      (keyword ? '，匹配 ' + list.length + ' 个' : '') +
      ' · ' + users.filter(function (u) { return u.enabled; }).length + ' 个启用';

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="utable-empty">没有匹配的账号</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function (u) {
      var isMe = me && u.id === me.id;
      return '<tr data-id="' + esc(u.id) + '">' +
        '<td class="ta-c"><input type="checkbox" class="row-check" data-check="' + esc(u.id) + '"' +
          (isMe ? ' disabled title="不能改自己的角色"' : '') +
          (picked[u.id] ? ' checked' : '') + '></td>' +
        '<td><div class="ucell">' +
          '<span class="u-avatar" style="background:' + colorOf(u.username) + '">' +
            esc((u.username || '?').slice(0, 1).toUpperCase()) + '</span>' +
          '<span class="u-name">' + esc(u.username) +
            (isMe ? '<i class="u-me">我</i>' : '') +
          '</span>' +
        '</div></td>' +
        '<td class="muted">' + (esc(u.name) || '—') + '</td>' +
        '<td><span class="role role-' + esc(u.role) + '">' + esc(roles[u.role] || u.role) + '</span></td>' +
        '<td><button class="switch' + (u.enabled ? ' on' : '') + '" type="button" data-act="toggle" ' +
          'title="' + (u.enabled ? '点击停用' : '点击启用') + '"' + (isMe ? ' disabled' : '') + '>' +
          '<i></i><em>' + (u.enabled ? '启用' : '停用') + '</em></button></td>' +
        '<td class="muted">' + fmt(u.lastLoginAt) + '</td>' +
        '<td class="ta-r">' +
          '<button class="link-btn" type="button" data-act="edit">编辑</button>' +
          '<button class="link-btn danger" type="button" data-act="del"' + (isMe ? ' disabled' : '') + '>删除</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    syncSelBar();
  }

  function selectedIds() {
    return Object.keys(picked).filter(function (id) { return picked[id]; });
  }

  function syncSelBar() {
    var n = selectedIds().length;
    var btn = $('#batchRoleBtn');
    btn.hidden = !n;
    $('#selCount').textContent = n ? '（' + n + '）' : '';

    var all = $('#checkAll');
    var boxes = [].slice.call(document.querySelectorAll('.row-check:not([disabled])'));
    all.checked = boxes.length > 0 && boxes.every(function (b) { return b.checked; });
    all.indeterminate = !all.checked && boxes.some(function (b) { return b.checked; });
  }

  /* ---------------- 批量改角色 ---------------- */
  function openBatchRole() {
    var ids = selectedIds();
    if (!ids.length) return;

    $('#brWho').textContent = '将修改 ' + ids.length + ' 个账号的角色，改完对方需要重新登录。';
    $('#br-role').innerHTML = Object.keys(roles).map(function (id) {
      return '<option value="' + esc(id) + '">' + esc(roles[id]) + '</option>';
    }).join('');
    $('#brWarn').hidden = true;
    openModal($('#batchRoleModal'));
  }

  function saveBatchRole() {
    if (busy) return;

    var ids = selectedIds();
    var role = $('#br-role').value;
    if (!ids.length) return;

    var btn = $('#brSaveBtn');
    busy = true;
    btn.disabled = true;
    btn.textContent = '提交中…';

    api('POST', '/api/users/roles', { ids: ids, role: role }).then(function (d) {
      picked = {};
      closeModal($('#batchRoleModal'));
      toast('已把 ' + d.changed + ' 个账号改成「' + (roles[role] || role) + '」');
      return load();
    }).catch(function (e) {
      var w = $('#brWarn');
      w.textContent = e.message;
      w.hidden = false;
    }).then(function () {
      busy = false;
      btn.disabled = false;
      btn.textContent = '确定修改';
    });
  }

  /* ---------------- 接口 ---------------- */
  function api(method, url, body) {
    var opt = { method: method, headers: { 'Accept': 'application/json' }, cache: 'no-store' };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    return fetch(url, opt).then(function (res) {
      return res.json().catch(function () { return { ok: false, error: '服务端返回异常' }; })
        .then(function (d) {
          if (res.status === 401) { location.replace('/login.html?next=/users.html'); throw new Error('未登录'); }
          if (!res.ok || d.ok === false) throw new Error(d.error || ('请求失败（HTTP ' + res.status + '）'));
          return d;
        });
    });
  }

  function load() {
    return api('GET', '/api/users').then(function (d) {
      users = d.users || [];
      me = d.me || null;
      roles = d.roles || roles;

      var sel = $('#u-role');
      sel.innerHTML = Object.keys(roles).map(function (id) {
        return '<option value="' + esc(id) + '">' + esc(roles[id]) + '</option>';
      }).join('');
      $('#meName').textContent = me ? (me.name || me.username) + ' · ' + (roles[me.role] || me.role) : '';
      render();
    }).catch(function (e) {
      if (e.message === '未登录') return;
      if (String(e.message).indexOf('权限') > -1) {
        location.replace('/');
        return;
      }
      toast(e.message);
      $('#countText').textContent = '加载失败：' + e.message;
    });
  }

  /* ---------------- 弹窗 ---------------- */
  function openModal(el) { el.hidden = false; document.body.style.overflow = 'hidden'; }
  function closeModal(el) { el.hidden = true; document.body.style.overflow = ''; }

  function openUserModal(u) {
    editingId = u ? u.id : null;
    $('#modalTitle').textContent = u ? '编辑用户' : '新增用户';
    $('#u-username').value = u ? u.username : '';
    $('#u-username').disabled = !!u;
    $('#u-name').value = u ? (u.name || '') : '';
    $('#u-role').value = u ? u.role : 'viewer';
    $('#u-password').value = '';
    $('#u-password').placeholder = u ? '留空则不修改密码' : '至少 6 位';
    $('#pwdLabel').innerHTML = u ? '重置密码' : '密码 <b>*</b>';
    $('#pwdHint').textContent = u ? '留空表示保持原密码不变' : '建议创建后由用户本人修改';
    $('#uWarn').hidden = true;
    openModal($('#userModal'));
    setTimeout(function () {
      (u ? $('#u-name') : $('#u-username')).focus();
    }, 80);
  }

  function save() {
    if (busy) return;

    var username = $('#u-username').value.trim();
    var name = $('#u-name').value.trim();
    var role = $('#u-role').value;
    var password = $('#u-password').value;

    function fail(msg) { var w = $('#uWarn'); w.textContent = msg; w.hidden = false; }

    if (!editingId) {
      if (!/^[A-Za-z0-9._-]{2,40}$/.test(username)) return fail('账号只能包含字母、数字、点、下划线、短横线，2-40 位');
      if (password.length < 6) return fail('密码至少 6 位');
    } else if (password && password.length < 6) {
      return fail('新密码至少 6 位');
    }
    $('#uWarn').hidden = true;

    var btn = $('#saveUserBtn');
    busy = true;
    btn.disabled = true;
    btn.textContent = '保存中…';

    var req = editingId
      ? api('PUT', '/api/users/' + encodeURIComponent(editingId), { name: name, role: role })
      : api('POST', '/api/users', { username: username, name: name, role: role, password: password });

    req.then(function () {
      if (editingId && password) {
        return api('POST', '/api/users/' + encodeURIComponent(editingId) + '/password', { password: password })
          .then(function () { toast('已保存并重置密码'); });
      }
      toast(editingId ? '已保存' : '已创建账号');
    }).then(function () {
      closeModal($('#userModal'));
      return load();
    }).catch(function (e) {
      fail(e.message);
    }).then(function () {
      busy = false;
      btn.disabled = false;
      btn.textContent = '保存';
    });
  }

  /* ---------------- 批量新增 ---------------- */
  function openBatchModal() {
    $('#b-list').value = '';
    $('#b-password').value = '';
    $('#b-role').value = 'viewer';
    $('#bWarn').hidden = true;
    paintBatchPreview();
    openModal($('#batchModal'));
    setTimeout(function () { $('#b-list').focus(); }, 80);
  }

  function parseBatch(text) {
    return String(text || '').split(/\r?\n/)
      .map(function (x) { return x.trim(); })
      .filter(Boolean)
      .map(function (line) {
        var parts = line.split(/[\s,，、\t]+/).filter(Boolean);
        return { username: parts[0] || '', name: parts.slice(1).join(' ') };
      });
  }

  /* 先把解析结果摊开给用户看：空格既可能是分隔符也可能是姓名的一部分，
     与其猜，不如让他一眼看到「账号 · 姓名」对不对 */
  function paintBatchPreview() {
    var rows = parseBatch($('#b-list').value);
    var box = $('#b-preview');

    if (!rows.length) { box.innerHTML = ''; return; }

    var exists = {};
    users.forEach(function (u) { exists[u.username.toLowerCase()] = 1; });

    var dup = {};
    var okCount = 0;

    var html = rows.slice(0, 12).map(function (r) {
      var bad = !/^[A-Za-z0-9._-]{2,40}$/.test(r.username);
      var has = exists[String(r.username).toLowerCase()];
      var same = dup[String(r.username).toLowerCase()];
      if (!bad) dup[String(r.username).toLowerCase()] = 1;

      var tag = '';
      if (bad) tag = '<i class="bp-bad">格式不对</i>';
      else if (has) tag = '<i class="bp-bad">已存在</i>';
      else if (same) tag = '<i class="bp-bad">重复</i>';
      else okCount++;

      return '<span class="bp-item">' + esc(r.username || '（空）') +
        (r.name ? '<em>' + esc(r.name) + '</em>' : '') + tag + '</span>';
    }).join('');

    box.innerHTML = '解析到 ' + rows.length + ' 行，可创建 <b>' + okCount + '</b> 个：' + html +
      (rows.length > 12 ? '<span class="bp-item">…另外 ' + (rows.length - 12) + ' 个</span>' : '');
  }

  function saveBatch() {
    if (busy) return;

    var rows = parseBatch($('#b-list').value);
    var password = $('#b-password').value;
    var role = $('#b-role').value;

    function fail(msg) {
      var w = $('#bWarn');
      w.textContent = msg;
      w.hidden = false;
    }

    if (!rows.length) return fail('先粘贴账号，一行一个');
    if (password.length < 6) return fail('统一密码至少 6 位');

    $('#bWarn').hidden = true;

    var btn = $('#batchSaveBtn');
    busy = true;
    btn.disabled = true;
    btn.textContent = '创建中…';

    api('POST', '/api/users/batch', {
      list: rows.map(function (r) { return r.name ? r.username + ' ' + r.name : r.username; }).join('\n'),
      password: password,
      role: role
    }).then(function (d) {
      var made = (d.created || []).length;
      var skip = d.skipped || [];

      if (!made) {
        fail('一个都没建成：' + skip.map(function (x) { return x.username + '（' + x.reason + '）'; }).join('、'));
        return load();
      }

      closeModal($('#batchModal'));
      toast('已创建 ' + made + ' 个账号' + (skip.length ? '，跳过 ' + skip.length + ' 个' : ''));
      return load().then(function () {
        if (skip.length) {
          toast('创建 ' + made + ' 个，跳过：' +
            skip.slice(0, 4).map(function (x) { return x.username + '（' + x.reason + '）'; }).join('、') +
            (skip.length > 4 ? ' 等 ' + skip.length + ' 个' : ''));
        }
      });
    }).catch(function (e) {
      fail(e.message);
    }).then(function () {
      busy = false;
      btn.disabled = false;
      btn.textContent = '创建';
    });
  }

  function toggleEnabled(u) {
    api('PUT', '/api/users/' + encodeURIComponent(u.id), { enabled: !u.enabled })
      .then(function () {
        toast(u.enabled ? '已停用' : '已启用');
        return load();
      })
      .catch(function (e) { toast(e.message); });
  }

  function removeUser(u) {
    askConfirm({
      title: '删除这个账号？',
      text: '删除后「' + u.username + '」将立即下线且无法恢复。',
      okText: '删除',
      danger: true
    }).then(function (yes) {
      if (!yes) return;
      api('DELETE', '/api/users/' + encodeURIComponent(u.id))
        .then(function () {
          toast('已删除');
          return load();
        })
        .catch(function (e) { toast(e.message); });
    });
  }

  /* ---------------- 事件 ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    load();

    /* 标签页图标：这一页没有站点设置数据，单独拉一次 */
    fetch('/api/ping', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.site && window.setFavicon) {
          window.setFavicon({
            image: d.site.logoImage,
            text: d.site.logo,
            company: d.site.company,
            color: d.site.brandColor
          });
        }
      })
      .catch(function () {});

    $('#search').addEventListener('input', function () {
      keyword = this.value;
      render();
    });

    $('#addUserBtn').addEventListener('click', function () { openUserModal(null); });
    $('#batchUserBtn').addEventListener('click', openBatchModal);
    $('#batchSaveBtn').addEventListener('click', saveBatch);
    $('#batchRoleBtn').addEventListener('click', openBatchRole);
    $('#brSaveBtn').addEventListener('click', saveBatchRole);
    $('#b-list').addEventListener('input', paintBatchPreview);

    // 勾选 / 全选
    $('#checkAll').addEventListener('change', function () {
      var on = this.checked;
      [].slice.call(document.querySelectorAll('.row-check:not([disabled])')).forEach(function (b) {
        b.checked = on;
        picked[b.dataset.check] = on;
      });
      syncSelBar();
    });

    $('#tbody').addEventListener('change', function (e) {
      var b = e.target.closest('.row-check');
      if (!b) return;
      picked[b.dataset.check] = b.checked;
      syncSelBar();
    });
    $('#saveUserBtn').addEventListener('click', save);

    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) {
        var m = e.target.closest('.modal');
        if (m) closeModal(m);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var m = $('#userModal');
        if (!m.hidden) closeModal(m);
      }
      if (e.key === 'Enter' && !$('#userModal').hidden &&
          /^(INPUT|SELECT)$/.test(document.activeElement.tagName)) {
        e.preventDefault();
        save();
      }
    });

    $('#tbody').addEventListener('click', function (e) {
      var tr = e.target.closest('tr');
      if (!tr) return;
      var u = users.find(function (x) { return x.id === tr.dataset.id; });
      if (!u) return;

      var act = e.target.closest('[data-act]');
      if (!act) return;
      var kind = act.dataset.act;
      if (kind === 'edit') openUserModal(u);
      if (kind === 'toggle') toggleEnabled(u);
      if (kind === 'del') removeUser(u);
    });

    $('#themeBtn').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('cp-theme', next); } catch (e) {}
    });

    $('#logoutBtn').addEventListener('click', function () {
      fetch('/api/logout', { method: 'POST' }).then(function () {
        // 和首页一致：退出后回大厅，不停在登录页
        try { sessionStorage.setItem('cp-logged-out', '1'); } catch (e) {}
        location.replace('/');
      });
    });
  });
})();
