@echo off
setlocal

REM Creates, deletes, or resets the CreateStory Docker secret files.
REM Ensure mode is safe to run repeatedly - existing secrets are never overwritten.

echo.
echo CreateStory secret setup
echo ========================
echo 1. Ensure missing secrets only
echo 2. Delete current secrets
echo 3. Delete current secrets and setup new secrets
echo.
choice /C 123 /N /M "Choose an option [1-3]: "
if errorlevel 3 goto reset
if errorlevel 2 goto delete
goto ensure

:ensure
set "SECRET_MODE=ensure"
goto run

:delete
echo.
echo WARNING: deleting secrets can break running services.
echo Stop the stack first if these files are mounted by Docker.
choice /C YN /N /M "Delete current secrets now? [Y/N]: "
if errorlevel 2 goto cancelled
set "SECRET_MODE=delete"
goto run

:reset
echo.
echo WARNING: resetting secrets will generate new credentials.
echo If the Postgres volume already exists, reset the database volume or update the DB password too.
choice /C YN /N /M "Delete current secrets and setup new ones now? [Y/N]: "
if errorlevel 2 goto cancelled
set "SECRET_MODE=reset"
goto run

:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_secrets.ps1" -Mode "%SECRET_MODE%"
if errorlevel 1 (
    echo [ERROR] Failed to process secret files.
    pause
    exit /b 1
)
echo.
if "%SECRET_MODE%"=="delete" (
    echo Secret files were deleted from C:\ProgramData\CreateStory\secrets
) else (
    echo Secret files are ready in C:\ProgramData\CreateStory\secrets
)
pause
exit /b 0

:cancelled
echo.
echo Cancelled. No secret files were changed.
pause
exit /b 0
