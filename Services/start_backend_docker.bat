@echo off

setlocal

set "SCRIPT_DIR=%~dp0"

pushd "%SCRIPT_DIR"

docker compose -f docker-compose.yml up --build %*

set "EXIT_CODE=%ERRORLEVEL%"

popd

exit /b %EXIT_CODE%
