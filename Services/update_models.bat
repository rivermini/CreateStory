@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%" || exit /b 1

for %%P in ("%SCRIPT_DIR%..") do set "ROOT_DIR=%%~fpP"

if defined KOKORO_MODELS_DIR (
    set "MODELS_DIR=%KOKORO_MODELS_DIR%"
) else (
    set "MODELS_DIR=%ROOT_DIR%\..\CreateStoryModels"
)

for %%M in ("%MODELS_DIR%") do set "MODELS_DIR=%%~fM"

echo.
echo ============================================
echo  CreateStory Kokoro Model Update
echo ============================================
echo.
echo Target model folder:
echo   %MODELS_DIR%
echo.
echo This will stop BedReadVoices, replace invalid/missing model files,
echo then rebuild/restart BedReadVoices and AutoAudio.
echo.

if /I not "%~1"=="--yes" (
    choice /C YN /N /M "Continue? [Y/N]: "
    if errorlevel 2 goto cancelled
)

where docker >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker CLI was not found on PATH.
    goto fail
)

echo.
echo [1/4] Stopping services that mount the model files...
docker compose -f docker-compose.yml stop bedread_voices auto_audio
if errorlevel 1 goto fail

echo.
echo [2/4] Downloading/replacing missing or invalid model files...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%BedReadVoices\scripts\download-models.ps1" -OutDir "%MODELS_DIR%"
if errorlevel 1 goto fail

echo.
echo [3/4] Checking downloaded model sizes...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$m = Get-Item -LiteralPath '%MODELS_DIR%\kokoro-v1.0.onnx'; $v = Get-Item -LiteralPath '%MODELS_DIR%\voices-v1.0.bin'; Write-Host ('kokoro-v1.0.onnx: {0:N0} bytes' -f $m.Length); Write-Host ('voices-v1.0.bin:  {0:N0} bytes' -f $v.Length); if ($m.Length -lt 100MB -or $v.Length -lt 1MB) { throw 'Model files are still too small.' }"
if errorlevel 1 goto fail

echo.
echo [4/4] Rebuilding and restarting BedReadVoices and AutoAudio...
docker compose -f docker-compose.yml up -d --build bedread_voices auto_audio
if errorlevel 1 goto fail

echo.
echo Done. Model files are updated and services restarted.
echo.
docker compose -f docker-compose.yml ps bedread_voices auto_audio
goto done

:cancelled
echo.
echo Cancelled. Nothing was changed.
goto done

:fail
echo.
echo ============================================
echo  Model update failed
echo ============================================
echo.
echo Check the error above. Current service status:
docker compose -f docker-compose.yml ps bedread_voices auto_audio
echo.
popd
pause
exit /b 1

:done
popd
pause
exit /b 0
