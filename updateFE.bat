@echo off
REM FE UPDATE

echo.
echo [FE] Checking status
echo.

git status

echo.
echo [FE] Staging changes...
echo.

git add .
git status

echo.
echo [FE] Committing...
echo.

git commit -m "update FE"

echo.
echo [FE] Pushing...
echo.

git push

pause
