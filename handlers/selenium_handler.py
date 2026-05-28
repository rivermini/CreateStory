"""
Selenium download handler for Scrapy — uses Selenium + Chrome/Chromium for Cloudflare bypass.

Usage in settings.py::

    DOWNLOAD_HANDLERS = {
        "http": "handlers.selenium_handler.SeleniumHandler",
        "https": "handlers.selenium_handler.SeleniumHandler",
    }
"""

import asyncio
import atexit
import json
import logging
import os
import platform
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

from scrapy.core.downloader.handlers.http11 import HTTP11DownloadHandler
from scrapy.http import Request, Response, TextResponse

logger = logging.getLogger(__name__)

COOKIE_FILE = Path(__file__).parent / "selenium_cookies.json"

_CDP_STEALTH = """
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
window.navigator.chrome = { runtime: {}, app: {}, csi: function(){}, send: function(){}};
Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
window.chrome = { runtime: {}, app: {} };
"""


def _site_cookie_file(domain: str) -> Path:
    base = COOKIE_FILE.with_suffix("")
    if "wattpad" in domain:
        return base.parent / f"selenium_cookies_{domain.replace('.', '_')}.json"
    return COOKIE_FILE


class _SeleniumBrowser:
    _instance: Optional["_SeleniumBrowser"] = None

    def __init__(self):
        self._driver: Optional[object] = None
        self._service: Optional[object] = None
        self._profile_dir: Optional[str] = None
        self._lock = threading.RLock()
        self._session_start_time: float = 0
        self._fetch_count: int = 0
        self._MAX_FETCHES_PER_SESSION = 100
        self._chromedriver_path: Optional[str] = None

    def _new_driver(self) -> tuple[object, object]:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.chrome.service import Service

        options = Options()
        options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        options.add_argument("--window-size=1920,1080")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--disable-extensions")
        options.add_argument("--disable-infobars")
        options.add_argument("--start-maximized")
        options.add_argument("--disable-background-networking")
        options.add_argument("--disable-background-timer-throttling")
        options.add_argument("--disable-backgrounding-occluded-windows")
        options.add_argument("--disable-breakpad")
        options.add_argument("--disable-component-extensions-with-background-pages")
        options.add_argument("--disable-features=TranslateUI")
        options.add_argument("--disable-hang-monitor")
        options.add_argument("--disable-ipc-flooding-protection")
        options.add_argument("--disable-renderer-backgrounding")

        if os.environ.get("CHROME_BIN"):
            options.binary_location = os.environ["CHROME_BIN"]
        elif Path("/usr/bin/chromium").exists():
            options.binary_location = "/usr/bin/chromium"

        self._profile_dir = os.path.join(tempfile.gettempdir(), f"selenium_nc_{os.getpid()}")
        if os.path.exists(self._profile_dir):
            shutil.rmtree(self._profile_dir, ignore_errors=True)
        os.makedirs(self._profile_dir)
        options.add_argument(f"--user-data-dir={self._profile_dir}")
        options.add_argument("--profile-directory=Default")

        chromedriver_path = self._resolve_chromedriver()
        logger.info("Starting Chrome. Binary=%s Driver=%s", options.binary_location or "auto-detect", chromedriver_path)
        service = Service(executable_path=chromedriver_path)
        driver = webdriver.Chrome(service=service, options=options)
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": _CDP_STEALTH})
        return driver, service

    def _clean_wdm_locks(self) -> None:
        try:
            wdm_dir = Path.home() / ".wdm"
            if not wdm_dir.exists():
                return
            for lock_file in wdm_dir.glob("wdm-lock-*"):
                try:
                    lock_file.unlink()
                except Exception:
                    pass
        except Exception:
            pass

    def _get_wdm_cached_driver(self) -> str | None:
        try:
            wdm_dir = Path.home() / ".wdm"
            drivers_json = wdm_dir / "drivers.json"

            for lock_file in wdm_dir.glob("wdm-lock-*"):
                try:
                    lock_file.unlink()
                except Exception:
                    pass

            if not drivers_json.exists():
                return None

            import json as _json
            with open(drivers_json, "r") as f:
                drivers: dict = _json.load(f)

            best_entry: str | None = None
            best_time: str = ""

            for key, val in drivers.items():
                if "chromedriver" not in key:
                    continue
                if platform.system() == "Windows" and "win64" not in key:
                    continue
                if platform.system() != "Windows" and "win64" in key:
                    continue

                binary_path = val.get("binary_path", "")
                timestamp = val.get("timestamp", "")

                if binary_path and (not best_time or timestamp > best_time):
                    best_time = timestamp
                    best_entry = binary_path

            if best_entry:
                normalized = os.path.normpath(os.path.abspath(best_entry))
                if os.path.exists(normalized):
                    return normalized

            return None
        except Exception:
            return None

    def _resolve_chromedriver(self) -> str:
        if self._chromedriver_path:
            return self._chromedriver_path

        if os.environ.get("CHROMEDRIVER_PATH"):
            self._chromedriver_path = os.environ["CHROMEDRIVER_PATH"]
            return self._chromedriver_path

        if platform.system() == "Windows":
            try:
                result = subprocess.run(["where", "chromedriver"], capture_output=True, text=True, timeout=5)
                if result.returncode == 0:
                    path = os.path.normpath(result.stdout.strip().splitlines()[0])
                    if os.path.exists(path):
                        self._chromedriver_path = path
                        return self._chromedriver_path
            except Exception:
                pass
        else:
            for candidate in ("/usr/bin/chromedriver", "/usr/local/bin/chromedriver"):
                if Path(candidate).exists():
                    self._chromedriver_path = candidate
                    return self._chromedriver_path

        wdm_driver = self._get_wdm_cached_driver()
        if wdm_driver:
            self._chromedriver_path = wdm_driver
            return self._chromedriver_path

        self._clean_wdm_locks()
        try:
            import logging as _wdm_log
            _wdm_log.getLogger("WDM").setLevel(_wdm_log.ERROR)

            from webdriver_manager.chrome import ChromeDriverManager
            from webdriver_manager.core.os_manager import ChromeType

            chrome_type = ChromeType.CHROMIUM if platform.system() == "Linux" else ChromeType.GOOGLE
            result: list = []

            def _download():
                try:
                    result.append(ChromeDriverManager(chrome_type=chrome_type).install())
                except Exception:
                    pass

            t = threading.Thread(target=_download, daemon=True)
            t.start()
            t.join(timeout=5)

            if result:
                driver_path = os.path.normpath(os.path.abspath(result[0]))
                self._chromedriver_path = driver_path
                return self._chromedriver_path
        except Exception as exc:
            logger.warning("webdriver-manager could not resolve ChromeDriver (%s) — falling back to 'chromedriver' in PATH.", exc)

        self._chromedriver_path = "chromedriver"
        return self._chromedriver_path

    def _start(self, domain: str = "") -> None:
        with self._lock:
            was_running = self._driver is not None
            if was_running:
                self._close_driver_unlocked()

            self._driver, self._service = self._new_driver()
            self._session_start_time = time.time()
            self._fetch_count = 0

            if domain:
                self._inject_cookies_unlocked(domain)

    def _close_driver_unlocked(self) -> None:
        if self._driver is not None:
            try:
                self._driver.quit()
            except Exception as exc:
                logger.debug("driver.quit() raised: %s", exc)
            self._driver = None

        if self._service is not None:
            try:
                if hasattr(self._service, "process") and self._service.process:
                    proc = self._service.process
                    try:
                        proc.terminate()
                        proc.wait(timeout=5)
                    except Exception:
                        try:
                            proc.kill()
                        except Exception:
                            pass
            except Exception:
                pass
            self._service = None

        if self._profile_dir:
            try:
                shutil.rmtree(self._profile_dir, ignore_errors=True)
            except Exception:
                pass
            self._profile_dir = None

    def _inject_cookies_unlocked(self, domain: str) -> None:
        cookie_file = _site_cookie_file(domain)
        try:
            if not cookie_file.exists():
                return
            cookies = json.loads(cookie_file.read_text())
            if not cookies:
                return
            for c in cookies:
                try:
                    self._driver.add_cookie({
                        "name": c["name"],
                        "value": c["value"],
                        "domain": c.get("domain"),
                        "path": c.get("path", "/"),
                    })
                except Exception:
                    pass
            logger.info("Loaded %d saved cookies from %s", len(cookies), cookie_file.name)
        except Exception as exc:
            logger.debug("Could not load saved cookies: %s", exc)

    def _health_check(self) -> bool:
        if self._driver is None:
            return False
        try:
            self._driver.current_url
            return True
        except Exception:
            return False

    def scroll_and_extract(
        self,
        paragraph_selector: str = "p[data-p-id]",
        wait_ms: int = 400,
        max_steps: int = 50,
        min_steps: int = 3,
    ) -> tuple[list[str], int]:
        from core.scroll_utils import (
            build_scroll_script,
            build_paragraph_count_script,
            build_extract_script,
            build_scroll_to_top_script,
        )

        driver = self._driver
        prev_count = 0
        stable_count = 0
        step = 0

        while step < max_steps:
            metrics = driver.execute_script(build_scroll_script())
            time.sleep(wait_ms / 1000.0)

            current_count = driver.execute_script(
                build_paragraph_count_script(paragraph_selector)
            )

            step += 1

            if current_count == prev_count:
                stable_count += 1
            else:
                stable_count = 0
            prev_count = current_count

            if step >= min_steps:
                if metrics["atBottom"] and stable_count >= 2:
                    break
                if stable_count >= 3:
                    break

        logger.debug("Scroll complete: %d steps, %d paragraphs in DOM", step, prev_count)

        paragraphs: list[str] = driver.execute_script(
            build_extract_script(paragraph_selector)
        )

        driver.execute_script(build_scroll_to_top_script())

        return paragraphs, step

    def _scroll_page(self, driver, domain: str) -> list[str] | None:
        from core.scroll_utils import PARAGRAPH_SELECTORS

        preferred_by_domain: dict[str, str] = {
            "wattpad": "p[data-p-id]",
            "novelworm": ".chapter-content p",
        }

        preferred = preferred_by_domain.get(domain, "p")
        all_selectors = [preferred] + [s for s in PARAGRAPH_SELECTORS if s != preferred]
        chosen = preferred

        for sel in all_selectors:
            count = driver.execute_script(f"return document.querySelectorAll('{sel}').length;")
            if count > 0:
                chosen = sel
                break

        logger.debug("Scroll: using selector '%s' (domain=%s)", chosen, domain)

        paragraphs, _ = self.scroll_and_extract(
            paragraph_selector=chosen,
            wait_ms=800,
            max_steps=50,
            min_steps=3,
        )
        return paragraphs if paragraphs else None

    def fetch(self, url: str, timeout: int = 60, skip_scroll: bool = False) -> tuple[str, int, bytes, dict, list | None]:
        from urllib.parse import urlparse

        domain = urlparse(url).netloc

        with self._lock:
            needs_restart = (
                self._driver is None or not self._health_check() or self._fetch_count >= self._MAX_FETCHES_PER_SESSION
            )
            if needs_restart:
                logger.info("Browser %s (fetch_count=%d) — starting/restarting", "new" if self._driver is None else "restart", self._fetch_count)
                self._start(domain)
            elif self._fetch_count == 0:
                self._inject_cookies_unlocked(domain)

            assert self._driver is not None, "Browser not started"
            driver = self._driver
            self._fetch_count += 1

        try:
            driver.get(url)
        except Exception as exc:
            logger.warning("Browser crash on navigation: %s — restarting and retrying", exc)
            with self._lock:
                self._start(domain)
                driver = self._driver
            driver.get(url)

        scroll_result: list | None = None
        if not skip_scroll:
            try:
                scroll_result = self._scroll_page(driver, domain)
            except Exception as exc:
                logger.warning("Scroll failed for %s: %s — continuing without scroll", url, exc)

        deadline = time.monotonic() + timeout
        while True:
            elapsed = deadline - time.monotonic()
            if elapsed <= 0:
                break
            try:
                title = driver.title
            except Exception:
                break
            if "Just a moment" not in title:
                break
            sleep_time = min(2.0, elapsed)
            if sleep_time <= 0:
                break
            time.sleep(sleep_time)

        if "Just a moment" in driver.title:
            logger.warning("Challenge did not clear for %s within %ds — returning current content", url, timeout)

        time.sleep(0.5)

        final_url = driver.current_url
        body = driver.page_source

        if "Just a moment" not in driver.title:
            self._save_cookies(domain)

        return (
            final_url,
            200,
            body.encode("utf-8"),
            {"Content-Type": "text/html; charset=utf-8"},
            scroll_result,
        )

    def _save_cookies(self, domain: str = "") -> None:
        with self._lock:
            if self._driver is None:
                return
            cookie_file = _site_cookie_file(domain)
            try:
                cookies = self._driver.get_cookies()
                if cookies:
                    cookie_file.parent.mkdir(parents=True, exist_ok=True)
                    cookie_file.write_text(json.dumps(cookies, indent=2), encoding="utf-8")
                    logger.info("Saved %d cookies to %s", len(cookies), cookie_file)
            except Exception as exc:
                logger.warning("Failed to save cookies: %s", exc)

    def close(self) -> None:
        with self._lock:
            self._close_driver_unlocked()
            logger.info("Selenium browser closed")

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass

    @property
    def driver(self):
        self._start("")
        return self._driver


_instance: Optional[_SeleniumBrowser] = None


def _get_browser() -> _SeleniumBrowser:
    global _instance
    if _instance is None:
        _instance = _SeleniumBrowser()
        atexit.register(_instance.close)
    return _instance


class SeleniumHandler(HTTP11DownloadHandler):
    def __init__(self, crawler):
        super().__init__(crawler)
        self._crawler = crawler

    @classmethod
    def from_crawler(cls, crawler):
        return cls(crawler)

    async def download_request(self, request: Request) -> Response:
        if "selenium" not in request.meta:
            return await super().download_request(request)

        browser = _get_browser()
        timeout = request.meta.get("selenium_timeout", 60)
        skip_scroll = request.meta.get("skip_scroll", False)

        try:
            final_url, status, body, headers, scroll_result = await asyncio.to_thread(
                browser.fetch, request.url, timeout, skip_scroll
            )
            resp = TextResponse(
                url=final_url,
                status=status,
                headers=headers,
                body=body,
                request=request,
                encoding="utf-8",
            )
            if scroll_result:
                resp._scroll_paragraphs = scroll_result
            return resp
        except Exception as exc:
            logger.warning("Selenium fetch error for %s: %s", request.url, exc)
            raise
