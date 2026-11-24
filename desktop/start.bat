@echo off
rem Launch the Electron shell. Double-click this file.
rem Clears ELECTRON_RUN_AS_NODE so Electron does not start in Node mode.
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo   Electron is not installed yet.
  echo   Run this once in this folder:  npm install
  echo.
  pause
  exit /b 1
)

set "ELECTRON_RUN_AS_NODE="
start "" "node_modules\electron\dist\electron.exe" .
