@echo off
echo Starting Robot Arm Simulator on http://localhost:3005
start http://localhost:3005
npx http-server . -p 3005 -c-1
pause
