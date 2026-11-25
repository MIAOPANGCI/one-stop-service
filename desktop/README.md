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

壳不启动后端，只连现成的服务端 —— 先把服务端跑起来（仓库根目录 `node server.js` 或 `start.bat`），再 `npm start`。
第一次打开会弹「连接服务端」窗口，填地址即可。调试用 `npm run start:dev`，会额外打开 DevTools。

## 连哪个服务端

壳里没有后端代码，地址必须由用户提供：

- 第一次打开 → 自动弹 `setup.html`（连接设置窗口），填 `http://192.168.3.20:8080`
- 「测试连接」走 `portal:probe-server`，主进程带 `CorpPortalDesktop/<版本>` UA 请求 `/api/ping`
- 「连接」走 `portal:setup-save`：**先探测，连得上才写 prefs**，然后开大厅、关设置窗
- 底部有版本号和「检查更新」（`portal:check-update`），走的是和菜单「帮助 → 检查更新」同一套逻辑，弹窗挂在设置窗上

之后改地址有两个入口：大厅「设置 → 打开与网络 → 桌面客户端」，或菜单「文件 → 重新设置服务端…」。
两处都会先验证再保存，运行时改会 `app.relaunch()` 重启自己。

也可以用环境变量跳过引导：`PORTAL_SERVER=http://192.168.3.20:8080`（优先级最高，不写入 prefs）。

数据只在服务端那一份，本地唯一落地的是 `%APPDATA%\portal-desktop\desktop-prefs.json`（地址 + 菜单栏显隐）。

配了远端地址之后，壳**不会**在本地偷偷起一个后端，连不上就直说 —— 免得又造出一份平行的数据。

服务端启动模式决定谁能连（见根 README 的「启动方式」）：

| 服务端 `--mode` | 浏览器 | 桌面客户端 |
|---|---|---|
| `both`（默认） | ✓ | ✓ |
| `web` | ✓ | ✗ 403 |
| `desktop` | ✗ 403 | ✓ |

桌面客户端请求会带 `CorpPortalDesktop/<版本>` 的 UA，服务端据此区分。

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

## 更新

安装包里没有后端，只有 Electron 运行时 + `main.js` / 三个 preload / `setup.html`。更新有两条路：启动 5 秒后静默查一次 GitHub Release；菜单「帮助 → 检查更新」手动查，发现新版可「下载并安装」（下到临时目录，装完自动重启）。

## 关掉 parent 覆盖

个别系统靠 `window.top !== window` 判断自己是否被内嵌，覆盖后会显示完整界面（带它自己的侧栏）。这时用环境变量关闭：

```bash
PORTAL_NO_SHIM=1 npm start
```

## 图标

图标从 `build/icon-src.png` 现算，不依赖第三方库：

```bash
node scripts/make-icon.mjs          # 也可以在 desktop/build 里换一张 icon-src.png 再跑
```

脚本自己解 PNG、按面积平均缩放（带 alpha 预乘，不会出黑边），输出 `build/icon.png`（256×256，窗口和关于窗口用）和 `build/icon.ico`（16/24/32/48/64/128/256，全是 32 位 BMP 帧，老 NSIS 也认）。`npm run build:desktop` 发现没有 ico 会自动补一次。

## 菜单栏

`视图 → 隐藏菜单栏`（Ctrl+Shift+M）关掉顶部那一行，设置存在 `%APPDATA%\portal-desktop\desktop-prefs.json`，下次启动保持。隐藏后按 **Alt** 还能临时叫出来。

## 下载进度

两种下载共用一个自绘的小窗，任务栏图标同时走 `setProgressBar`：

- 客户端自身的更新包（主进程 https 直连）
- 页签里（webview）点下载，走 `session.on('will-download')`

几条行为约定：

- **先选路径，再下载**。`will-download` 里用同步的 `showSaveDialogSync` 先拿保存路径，用户点取消就 `item.cancel()`，不会出现「路径还没选，进度条已经跑完」。
- **多文件排队**。同一扇窗里按行排列（最多 4 行，多了滚动），不再一条一开一关地闪。每条单独「取消」，完成的行变绿、失败变红。
- 窗口 `skipTaskbar` + `showInactive`，不抢焦点、不占任务栏；全部结束后 0.3 秒自动收起。
- 完成/失败走系统通知，点通知在资源管理器里定位文件。

## 前端怎么判断

`assets/app.js` 里：

```js
var DESKTOP = !!(window.desktopAPI && window.desktopAPI.isDesktop);
```

为真时页签容器用 `<webview>`，否则还是 `<iframe>`。**网页版行为完全不变**。

## 还没做的

- 代码签名（现在没签，同事首次运行会看到 SmartScreen 提示）
- 开机自启、托盘常驻
