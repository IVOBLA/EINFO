@echo off
setlocal
cd /d %~dp0..
REM ==== DEV (Client + Server) ohne Workspaces, robust ====

echo [dev] Client-Dependencies installieren ...
cd client
call npm install --no-audit --no-fund
IF ERRORLEVEL 1 GOTO :fail
start "KANBAN-CLIENT (Vite)" cmd /k "npm run dev"
cd ..

echo [dev] Server-Dependencies installieren ...
cd server
call npm install --no-audit --no-fund
IF ERRORLEVEL 1 GOTO :fail
start "KANBAN-SERVER (Node)" cmd /k "npm run dev"
cd ..

echo DEV gestartet. Client: http://localhost:5173  |  Server: http://localhost:4000
goto :eof

:fail
echo [dev] FEHLER, Code=%ERRORLEVEL%
exit /b %ERRORLEVEL%
