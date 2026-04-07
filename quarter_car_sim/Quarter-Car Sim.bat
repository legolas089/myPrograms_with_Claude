@echo off
cd /d "%~dp0"
start http://localhost:3002
npx http-server . -p 3002 -c-1
pause
