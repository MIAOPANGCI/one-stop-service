/**
 * 下载进度小窗的 preload
 *
 * 窗口是 data: 页面，没有 Node，只暴露「按 id 取消某一条」。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dlTip', {
  cancel(id) {
    ipcRenderer.send('dl-tip-cancel', id);
  }
});
