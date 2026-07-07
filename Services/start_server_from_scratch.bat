@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%" || exit /b 1

for %%P in ("%SCRIPT_DIR%..") do set "ROOT_DIR=%%~fpP"
set "FE_DIR=%ROOT_DIR%\CreateStory_FE"
set "FRONTEND_DIST=%SCRIPT_DIR%frontend-dist"
set "COMPOSE_FILE=docker-compose.yml"

if /I "%~1"=="--help" goto help
if /I "%~1"=="/?" goto help

echo.
echo ============================================
echo  CreateStory Fresh Server Start
echo ============================================
echo.
echo This will DELETE and recreate:
echo   - Docker Compose containers and networks
echo   - Docker Compose volumes: postgres_data, novel_crawler_output,
echo     bedread_voices_output, auto_audio_output
echo   - Secret files in C:\ProgramData\CreateStory\secrets
echo.
echo Use this only when you want a truly clean server start.
echo.

if /I not "%~1"=="--yes" (
    set "CONFIRM="
    set /p CONFIRM=Type START-FRESH to continue: 
    if /I not "!CONFIRM!"=="START-FRESH" (
        echo.
        echo Cancelled. Nothing was changed.
        goto done
    )
)

call :check_command docker "Docker CLI"
if errorlevel 1 goto fail

call :run docker version
if errorlevel 1 (
    echo.
    echo [ERROR] Docker is not reachable. Start Docker Desktop or the Docker service, then run this again.
    goto fail
)

call :run docker compose version
if errorlevel 1 (
    echo.
    echo [ERROR] Docker Compose v2 is not available.
    goto fail
)

echo.
echo [1/8] Making sure secret files exist so Compose can read the file mounts...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%setup_secrets.ps1"
if errorlevel 1 goto fail

echo.
echo [2/8] Stopping and deleting the old stack, including volumes...
call :run docker compose -f "%COMPOSE_FILE%" down --remove-orphans -v
if errorlevel 1 goto fail

echo.
echo [3/8] Recreating secrets so postgres_password and database_url match...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%setup_secrets.ps1" -Mode reset
if errorlevel 1 goto fail

echo.
echo [4/8] Building frontend assets...
call :build_frontend
if errorlevel 1 goto fail

echo.
echo [5/8] Pulling pinned/runtime images and building app images...
call :run docker compose -f "%COMPOSE_FILE%" pull postgres flaresolverr frontend
if errorlevel 1 goto fail

call :run docker compose -f "%COMPOSE_FILE%" build bedread_voices novel_crawler bedread_drive_sync auto_audio fastapi_gateway
if errorlevel 1 goto fail

echo.
echo [6/8] Starting infrastructure in order...
call :run docker compose -f "%COMPOSE_FILE%" up -d --no-build postgres
if errorlevel 1 goto fail
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%wait_container_healthy.ps1" -Container create-story-postgres -Label "Postgres" -MaxTries 36
if errorlevel 1 goto fail

call :run docker compose -f "%COMPOSE_FILE%" up -d --no-build flaresolverr
if errorlevel 1 goto fail
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%wait_container_healthy.ps1" -Container create-story-flaresolverr -Label "FlareSolverr" -MaxTries 36
if errorlevel 1 goto fail

echo.
echo [7/8] Starting worker services, then the gateway...
call :run docker compose -f "%COMPOSE_FILE%" up -d --no-build bedread_voices bedread_drive_sync novel_crawler
if errorlevel 1 goto fail
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%wait_container_healthy.ps1" -Container create-story-bedread-voices -Label "BedReadVoices" -MaxTries 72
if errorlevel 1 goto fail
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%wait_container_healthy.ps1" -Container create-story-bedread-drive-sync -Label "BedReadDriveSync" -MaxTries 72
if errorlevel 1 goto fail
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%wait_container_healthy.ps1" -Container create-story-novel-crawler -Label "NovelCrawler" -MaxTries 72
if errorlevel 1 goto fail

call :run docker compose -f "%COMPOSE_FILE%" up -d --no-build auto_audio
if errorlevel 1 goto fail
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%wait_container_healthy.ps1" -Container create-story-auto-audio -Label "AutoAudio" -MaxTries 72
if errorlevel 1 goto fail

call :run docker compose -f "%COMPOSE_FILE%" up -d --no-build fastapi_gateway
if errorlevel 1 goto fail
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%wait_container_healthy.ps1" -Container create-story-fastapi-gateway -Label "FastAPI Gateway" -MaxTries 72
if errorlevel 1 goto fail

echo.
echo [8/8] Starting frontend...
call :run docker compose -f "%COMPOSE_FILE%" up -d --no-build frontend
if errorlevel 1 goto fail
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%wait_container_healthy.ps1" -Container create-story-frontend -Label "Frontend" -MaxTries 36
if errorlevel 1 goto fail

echo.
echo ============================================
echo  Fresh start complete
echo ============================================
echo.
docker compose -f "%COMPOSE_FILE%" ps
echo.
echo Frontend: http://127.0.0.1:5173
echo Gateway:  http://127.0.0.1:8000/api
echo.
goto done

:help
echo.
echo Usage:
echo   start_server_from_scratch.bat
echo   start_server_from_scratch.bat --yes
echo.
echo The script wipes the Compose stack, deletes Compose volumes, resets
echo CreateStory secret files, rebuilds images/assets, then starts services
echo in dependency order.
echo.
goto done

:check_command
where "%~1" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] %~2 was not found on PATH.
    exit /b 1
)
exit /b 0

:run
echo ^> %*
%*
exit /b %ERRORLEVEL%

:build_frontend
if not exist "%FE_DIR%" (
    echo [INFO] CreateStory_FE directory not found. Skipping frontend build.
    exit /b 0
)

call :check_command npm "npm"
if errorlevel 1 exit /b 1

pushd "%FE_DIR%" || exit /b 1

if not exist "node_modules" (
    if exist "package-lock.json" (
        echo [FrontEnd] Installing dependencies with npm ci...
        call npm ci
    ) else (
        echo [FrontEnd] Installing dependencies with npm install...
        call npm install
    )
    if errorlevel 1 (
        popd
        echo [ERROR] Frontend dependency install failed.
        exit /b 1
    )
)

echo [FrontEnd] Running production build...
call npm run build
set "BUILD_EXIT=%ERRORLEVEL%"
popd

if not "%BUILD_EXIT%"=="0" (
    echo [ERROR] Frontend build failed with exit code %BUILD_EXIT%.
    exit /b %BUILD_EXIT%
)

if exist "%FRONTEND_DIST%" rd /s /q "%FRONTEND_DIST%"
if exist "%FRONTEND_DIST%" (
    echo [ERROR] Could not clear "%FRONTEND_DIST%".
    exit /b 1
)

xcopy /e /i /q /y "%FE_DIR%\dist" "%FRONTEND_DIST%" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy frontend dist to "%FRONTEND_DIST%".
    exit /b 1
)

echo [FrontEnd] Built and copied to Services\frontend-dist.
exit /b 0

:fail
echo.
echo ============================================
echo  Fresh start failed
echo ============================================
echo.
docker compose -f "%COMPOSE_FILE%" ps
echo.
echo Check the error above. Recent logs can help:
echo   docker compose -f "%COMPOSE_FILE%" logs --tail=120
echo.
popd
pause
exit /b 1

:done
popd
pause
exit /b 0
