@echo off
REM start_backend.bat — Start the FE Vite React

echo.
echo [Backend] Starting FE on http://localhost:5173 ...
echo.

cd /d "%~dp0"
npm run dev

pause
