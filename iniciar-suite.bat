@echo off
setlocal EnableExtensions

REM Launcher rapido para WorkColbeef Suite en Windows.
cd /d "%~dp0"

set "MODE=%~1"
set "HOST=192.168.20.205"
set "PORT=8000"

if /i "%MODE%"=="laravel" goto :run_laravel
if /i "%MODE%"=="node" goto :run_node

echo.
echo =======================================
echo   WorkColbeef Suite - Lanzador rapido
echo =======================================
echo.
echo Iniciando Laravel automaticamente...
echo.
goto :run_laravel

:run_laravel
if not exist "laravel\artisan" (
  echo.
  echo No se encontro "laravel\artisan".
  echo Verifica que este .bat este en la raiz del proyecto.
  goto :end
)

where php >nul 2>&1
if errorlevel 1 (
  echo.
  echo PHP no esta en PATH. Instala PHP o abre una terminal con PHP disponible.
  goto :end
)

echo.
echo Iniciando Laravel en http://%HOST%:%PORT% ...
start "WorkColbeef Laravel" cmd /k "cd /d ""%~dp0laravel"" && php artisan serve --host=%HOST% --port=%PORT%"
timeout /t 2 >nul
start "" "http://%HOST%:%PORT%/"
goto :end

:run_node
if not exist "server.js" (
  echo.
  echo No se encontro "server.js" en la raiz del proyecto.
  goto :end
)

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo Node.js no esta en PATH. Instalalo y vuelve a intentar.
  goto :end
)

echo.
echo Iniciando Node en http://localhost:3000/site.html ...
start "WorkColbeef Node" cmd /k "cd /d ""%~dp0"" && npm start"
timeout /t 2 >nul
start "" "http://localhost:3000/site.html"
goto :end

:end
echo.
pause
endlocal
