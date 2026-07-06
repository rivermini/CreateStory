@echo off
setlocal enabledelayedexpansion

echo ============================================
echo  Nova Services - Export (FE build + zip)
echo ============================================
echo.

for %%P in ("%~dp0.") do set "SERVICES_DIR=%%~fpP"
for %%P in ("%~dp0..") do set "ROOT_DIR=%%~fpP"
set "FE_DIR=%ROOT_DIR%\CreateStory_FE"
set "FRONTEND_DIST=%SERVICES_DIR%\frontend-dist"
set "TEMP_DIR=%SERVICES_DIR%_export_temp"
set "TIMESTAMP=%date:~-4%%date:~-7,2%%date:~-10,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
set "TIMESTAMP=%TIMESTAMP: =0%"
set "ZIPNAME=NovaServices_%TIMESTAMP%.zip"
set "FINAL_ZIP=%ROOT_DIR%\Exports\%ZIPNAME%"

if not exist "%ROOT_DIR%\Exports" mkdir "%ROOT_DIR%\Exports"

echo [INFO] Output: %FINAL_ZIP%
echo [INFO] Excluding all .venv folders and built FE dist...
echo.

REM --- Step 1: Build the frontend ---
echo [FE] Installing dependencies (if needed)...
pushd "%FE_DIR%" || (
    echo [ERROR] Cannot access FE directory: %FE_DIR%
    pause
    exit /b 1
)

if not exist "node_modules" (
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed
        popd
        pause
        exit /b 1
    )
)
echo [FE] Building production bundle...
call npm run build
set "BUILD_EXIT=%ERRORLEVEL%"
popd

if not "%BUILD_EXIT%"=="0" (
    echo [ERROR] FE build failed with exit code %BUILD_EXIT%
    pause
    exit /b 1
)

if not exist "%FE_DIR%\dist" (
    echo [ERROR] FE build did not produce dist folder
    pause
    exit /b 1
)

REM --- Step 2: Copy built FE into Services/frontend-dist for Docker volume mount ---
echo.
echo [FE] Copying built dist to Services\frontend-dist ...
if exist "%FRONTEND_DIST%" rd /s /q "%FRONTEND_DIST%"
xcopy /e /i /q /y "%FE_DIR%\dist" "%FRONTEND_DIST%" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy FE dist
    pause
    exit /b 1
)

REM --- Step 3: Prepare temp folder and zip ---
if exist "%TEMP_DIR%" (
    rd /s /q "%TEMP_DIR%"
    :wait_delete
    if exist "%TEMP_DIR%" (
        ping -n 2 127.0.0.1 >nul 2>&1
        goto :wait_delete
    )
)

echo.
echo [COPY] Copying files (excluding .venv, output folders, and git metadata)...
robocopy "%SERVICES_DIR%" "%TEMP_DIR%" /e /xd ".venv" "output" "Output" "data" "Data" "_export_temp" ".git" /xf ".git*" /nc /nfl /ndl /njh /njs /is

echo.
echo [ZIP] Creating archive...
powershell -command "Compress-Archive -Path '%TEMP_DIR%' -DestinationPath '%SERVICES_DIR%\%ZIPNAME%' -Force"

if errorlevel 1 (
    echo [ERROR] Failed to create zip
    if exist "%TEMP_DIR%" rd /s /q "%TEMP_DIR%"
    pause
    exit /b 1
)

move /y "%SERVICES_DIR%\%ZIPNAME%" "%FINAL_ZIP%" >nul 2>&1
rd /s /q "%TEMP_DIR%"

echo.
echo ============================================
echo  Done!
echo  %FINAL_ZIP%
echo  (FE dist already in Services\frontend-dist)
echo ============================================
pause
