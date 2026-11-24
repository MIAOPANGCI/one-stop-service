@echo off
chcp 65001 >nul 2>nul
pushd "%~dp0"
title 企业服务大厅

echo.
echo   ============================================
echo     企业服务大厅 · 启动方式
echo   ============================================
echo.
echo     1  仅网页版        只开放浏览器访问，桌面客户端连不进来
echo     2  仅桌面客户端    浏览器打开会被拒绝，只给客户端用
echo     3  两者都启动      浏览器 + 桌面客户端，共用同一个服务端数据
echo     4  自定义端口      换一个端口启动网页版
echo.
set "CH=3"
set /p CH=  请选择 [1-4，默认 3]:
if "%CH%"=="" set "CH=3"

where node >nul 2>nul
if errorlevel 1 goto :nonode

if defined ADMIN_PASSWORD echo   [i] 已设置 ADMIN_PASSWORD
echo.

if "%CH%"=="1" node scripts\launch.mjs web
if "%CH%"=="2" node scripts\launch.mjs desktop
if "%CH%"=="3" node scripts\launch.mjs both
if "%CH%"=="4" goto :custom

echo.
echo   已退出。按任意键关闭窗口。
pause >nul
goto :eof

:custom
set "PT=8080"
set /p PT=  端口号 [默认 8080]:
if "%PT%"=="" set "PT=8080"
node server.js --mode both --port %PT% --open
echo.
echo   已退出。按任意键关闭窗口。
pause >nul
goto :eof

:nonode
echo   [错误] 没找到 Node.js。
echo.
echo   请先安装 Node.js 16 或更新版本：https://nodejs.org
echo   装完重新运行本文件。
echo.
pause
goto :eof
