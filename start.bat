@echo off
rem ------------------------------------------------------------
rem  Corp Service Portal launcher
rem  ASCII ONLY in this file: cmd.exe mis-parses UTF-8 batch files
rem  and breaks lines inside multi-byte characters. The Chinese
rem  menu is printed by scripts\launch.mjs instead.
rem ------------------------------------------------------------
chcp 65001 >nul 2>nul
pushd "%~dp0"
title Corp Service Portal

where node >nul 2>nul
if errorlevel 1 goto :nonode

if defined ADMIN_PASSWORD echo   [i] ADMIN_PASSWORD is set.

rem  no args = interactive menu; or: start.bat web / desktop / both
node scripts\launch.mjs %*

echo.
echo   Stopped. Press any key to close.
pause >nul
goto :eof

:nonode
echo.
echo   [ERROR] Node.js not found.
echo.
echo   Install Node.js 16 or newer from https://nodejs.org
echo   then run this file again.
echo.
pause
goto :eof
