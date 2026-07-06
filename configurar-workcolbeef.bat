@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo ===============================================
echo   WorkColbeef - Configurar nombre en el PC
echo ===============================================
echo.
echo Esto agrega "WorkColbeef" al archivo hosts de Windows
echo para que apunte a 192.168.20.205
echo.
echo IMPORTANTE: clic derecho en este archivo y
echo "Ejecutar como administrador" si Windows lo pide.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\setup-workcolbeef-host.ps1" -Action install -CreateShortcut

echo.
pause
endlocal
