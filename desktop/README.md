# 桌面壳（Electron）

网页版受浏览器同源策略限制，有三件事做不到：

1. 第三方站点用 `X-Frame-Options` / CSP `frame-ancestors` 禁止被内嵌
2. 页签里点 `target="_blank"`，父页面完全感知不到，只能让它弹浏览器窗口
3. 有些老系统会读 `parent.$` 做门户握手，跨域时直接抛 `SecurityError`，脚本中断

这个壳用 `<webview>` 替代 iframe，三件事都能处理。

## 开发时跑

```bash
cd desktop
npm install          # 第一次要下 Electron 运行时，约 100MB
npm start            # 或双击 start.bat
```

壳会自动拉起仓库根目录的 `server.js`（8080 已经在跑就直接复用），退出时收走子进程。调试用 `npm run start:dev`，会额外打开 DevTools。

## 打包

```bash
npm run build:desktop    # 在仓库根目录执行
```

产物在 `desktop/dist/`：

| 文件 | 用途 | 体积 |
|---|---|---|
| `portal-setup-x.y.z.exe` | 安装包，带桌面快捷方式 | ~83MB |
| `portal-portable-x.y.z.exe` | 免安装，双击即用 | ~76MB |

版本号取自根 `package.json`，构建脚本会自动同步给 `desktop/package.json`。

**首次构建要联网**下 Electron 运行时和打包工具。脚本里默认走 npmmirror 镜像：

```
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

如果机器访问不了 GitHub，可以手工把这三个包解压到 `%LOCALAPPDATA%\electron-builder\Cache\`：

- `nsis\nsis-3.0.4.1\`
- `nsis-resources\nsis-resources-3.4.1\`
- `winCodeSign\winCodeSign-2.6.0\`

## 三个机制

| 文件 | 作用 |
|---|---|
| `main.js` | 启动后端、创建窗口、拦截 webview 的 `window.open`、菜单与更新 |
| `host-preload.js` | 只给页面暴露 `desktopAPI`（是否桌面端、新窗口回调），不给 Node |
| `guest-preload.js` | 在页签页面里把 `parent` / `top` 指回自身，绕开跨域读取报错 |

`<webview>` 的 preload 由主进程在 `will-attach-webview` 里强制指定，页面传什么都不认；`nodeIntegration` 关掉，`contextIsolation` 打开。

## 数据与更新

打包后后端代码在安装目录的 `resources/app-root`（只读），**数据写到 `%APPDATA%\portal-desktop\data`**，卸载不删。菜单「文件 → 打开数据目录」可直接打开。

更新有两条路：启动 5 秒后静默查一次 GitHub Release；菜单「帮助 → 检查更新」手动查，发现新版可「下载并安装」（下到临时目录，装完自动重启）。

## 关掉 parent 覆盖

个别系统靠 `window.top !== window` 判断自己是否被内嵌，覆盖后会显示完整界面（带它自己的侧栏）。这时用环境变量关闭：

```bash
PORTAL_NO_SHIM=1 npm start
```

## 图标

`make-icon.ps1` 用 System.Drawing 画一个 256×256 的青底「万」字 PNG，再手工包成 ICO（PNG-in-ICO）。改了品牌色或名字，重跑脚本后重新生成 `build/icon.ico` 即可。

## 前端怎么判断

`assets/app.js` 里：

```js
var DESKTOP = !!(window.desktopAPI && window.desktopAPI.isDesktop);
```

为真时页签容器用 `<webview>`，否则还是 `<iframe>`。**网页版行为完全不变**。

## 还没做的

- 代码签名（现在没签，同事首次运行会看到 SmartScreen 提示）
- 开机自启、托盘常驻
