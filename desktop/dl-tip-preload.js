/**
 * 下载进度小窗的 preload
 *
 * 窗口是 data: 页面，没有 Node，只需要一个「取消」能力。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dlTip', {
  cancel() {
    ipcRenderer.send('dl-tip-cancel');
  }
});
