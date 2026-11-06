@echo off
rem Change l'adresse du site ou reconnecte le coloriseur au profil administrateur.
cd /d "%~dp0"
if not exist venv\Scripts\python.exe (
    echo Le coloriseur n'est pas encore installe : lance d'abord installer.bat
    pause
    exit /b 1
)
venv\Scripts\python.exe worker.py --setup
pause
