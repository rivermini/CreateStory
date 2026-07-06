@echo off
REM Host-side proxy for ScribbleHub crawling (Cloudflare cf_clearance reuse).
REM Run this on the Windows host where you captured the cf_clearance cookie, then set
REM   SCRIBBLEHUB_PROXY_URL=http://host.docker.internal:8899
REM in the novel_crawler container and restart it. Leave this window open while crawling.
cd /d "%~dp0.."
echo Starting ScribbleHub host proxy on 0.0.0.0:8899 ...
python scripts\scribblehub_host_proxy.py --port 8899
pause
