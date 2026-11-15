@echo off
chcp 65001 >nul
title TikSwaft YouTube Worker
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download the LTS version from https://nodejs.org then run this file again. & pause & exit /b)
if not exist node_modules (echo Installing, first run only... & call npm install || (pause & exit /b))
node scripts\home-worker.js
pause
