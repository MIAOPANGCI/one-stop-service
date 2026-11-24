# 桌面壳（Electron）

网页版受浏览器同源策略限制，有三件事做不到：

1. 第三方站点用 `X-Frame-Options` / CSP `frame-ancestors` 禁止被内嵌
2. 页签里点 `target="_blank"`，父页面完全感知不到，只能让它弹浏览器窗口
3. 有些老系统会读 `parent.$` 做门户握手，跨域时直接抛 `SecurityError`，脚本中断

这个壳用 `<webview>` 替代 iframe，三件事都能处理。

## 跑起来

```bash
cd desktop
npm install          # 第一次要下 Electron 运行时，约 100MB
npm start
```

壳会自动拉起仓库根目录的 `server.js`（8080 已经在跑就直接复用），退出时收走子进程。

调试：`npm run start:dev`，会额外打开 DevTools。

## 三个机制

| 文件 | 作用 |
|---|---|
| `main.js` | 启动后端、创建窗口、拦截 webview 的 `window.open` |
| `host-preload.js` | 只给页面暴露 `desktopAPI`（是否桌面端、新窗口回调），不给 Node |
| `guest-preload.js` | 在页签页面里把 `parent` / `top` 指回自身，绕开跨域读取报错 |

`<webview>` 的 preload 由主进程在 `will-attach-webview` 里强制指定，页面传什么都不认；`nodeIntegration` 关掉，`contextIsolation` 打开。

## 关掉 parent 覆盖

个别系统靠 `window.top !== window` 判断自己是否被内嵌，覆盖后会显示完整界面（带它自己的侧栏）。
这时用环境变量关闭：

```bash
PORTAL_NO_SHIM=1 npm start
```

## 前端怎么判断

`assets/app.js` 里：

```js
var DESKTOP = !!(window.desktopAPI && window.desktopAPI.isDesktop);
```

为真时页签容器用 `<webview>`，否则还是 `<iframe>`。**网页版行为完全不变**，可以直接部署。

## 还没做的

- 打包成 exe（`electron-builder`），内网分发时再补
- 自动更新：可以复用现有的 GitHub Release 机制
- 图标、关于窗口
