@echo off
REM FE UPDATE

echo.
echo [Backend] Checking status
echo.

git status

echo.
echo [Backend] Staging changes...
echo.

git add .
git status

echo.
echo [Backend] Committing...
echo.

git commit -m "update FE"

echo.
echo [Backend] Pushing...
echo.

git push

pause
