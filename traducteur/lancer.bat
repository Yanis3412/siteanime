@echo off
rem Lance le coloriseur. Laisse la fenetre ouverte pendant qu'il travaille.
cd /d "%~dp0"
title Coloriseur Liste
if not exist venv\Scripts\python.exe (
    echo Le coloriseur n'est pas encore installe : lance d'abord installer.bat
    pause
    exit /b 1
)
venv\Scripts\python.exe worker.py %*
echo.
pause
