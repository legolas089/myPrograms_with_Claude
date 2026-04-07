@echo off
echo Starting Roll Center Simulator on http://localhost:3004
start http://localhost:3004
npx http-server . -p 3004 -c-1
pause
