@echo off
if not "%~1"=="run" (
    mshta vbscript:Execute("CreateObject(""WScript.Shell"").Run ""cmd /c """"%~f0"""" run"", 0:close")
    exit /B
)
cd /d "%~dp0"
pythonw server.py
