@echo off
cd /d "%~dp0"
start http://localhost:3003
npx http-server . -p 3003 -c-1
pause
