@echo off
chcp 65001 >nul 2>nul
pushd "%~dp0"
title Corp Service Portal

echo.
echo   ============================================
echo     Corp Service Portal
echo   ============================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :nonode

if defined ADMIN_PASSWORD echo   [i] Custom ADMIN_PASSWORD detected.
echo.

rem   Port / host: edit config.json next to this file, or run: start.bat --port 9000
echo   Address: see the list below after start.
echo.
node server.js --open %*
echo.
echo   Server stopped. Press any key to close.
pause >nul
goto :eof

:nonode
echo   [ERROR] Node.js not found.
echo.
echo   Please install Node.js 16 or newer from https://nodejs.org
echo   then run this file again.
echo.
pause
goto :eof
