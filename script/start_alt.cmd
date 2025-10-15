@echo off
setlocal
cd /d %~dp0..
REM ==== PROD START (nur Server, ohne Workspaces) ====

IF "%PORT%"=="" set PORT=4040
set NODE_ENV=production

echo [start] Server-Dependencies sicherstellen ...
cd server
call npm install --no-audit --no-fund
IF ERRORLEVEL 1 GOTO :fail

echo [start] Server wird gestartet (PORT=%PORT%) ...
node server.js
goto :eof

:fail
echo [start] FEHLER, Code=%ERRORLEVEL%
exit /b %ERRORLEVEL%
