@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ==========================
REM build.cmd – All-in-One Build & Start
REM Flags:
REM   --no-client   : Client-Build überspringen
REM   --no-start    : Server nicht starten (nur bauen/installieren)
REM   --no-ca       : CA-Bundle nicht abrufen (fetch-ca.mjs überspringen)
REM   --clean       : dist-Ordner vor Build löschen
REM   --port=####   : PORT setzen (Default 4000)
REM ==========================

REM ---- Projekt-Root ermitteln (robust) ------------------------
set "BASE=%~dp0"
set "BASE=%BASE:~0,-1%"

REM Wenn im aktuellen Ordner kein server\ liegt, nimm den Elternordner
if exist "%BASE%\server" (
  set "ROOT=%BASE%"
) else (
  set "ROOT=%BASE%\.."
)

REM absolut normalisieren
for %%F in ("%ROOT%") do set "ROOT=%%~fF"

set "CLIENT=%ROOT%\client"
set "SERVER=%ROOT%\server"
set "DIST=%SERVER%\dist"

REM ---- Defaults ----------------------------------------------
set "PORT=4040"
set "DO_CLIENT=1"
set "DO_START=0"
set "DO_CA=1"
set "DO_CLEAN=1"

for %%A in (%*) do (
  if /I "%%~A"=="--no-client" set "DO_CLIENT=0"
  if /I "%%~A"=="--no-start"  set "DO_START=0"
  if /I "%%~A"=="--no-ca"     set "DO_CA=0"
  if /I "%%~A"=="--clean"     set "DO_CLEAN=1"
  echo %%~A | findstr /I /B /C:"--port=" >nul && (
    for /f "tokens=2 delims==" %%P in ("%%~A") do set "PORT=%%P"
  )
)

title build.cmd (PORT=%PORT%) [%DATE% %TIME%]
echo [build] Projekt-Root: %ROOT%
echo [build] Client-Pfad  : %CLIENT%
echo [build] Server-Pfad  : %SERVER%
echo [build] Dist-Ziel    : %DIST%
echo [build] Flags        : client=%DO_CLIENT%  start=%DO_START%  ca=%DO_CA%  clean=%DO_CLEAN%  port=%PORT%
echo.

REM ---- Node & npm prüfen --------------------------------------
where node >nul 2>&1 || (echo [build][ERR] Node.js nicht gefunden.& exit /b 1)
where npm  >nul 2>&1 || (echo [build][ERR] npm nicht gefunden.& exit /b 1)
for /f "tokens=*" %%v in ('node -v') do set "NODEVER=%%v"
for /f "tokens=*" %%v in ('npm -v')  do set "NPMVER=%%v"
echo [build] Node: %NODEVER%   npm: %NPMVER%
echo.

REM ---- Optional: dist säubern ---------------------------------
if "%DO_CLEAN%"=="1" (
  echo [build] dist saeubern ...
  if exist "%DIST%" rd /s /q "%DIST%"
  if errorlevel 1 ( echo [build][WARN] Konnte dist nicht loeschen ^(evtl. gesperrt^). )
)

REM ---- Client: Bauen (falls existiert & erlaubt) --------------
if exist "%CLIENT%" (
  if "%DO_CLIENT%"=="1" (
    echo [client] npm ci ...
    pushd "%CLIENT%"
    call npm ci
    if errorlevel 1 ( echo [client][ERR] npm ci fehlgeschlagen. & popd & exit /b 1 )

    echo [client] npm run build ...
    call npm run build
    if errorlevel 1 ( echo [client][ERR] Build fehlgeschlagen. & popd & exit /b 1 )
    popd

    echo [client] Build nach %DIST% kopieren ...
    if not exist "%DIST%" mkdir "%DIST%"
    xcopy /e /y /i "%CLIENT%\dist\*" "%DIST%\" >nul
    if errorlevel 1 ( echo [client][ERR] Konnte dist nicht kopieren. & exit /b 1 )
  ) else (
    echo [client] --no-client: Client-Build uebersprungen.
  )
) else (
  echo [client] Kein Client-Ordner gefunden – ueberspringe Build.
)

REM ---- Server: Dependencies installieren (ohne dev) -----------
if not exist "%SERVER%" (
  echo [server][ERR] Server-Ordner wurde nicht gefunden: %SERVER%
  exit /b 1
)
echo [server] npm ci --omit=dev ...
pushd "%SERVER%"
call npm ci --omit=dev
if errorlevel 1 ( echo [server][ERR] npm ci fehlgeschlagen. & popd & exit /b 1 )

REM ---- Optional: CA-Bundle abrufen ----------------------------
if "%DO_CA%"=="1" (
  if exist "%SERVER%\fetch-ca.mjs" (
    echo [server] fetch-ca.mjs ausfuehren ...
    node fetch-ca.mjs
    if errorlevel 1 ( echo [server][WARN] fetch-ca.mjs meldete einen Fehler. Fahre fort. )
  ) else (
    echo [server] Kein fetch-ca.mjs gefunden – ueberspringe CA-Abruf.
  )
) else (
  echo [server] --no-ca: CA-Abruf uebersprungen.
)

REM ---- Port per ENV setzen ------------------------------------
set "PORT=%PORT%"

REM ---- Start (optional) ---------------------------------------
if "%DO_START%"=="1" (
  echo [server] Server wird gestartet ^(PORT=%PORT%^).
  call npm start
  set "RC=%ERRORLEVEL%"
  popd
  if not "%RC%"=="0" (
    echo [server][ERR] npm start beendete sich mit Code %RC%.
    exit /b %RC%
  )
) else (
  echo [server] --no-start: Starte Server NICHT. Install/Build abgeschlossen.
  popd
)

echo [build] Fertig.
exit /b 0
