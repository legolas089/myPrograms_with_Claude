@echo off
echo STEP Viewer 서버를 시작합니다...
echo 브라우저에서 http://localhost:3000 이 열립니다.
echo 이 창을 닫으면 서버가 종료됩니다.
echo.
start http://localhost:3000
npx http-server . -p 3000 -c-1
