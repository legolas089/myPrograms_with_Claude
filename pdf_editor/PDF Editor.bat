@echo off
if not "%~1"=="run" (
    mshta vbscript:Execute("CreateObject(""WScript.Shell"").Run ""cmd /c """"%~f0"""" run"", 0:close")
    exit /B
)
cd /d "%~dp0"
start /B npx http-server . -p 3001 -c-1
timeout /t 5 /nobreak >nul
start http://localhost:3001
cmd /K >nul
