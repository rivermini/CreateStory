@echo off
setlocal EnableExtensions

cd /d "%~dp0"

if "%~1"=="" goto :usage

set "ASSIST_ARGS=%*"
set "CHROME_PORT=9224"

:parse_args
if "%~1"=="" goto :args_parsed
if /i "%~1"=="--chrome-port" (
  if not "%~2"=="" set "CHROME_PORT=%~2"
  shift
)
shift
goto :parse_args

:args_parsed

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 20 or newer is required.
  echo Install Node.js, reopen this window, then run the command shown by CreateStory again.
  exit /b 1
)

if not exist "node_modules\ws\package.json" (
  echo [SETUP] Installing the small local WebSocket dependency...
  call npm install --no-audit --no-fund
  if errorlevel 1 exit /b 1
)

call :ensure_chrome
if errorlevel 1 exit /b 1

node "%~dp0jobnib_browser_assistant.js" %ASSIST_ARGS%
set "RESULT=%ERRORLEVEL%"

if not "%RESULT%"=="0" (
  echo.
  echo [ERROR] Browser assistant stopped with an error.
  pause
)
exit /b %RESULT%

:ensure_chrome
powershell -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:%CHROME_PORT%/json/version'; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
  echo [OK] Reusing Chrome on debugging port %CHROME_PORT%.
  exit /b 0
)

set "CHROME_EXE="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE (
  echo [ERROR] Google Chrome was not found.
  echo Install Chrome or open it yourself with remote debugging on port %CHROME_PORT%.
  exit /b 1
)

set "CHROME_PROFILE=%LocalAppData%\CreateStory\JobnibBrowserAssistant"
echo [START] Opening a normal visible Jobnib Chrome window...
start "" "%CHROME_EXE%" --remote-debugging-port=%CHROME_PORT% --remote-allow-origins=* --user-data-dir="%CHROME_PROFILE%" --no-first-run --no-default-browser-check "https://jobnib.com/"

for /l %%I in (1,1,20) do (
  powershell -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 'http://127.0.0.1:%CHROME_PORT%/json/version'; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
  if not errorlevel 1 (
    echo [OK] Chrome is ready.
    exit /b 0
  )
  timeout /t 1 /nobreak >nul
)

echo [ERROR] Chrome did not open debugging port %CHROME_PORT% within 20 seconds.
exit /b 1

:usage
echo Usage:
echo   run_jobnib_browser_assistant.bat --batch BATCH_ID --pairing PAIRING_ID --token PAIRING_TOKEN [--api-base URL] [--chrome-port 9224]
echo.
echo Copy the complete command shown in CreateStory's Jobnib Batch page.
exit /b 2
