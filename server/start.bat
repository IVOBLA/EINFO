@echo off
setlocal
cd /d %~dp0

set FF_CA_FILE=D:\FF\EINFO\feuerwehr_fullchain.pem
REM >>> Zugangsdaten hier eintragen oder per ENV setzen <<<
REM set "FF_USERNAME=kdo-ff07010106"
REM set "FF_PASSWORD=W4PLt3mYBn"

set "FF_USERNAME=bezirk07"
set "FF_PASSWORD=aixa5xkRMP"
set FF_DEBUG=1
set FF_TRY_DEFAULTS=1
set FF_RAW_LIST=0
REM set FF_CLEAR_COOKIES=1
set FF_POLL_INTERVAL_MS=60000
set FF_OUT_FILE=D:\FF\EINFO\Alert.json

REM Optional: Firmen-CA (Root+Intermediate) zusätzlich einbinden
REM set "FF_CA_FILE=D:\FF\EINFO\ca-bundle.pem"

REM Optional: Unsicher (nicht empfohlen!)
REM set "FF_INSECURE=1"

echo [INFO] Starte Feuerwehr-Abruf...
call npm start

echo.
echo [INFO] Fertig. Exitcode: %errorlevel%
echo.
pause
endlocal
