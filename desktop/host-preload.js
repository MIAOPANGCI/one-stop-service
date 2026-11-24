/**
 * 宿主页面 preload：只往页面暴露最小能力，不给 Node。
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

  // 桌面端连的服务端是谁、本地兜底数据放哪
  getServerInfo() {
    return ipcRenderer.invoke('portal:server-info');
  },

  // 改服务端地址（空字符串 = 回到本机 8080），重启后生效
  setServer(url) {
    return ipcRenderer.invoke('portal:set-server', String(url || ''));
  },

  relaunch() {
    ipcRenderer.send('portal:relaunch');
  }
});
