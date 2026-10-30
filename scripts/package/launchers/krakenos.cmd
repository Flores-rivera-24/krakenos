@echo off
rem Lanzador del paquete autocontenido de KrakenOS (Windows).
setlocal

set "PKG=%~dp0"
if "%PKG:~-1%"=="\" set "PKG=%PKG:~0,-1%"
set "KRAKENOS_APP_DIR=%PKG%\app\agent"
if not defined KRAKENOS_DATA_DIR set "KRAKENOS_DATA_DIR=%LOCALAPPDATA%\KrakenOS"
if not defined KRAKENOS_DEPLOY_MODE set "KRAKENOS_DEPLOY_MODE=package"
rem Sin esto el agente no arranca: pino-pretty es devDependency y no viaja en el paquete.
set "NODE_ENV=production"

if not exist "%KRAKENOS_DATA_DIR%" mkdir "%KRAKENOS_DATA_DIR%"
cd /d "%KRAKENOS_DATA_DIR%"

"%PKG%\node\node.exe" "%PKG%\app\first-run.mjs"
if errorlevel 1 exit /b %ERRORLEVEL%
"%PKG%\node\node.exe" "%PKG%\app\agent\dist\index.js" %*
exit /b %ERRORLEVEL%
