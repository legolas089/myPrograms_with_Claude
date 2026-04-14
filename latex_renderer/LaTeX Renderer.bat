@echo off
echo ================================================
echo   LaTeX Renderer
echo ================================================
echo.
echo   Starting web server on http://localhost:3006
echo   Starting OCR server on http://localhost:5000
echo.
echo   Close this window to stop both servers.
echo ================================================
echo.

:: Start OCR server in background
start /B python "%~dp0server.py" 2>nul

:: Wait a moment then open browser
timeout /t 2 /nobreak >nul
start http://localhost:3006

:: Start HTTP server (foreground, keeps window open)
npx http-server "%~dp0" -p 3006 -c-1

pause
