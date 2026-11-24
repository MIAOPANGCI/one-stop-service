/**
 * 页签（webview）里的 preload。
 *
 * 作用：把 guest 页面里的 parent / top 指回它自己。
 *
 * 为什么需要：有些系统（比如依赖 parent.$ 做门户握手的）会去读父页面属性，
 * 跨域时浏览器在读取前就抛 SecurityError，脚本直接中断。
 * 让 parent 指向自身之后，这类读取变成「读自己的全局变量」，不会再抛错，
 * 探测性质的代码（if (parent.$) ...）会走「没被门户包裹」的分支，页面正常渲染。
 *
 * 注意：不改 window.parent 的描述符会失败（只读 getter），必须用 defineProperty 覆盖。
 * 想关掉这个行为：启动时带环境变量 PORTAL_NO_SHIM=1。
 */

const { webFrame } = require('electron');

if (process.env.PORTAL_NO_SHIM !== '1') {
  const patch = `(function () {
  try {
    if (window.__corpPortalPatched) return;
    window.__corpPortalPatched = true;

    var self = window;
    var def = function (name) {
      Object.defineProperty(window, name, {
        configurable: true,
        get: function () { return self; }
      });
    };
    def('parent');
    def('top');
  } catch (e) {}
})();`;

  // 主世界执行，才能作用到页面自己的脚本
  webFrame.executeJavaScript(patch).catch(() => {});
}
