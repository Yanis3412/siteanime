@echo off
rem Installe le traducteur (Python, PyTorch, manga-image-translator). Peut etre relance pour mettre a jour.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer.ps1"
echo.
pause
