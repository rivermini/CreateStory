@echo off
REM Creates the CreateStory Docker secret files if they are missing.
REM Safe to run repeatedly - existing secrets are never overwritten.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_secrets.ps1"
if errorlevel 1 (
    echo [ERROR] Failed to create secret files.
    pause
    exit /b 1
)
echo.
echo Secret files are ready in C:\ProgramData\CreateStory\secrets
pause
