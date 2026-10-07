@echo off
rem Lance le logiciel en local (Windows) : double-cliquez sur ce fichier.
rem Au premier lancement : installation et creation d'un restaurant de demonstration.
chcp 65001 >nul
cd /d "%~dp0"
title Logiciel HACCP - laissez cette fenetre ouverte

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe.
  echo Installez la version LTS depuis https://nodejs.org/fr puis relancez ce fichier.
  start "" https://nodejs.org/fr
  pause
  exit /b 1
)
for /f %%v in ('node -p "parseInt(process.versions.node)"') do set NODE_MAJ=%%v
if %NODE_MAJ% LSS 20 (
  echo Votre Node.js est trop ancien : installez la version LTS depuis https://nodejs.org/fr
  pause
  exit /b 1
)

if not exist node_modules (
  echo Premiere utilisation : installation, une minute environ...
  call npm ci
  if errorlevel 1 (
    echo Installation impossible : verifiez votre connexion internet.
    pause
    exit /b 1
  )
)
if not exist data\haccp.db (
  echo Creation du restaurant de demonstration...
  call npm run --silent seed
)

echo.
echo Demarrage. Compte de demonstration : demo@haccp.local / demo1234
echo Laissez cette fenetre ouverte pendant vos tests ; fermez-la pour arreter le logiciel.
echo.
start "" cmd /c "timeout /t 4 >nul & start http://localhost:3000"
call npm start
pause
