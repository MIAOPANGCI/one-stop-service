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
  }
});
