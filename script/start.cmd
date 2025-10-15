@echo off
setlocal EnableExtensions

REM === immer ins Projekt-Root wechseln, egal von wo gestartet ===
cd /d "%~dp0\.."  || exit /b 1
echo [start] Projekt-Root: %cd%

REM === Logs-Ordner sicherstellen ===
if not exist "logs" mkdir "logs"

REM === Abhängigkeiten installieren (immer 'call npm ...') ===
echo [start] Install (workspaces) ...
call npm install --workspaces
if errorlevel 1 goto :error

REM === Nur bauen, wenn Dist fehlt ===
if not exist "server\dist\index.html" (
  echo [start] Build client ^(weil server\dist\index.html fehlt^) ...
  call npm run build --workspace=client
  if errorlevel 1 goto :error
) else (
  echo [start] Build uebersprungen ^(server\dist\index.html vorhanden^)
)

REM === in server/ wechseln ===
pushd server

REM === Defaults für WMS (werden ggf. aus .env durch dotenv geladen) ===
if not defined DATA_DIR set "DATA_DIR=.\data"
if not defined WMS_PORT set "WMS_PORT=8090"

REM === Hauptserver-Entry autodetektion ===
set "MAIN_ENTRY="
if exist "server.js"      set "MAIN_ENTRY=server.js"
if not defined MAIN_ENTRY if exist "index.mjs"      set "MAIN_ENTRY=index.mjs"
if not defined MAIN_ENTRY if exist "dist\index.mjs" set "MAIN_ENTRY=dist\index.mjs"
if not defined MAIN_ENTRY (
  echo [start][ERR] Kein Server-Entry gefunden ^(server.js / index.mjs / dist\index.mjs^)
  popd
  goto :error
)

echo [start] Starte Hauptserver ^(ein Fenster, Log: ..\logs\server.log^)
start /b cmd /c "node %MAIN_ENTRY% >> ..\logs\server.log 2>&1"

echo [start] Starte WMS-Lite ...
if not exist "%~dp0..\server\logs" mkdir "%~dp0..\server\logs"
start "wms-lite" cmd /c ^
  "pushd "%~dp0..\server" && node wms-board-lite.mjs >> logs\wms.log 2>&1"



popd

echo [start] Beide Prozesse laufen. Logs:
echo         - server: logs\server.log
echo         - wms:    logs\wms.log
echo.
echo [start] Druecke STRG+C zum Beenden. Dieses Fenster offen lassen!

REM === einfache Warte-Schleife, damit das Fenster offen bleibt ===
:wait
ping -n 3600 127.0.0.1 >nul
goto :wait

:error
echo [start][ERR] Code=%errorlevel%
exit /b %errorlevel%
