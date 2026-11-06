@echo off
rem Lance le traducteur. Laisse la fenetre ouverte pendant qu'il travaille.
cd /d "%~dp0"
title Traducteur Liste
if not exist venv\Scripts\python.exe (
    echo Le traducteur n'est pas encore installe : lance d'abord installer.bat
    pause
    exit /b 1
)
venv\Scripts\python.exe worker.py %*
echo.
pause
