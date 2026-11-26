/**
 * 宿主页面 preload：只往页面暴露最小能力，不给 Node。
 * 大厅和「连接服务端」窗口共用这一个。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  platform: process.platform,

  // 页签里点了 target=_blank / window.open，主进程会通知这里
  onOpenTab(cb) {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('guest-open-tab', (_event, url) => cb(url));
  },

  // 当前连的是哪个服务端
  getServerInfo() {
    return ipcRenderer.invoke('portal:server-info');
  },

  // 大厅设置页里改地址：主进程先验证，能连上才存并重启
  setServer(url) {
    return ipcRenderer.invoke('portal:set-server', String(url || ''));
  },

  // 关闭主界面时：'tray' 收托盘 / 'quit' 退出；confirm 为是否每次询问
  setCloseBehavior(action, confirm) {
    return ipcRenderer.invoke('portal:set-close-behavior', String(action || ''), !!confirm);
  },

  // 独立窗口打开（「不支持内嵌」的服务用）
  openWindow(url, title) {
    return ipcRenderer.invoke('portal:open-window', String(url || ''), String(title || ''));
  },

  // 本机程序快捷方式
  pickApp() {
    return ipcRenderer.invoke('portal:pick-app');
  },

  openPath(target) {
    return ipcRenderer.invoke('portal:open-path', String(target || ''));
  },

  // 把当前生效的明暗主题告诉主进程（下载浮窗要跟着变）
  setTheme(theme) {
    ipcRenderer.send('portal:theme', String(theme || ''));
  },
  // 更新下载代理（空 = 直连）
  setUpdateProxy(v) {
    return ipcRenderer.invoke('portal:set-update-proxy', String(v || ''));
  },

  // 连接设置窗口用
  probeServer(url) {
    return ipcRenderer.invoke('portal:probe-server', String(url || ''));
  },

  saveServer(url) {
    return ipcRenderer.invoke('portal:setup-save', String(url || ''));
  },

  // 检查更新（和菜单「帮助 → 检查更新」同一套逻辑，弹窗挂在当前窗口上）
  checkUpdate() {
    return ipcRenderer.invoke('portal:check-update');
  },

  relaunch() {
    ipcRenderer.send('portal:relaunch');
  },

  quitApp() {
    ipcRenderer.send('portal:quit');
  }
});
