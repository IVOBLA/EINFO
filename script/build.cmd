@echo off
setlocal enabledelayedexpansion
cd /d %~dp0\..

echo [build] Projekt-Root: %cd%
for /f "delims=" %%i in ('node -v') do set "node_version=%%i"
for /f "delims=" %%i in ('npm -v') do set "npm_version=%%i"
echo [build] Node: %node_version%   npm: %npm_version%

echo [build] Stoppe laufenden Node-Prozess (falls offen) ...
taskkill /F /IM node.exe /T 2>nul
taskkill /F /IM npm.exe /T 2>nul

echo [build] Clean: node_modules + Locks ...
rmdir /s /q node_modules 2>nul
rmdir /s /q client\node_modules 2>nul
rmdir /s /q server\node_modules 2>nul
del /f /q package-lock.json 2>nul
del /f /q client\package-lock.json 2>nul
del /f /q server\package-lock.json 2>nul

echo [build] Registry ^& Cache ...
call npm config set registry https://registry.npmjs.org/
call npm cache clean --force

echo [build] Install (Root + Workspaces) ...
call npm install --workspaces || goto :err

echo [build] Build client (outDir sollte ../server/dist sein) ...
call npm run build --workspace=client || goto :err

echo [build] Inhalt client\dist:
if exist client\dist dir /b client\dist
echo [build] Inhalt server\dist:
if exist server\dist dir /b server\dist

echo [build] Prüfe server\dist\index.html ...
if not exist server\dist\index.html (
  echo [build][ERR] server\dist\index.html fehlt!
  echo [build] ==> Kopiere fallback von client\dist ...
  rmdir /s /q server\dist 2>nul
  robocopy client\dist server\dist /MIR /NFL /NDL /NJH /NJS >nul
)

echo [build] Final check:
if exist server\dist\index.html (
  echo [build] OK – server\dist\index.html vorhanden.
  exit /b 0
) else (
  echo [build][ERR] Abbruch: server\dist\index.html fehlt weiterhin!
  exit /b 1
)
REM ==========================================================
REM 4) WMS-Board vorbereiten (Dependencies nur im Server)
REM ==========================================================
echo [build] Installiere Abhängigkeiten für WMS (server) ...
cd server
npm install canvas proj4 --no-save
cd ..

echo [build] WMS-Board kann mit folgendem Befehl gestartet werden:
echo          node server\wms-board.mjs


:err
echo [build][ERR] Build-Fehler, Code=%errorlevel%
exit /b %errorlevel%
