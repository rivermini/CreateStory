@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%"
for %%P in ("%SCRIPT_DIR%..") do set "ROOT_DIR=%%~fpP"
set "FE_DIR=%ROOT_DIR%\CreateStory_FE"
set "FRONTEND_DIST=%SCRIPT_DIR%frontend-dist"

REM --- Ensure Docker secret files exist before any compose command ---
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%setup_secrets.ps1"
if errorlevel 1 (
    echo [ERROR] Could not create the required secret files. Aborting.
    pause
    exit /b 1
)

:menu
cls
echo ============================================
echo  CreateStory Local Stack Update
echo ============================================
echo.
echo  Cloudflare routes:
echo    https://createstory.online     - frontend
echo    https://be.createstory.online  - gateway
echo.
echo  1. Build frontend, rebuild, and reload all services
echo  2. Rebuild and reload all services (no frontend build)
echo  3. Update fastapi_gateway
echo  4. Update bedread_voices
echo  5. Update novel_crawler
echo  6. Update bedread_drive_sync
echo  7. Update auto_audio
echo  8. Build frontend and restart frontend
echo  9. Restart frontend only
echo  10. Exit
echo.
set /p CHOICE=Choose an option [1-10]:

if "%CHOICE%"=="1" goto :update_all
if "%CHOICE%"=="2" goto :update_all_no_fe
if "%CHOICE%"=="3" goto :fastapi_gateway
if "%CHOICE%"=="4" goto :bedread_voices
if "%CHOICE%"=="5" goto :novel_crawler
if "%CHOICE%"=="6" goto :bedread_drive_sync
if "%CHOICE%"=="7" goto :auto_audio
if "%CHOICE%"=="8" goto :build_frontend_restart
if "%CHOICE%"=="9" goto :restart_frontend
if "%CHOICE%"=="10" goto :exit_script

echo.
echo Invalid choice.
pause
goto :menu

:update_all
call :build_frontend
if not "%ERRORLEVEL%"=="0" goto :after_run
call :run_update "all"
goto :after_run

:update_all_no_fe
call :run_update "backend"
goto :after_run

:fastapi_gateway
call :run_update "fastapi_gateway"
goto :after_run

:bedread_voices
call :run_update "bedread_voices"
goto :after_run

:novel_crawler
call :run_update "novel_crawler"
goto :after_run

:bedread_drive_sync
call :run_update "bedread_drive_sync"
goto :after_run

:auto_audio
call :run_update "auto_audio"
goto :after_run

:build_frontend_restart
call :build_frontend
if not "%ERRORLEVEL%"=="0" goto :after_run
call :restart_frontend_container
goto :after_run

:restart_frontend
call :restart_frontend_container
goto :after_run

:build_frontend
echo.
echo [FrontEnd] Building CreateStory_FE for Cloudflare route https://createstory.online ...
if not exist "%FE_DIR%" (
    echo [INFO] CreateStory_FE directory not found. Skipping build and using existing 'frontend-dist'.
    exit /b 0
)

pushd "%FE_DIR%" || exit /b 1
if not exist "node_modules" (
    echo [FrontEnd] Installing dependencies...
    call npm install
    if errorlevel 1 (
        popd
        echo [ERROR] npm install failed.
        exit /b 1
    )
)

echo [FrontEnd] Running production build (gateway URL auto-detected from hostname at runtime) ...
call npm run build
set "BUILD_EXIT=%ERRORLEVEL%"
popd

if not "%BUILD_EXIT%"=="0" (
    echo [ERROR] FE build failed with exit code %BUILD_EXIT%.
    exit /b %BUILD_EXIT%
)

REM Stop the nginx frontend container so it releases the read-only frontend-dist
REM mount; otherwise `rd` fails silently and xcopy merges new hashes into the
REM stale dir, leaving multiple build generations (P6). Then verify the clear
REM actually succeeded before copying.
echo [FrontEnd] Stopping frontend container to release the frontend-dist mount...
docker compose -f docker-compose.yml stop frontend >nul 2>&1

if exist "%FRONTEND_DIST%" rd /s /q "%FRONTEND_DIST%"
if exist "%FRONTEND_DIST%" (
    echo [ERROR] Could not clear "%FRONTEND_DIST%" ^(still locked?^). Aborting to avoid mixing stale build hashes.
    docker compose -f docker-compose.yml up -d frontend >nul 2>&1
    exit /b 1
)

xcopy /e /i /q /y "%FE_DIR%\dist" "%FRONTEND_DIST%" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy FE dist to %FRONTEND_DIST%.
    docker compose -f docker-compose.yml up -d frontend >nul 2>&1
    exit /b 1
)

echo [FrontEnd] Starting frontend container with the fresh build...
docker compose -f docker-compose.yml up -d frontend >nul 2>&1

echo [FrontEnd] Built and copied to Services\frontend-dist.
exit /b 0

:restart_frontend_container
echo.
echo [FrontEnd] Restarting nginx frontend container...
docker compose -f docker-compose.yml restart frontend
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
    echo Done.
) else (
    echo Failed with exit code %EXIT_CODE%.
)
exit /b %EXIT_CODE%

:run_update
set "TARGET=%~1"
echo.

REM Build the compose argument list once, then run a single command outside the
REM if/else block (so %COMPOSE_ARGS% expands with its final value). Single-service
REM updates use --no-deps so they rebuild/restart ONLY that service and never
REM recreate its dependencies; the multi options act on the whole/backend set.
set "COMPOSE_ARGS="
if /I "%TARGET%"=="all" (
    echo Rebuilding and reloading ALL services [frontend container included]...
) else if /I "%TARGET%"=="backend" (
    echo Rebuilding and reloading all backend services...
    set "COMPOSE_ARGS=postgres fastapi_gateway bedread_voices novel_crawler flaresolverr bedread_drive_sync auto_audio"
) else (
    echo Updating single service: %TARGET% [dependencies left running, untouched]...
    set "COMPOSE_ARGS=--no-deps %TARGET%"
)

docker compose -f docker-compose.yml up -d --build %COMPOSE_ARGS%
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
    docker image prune -f >nul 2>&1
    echo Done.
) else (
    echo Failed with exit code %EXIT_CODE%.
)
exit /b %EXIT_CODE%

:after_run
echo.
pause
goto :menu

:exit_script
popd
exit /b 0
