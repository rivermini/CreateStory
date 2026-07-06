@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%"

echo.
echo ============================================
echo  CreateStory Admin Account Setup
echo ============================================
echo.

:ask_admin_email
set /p ADMIN_EMAIL=Enter admin email:
if "%ADMIN_EMAIL%"=="" (
    echo Admin email is required.
    goto ask_admin_email
)

echo.
echo Please enter the password for %ADMIN_EMAIL%.
echo (Keystrokes will be hidden as you type)
echo.

docker compose exec -it fastapi_gateway python bootstrap_admin.py --email "%ADMIN_EMAIL%"

echo.
pause
popd
exit /b 0
