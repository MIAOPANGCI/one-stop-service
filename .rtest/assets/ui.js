/* ===========================================================
   通用界面组件：页面内确认弹窗
   用法： askConfirm({ title, text, okText, cancelText, danger })
         .then(yes => { ... })
   =========================================================== */
(function () {
  'use strict';

  var bound = false;
  var resolver = null;
  var lastFocus = null;

  var ICO_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 3.6 21.2 19.8H2.8L12 3.6z"></path><path d="M12 9.8v4.2"></path>' +
    '<circle cx="12" cy="17.1" r="0.75" fill="currentColor" stroke="none"></circle></svg>';

  var ICO_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="9"></circle><path d="M12 10.6v6"></path>' +
    '<circle cx="12" cy="7.7" r="0.75" fill="currentColor" stroke="none"></circle></svg>';

  function el(id) { return document.getElementById(id); }

  function close(result) {
    var box = el('confirmModal');
    if (box) box.hidden = true;

    // 可能还有其他弹窗开着（比如从「编辑服务」里点删除），别把滚动锁一起解了
    var stillOpen = Array.prototype.some.call(
      document.querySelectorAll('.modal'),
      function (m) { return !m.hidden; }
    );
    document.body.style.overflow = stillOpen ? 'hidden' : '';

    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;

    var fn = resolver;
    resolver = null;
    if (fn) fn(result);
  }

  function onKey(e) {
    if (resolver === null) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  }

  function bindOnce() {
    if (bound) return;
    var box = el('confirmModal');
    if (!box) return;
    bound = true;

    el('confirmOk').addEventListener('click', function () { close(true); });
    el('confirmCancel').addEventListener('click', function () { close(false); });

    box.addEventListener('click', function (e) {
      if (e.target.closest('[data-confirm-cancel]')) close(false);
    });
  }

  window.askConfirm = function (opts) {
    opts = opts || {};

    var box = el('confirmModal');
    // 页面里没有弹窗结构时退回原生 confirm
    if (!box) {
      return Promise.resolve(window.confirm(opts.text || opts.title || '确定？'));
    }

    bindOnce();

    var danger = !!opts.danger;
    var kind = opts.kind || (danger ? 'danger' : 'warn');

    var ico = el('confirmIco');
    ico.className = 'confirm-ico' + (kind === 'warn' ? '' : ' ' + kind);
    ico.innerHTML = kind === 'info' ? ICO_INFO : ICO_WARN;

    el('confirmTitle').textContent = opts.title || '确认操作';
    el('confirmText').textContent = opts.text || '';
    el('confirmText').hidden = !opts.text;

    var ok = el('confirmOk');
    ok.textContent = opts.okText || '确定';
    ok.className = 'btn-primary' + (danger ? ' is-danger' : '');

    el('confirmCancel').textContent = opts.cancelText || '取消';

    lastFocus = document.activeElement;
    box.hidden = false;
    document.body.style.overflow = 'hidden';

    document.addEventListener('keydown', onKey, true);
    setTimeout(function () { ok.focus(); }, 60);

    return new Promise(function (resolve) {
      resolver = function (result) {
        document.removeEventListener('keydown', onKey, true);
        resolve(result);
      };
    });
  };

  /* ===========================================================
     Logo 探测：判断图片是否透明底、图案偏亮还是偏暗
     —— 透明底的 logo 不该再套一个白色方块
     —— 但深色图案在深色顶栏上会看不见，需要按需托底
     =========================================================== */
  var logoCache = {};

  function probeLogo(url, cb) {
    if (!url) { cb({ alpha: false, lum: 128, ratio: 0 }); return; }
    if (logoCache[url]) { cb(logoCache[url]); return; }

    var img = new Image();
    img.onload = function () {
      var info = { alpha: false, lum: 128, ratio: 0 };
      try {
        var w = img.naturalWidth;
        var h = img.naturalHeight;
        if (w && h) {
          info.ratio = w / h;

          // 缩小到 48px 宽采样，够准也够快
          var cw = 48;
          var ch = Math.max(8, Math.round(cw * h / w));
          var c = document.createElement('canvas');
          c.width = cw;
          c.height = ch;
          var ctx = c.getContext('2d');
          ctx.clearRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);

          var d = ctx.getImageData(0, 0, cw, ch).data;
          var total = 0, clear = 0, sum = 0, weight = 0;

          for (var i = 0; i < d.length; i += 4) {
            total++;
            var a = d[i + 3] / 255;
            if (a < 0.1) { clear++; continue; }
            // 半透明边缘按 alpha 加权，避免描边把亮度拉偏
            var L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            sum += L * a;
            weight += a;
          }

          info.alpha = total > 0 && clear / total >= 0.06;
          info.lum = weight > 0 ? sum / weight : 128;
        }
      } catch (e) {
        // 跨域图片会污染画布，读不了就按「不透明」处理，保持原有底板
        info.alpha = false;
      }
      logoCache[url] = info;
      cb(info);
    };
    img.onerror = function () {
      var info = { alpha: false, lum: 128, ratio: 0 };
      logoCache[url] = info;
      cb(info);
    };
    img.src = url;
  }

  function paintLogo(el, info, url) {
    if (!el || !info) return;
    // 探测是异步的，期间图片可能已经被换掉，旧结果要作废
    if (url) {
      var im = el.querySelector('img');
      if (!im || im.getAttribute('src') !== url) return;
    }
    var alpha = !!info.alpha;

    el.classList.toggle('is-alpha', alpha);
    // 描边颜色跟着图案反着来：浅底看深图、深底看浅图，描边总在该出现时出现
    el.classList.toggle('tone-dark', alpha && info.lum < 152);
    el.classList.toggle('tone-light', alpha && info.lum > 186);
  }

  window.probeLogo = probeLogo;
  window.paintLogo = paintLogo;

  /* ===========================================================
     标签页图标：用上传的 Logo 现场画一个
     —— 方形图直接缩放
     —— 横版图缩到 16px 必然糊成一团，改用「品牌色 + 首字」
     =========================================================== */
  var favState = { key: '', done: false };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function iconFromText(brand, text) {
    var S = 64;
    var c = document.createElement('canvas');
    c.width = c.height = S;
    var ctx = c.getContext('2d');

    roundRect(ctx, 0, 0, S, S, 15);
    ctx.fillStyle = brand;
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 38px "PingFang SC","Microsoft YaHei","Hiragino Sans GB",system-ui,sans-serif';
    ctx.fillText(text, S / 2, S / 2 + 1);

    return c.toDataURL('image/png');
  }

  function iconFromImage(img, info) {
    var S = 64;
    var c = document.createElement('canvas');
    c.width = c.height = S;
    var ctx = c.getContext('2d');

    // 不透明图（白底 JPG 之类）垫个白底圆角，缩小时边缘不会发灰
    var pad = 6;
    if (!info.alpha) {
      roundRect(ctx, 0, 0, S, S, 14);
      ctx.fillStyle = '#fff';
      ctx.fill();
      pad = 3;
    }

    var scale = Math.min((S - pad * 2) / img.naturalWidth, (S - pad * 2) / img.naturalHeight);
    var w = img.naturalWidth * scale;
    var h = img.naturalHeight * scale;
    ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);

    return c.toDataURL('image/png');
  }

  function putFavicon(href) {
    var old = document.querySelectorAll('link[rel~="icon"]');
    Array.prototype.forEach.call(old, function (l) { l.parentNode.removeChild(l); });

    var link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = href;
    document.head.appendChild(link);
  }

  function setFavicon(opts) {
    opts = opts || {};
    var brand = /^#[0-9a-fA-F]{6}$/.test(opts.color || '') ? opts.color : '#2fa795';
    var lg = String(opts.text || '').trim();
    var company = String(opts.company || '').trim();
    // 「企」是默认占位（企业服务大厅的首字），用户没真填过，那就用公司名首字
    var raw = (lg && lg !== '企') ? lg : (company || lg || '企');
    var first = Array.from(raw)[0] || '企';
    var image = opts.image || '';

    // 轮询会每 20 秒重画一次，内容没变就别折腾
    var key = brand + '|' + first + '|' + image;
    if (favState.key === key) return;
    favState.key = key;

    if (!image) { putFavicon(iconFromText(brand, first)); return; }

    probeLogo(image, function (info) {
      if (info.ratio > 1.35) {
        // 横版：16px 下两行字会挤成一条线，用文字图标更清楚
        putFavicon(iconFromText(brand, first));
        return;
      }
      var img = new Image();
      img.onload = function () { putFavicon(iconFromImage(img, info)); };
      img.onerror = function () { putFavicon(iconFromText(brand, first)); };
      img.src = image;
    });
  }

  window.setFavicon = setFavicon;
})();
