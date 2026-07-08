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
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from scrapy.core.downloader.handlers.http11 import HTTP11DownloadHandler
from scrapy.http import Request, Response, TextResponse
from utils.proxy import get_proxy_url

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
        proxy_url = get_proxy_url()
        if proxy_url:
            options.add_argument(f"--proxy-server={proxy_url}")

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
        service = Service(executable_path=chromedriver_path) if chromedriver_path else Service()
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

    @staticmethod
    def _extract_major_version(text: str) -> int | None:
        match = re.search(r"\b(\d+)\.\d+\.\d+\.\d+\b", text or "")
        return int(match.group(1)) if match else None

    @staticmethod
    def _run_version_command(command: list[str]) -> str:
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=5)
            return (result.stdout or result.stderr or "").strip()
        except Exception:
            return ""

    def _chrome_major_version(self) -> int | None:
        if platform.system() == "Windows":
            registry_major = self._windows_chrome_major_version()
            if registry_major:
                return registry_major

        candidates: list[str] = []
        env_bin = os.environ.get("CHROME_BIN")
        if env_bin:
            candidates.append(env_bin)

        if platform.system() == "Windows":
            candidates.extend(
                [
                    str(Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Google" / "Chrome" / "Application" / "chrome.exe"),
                    str(Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Google" / "Chrome" / "Application" / "chrome.exe"),
                    str(Path(os.environ.get("LOCALAPPDATA", "")) / "Google" / "Chrome" / "Application" / "chrome.exe"),
                ]
            )
        else:
            candidates.extend(
                [
                    "/usr/bin/google-chrome",
                    "/usr/bin/google-chrome-stable",
                    "/usr/bin/chromium",
                    "/usr/bin/chromium-browser",
                ]
            )

        for name in ("chrome", "chrome.exe", "google-chrome", "chromium", "chromium-browser"):
            found = shutil.which(name)
            if found:
                candidates.append(found)

        seen: set[str] = set()
        for candidate in candidates:
            if not candidate or candidate in seen:
                continue
            seen.add(candidate)
            if not Path(candidate).exists() and shutil.which(candidate) is None:
                continue
            major = self._extract_major_version(self._run_version_command([candidate, "--version"]))
            if major:
                return major
        return None

    def _windows_chrome_major_version(self) -> int | None:
        try:
            import winreg
        except Exception:
            return None

        roots = (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE)
        subkeys = (
            r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
            r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        )
        for root in roots:
            for subkey in subkeys:
                try:
                    with winreg.OpenKey(root, subkey) as parent:
                        for idx in range(winreg.QueryInfoKey(parent)[0]):
                            try:
                                child_name = winreg.EnumKey(parent, idx)
                                with winreg.OpenKey(parent, child_name) as child:
                                    display_name = str(winreg.QueryValueEx(child, "DisplayName")[0])
                                    if "google chrome" not in display_name.lower():
                                        continue
                                    version = str(winreg.QueryValueEx(child, "DisplayVersion")[0])
                                    major = self._extract_major_version(version)
                                    if major:
                                        return major
                            except OSError:
                                continue
                except OSError:
                    continue
        return None

    def _chromedriver_major_version(self, driver_path: str) -> int | None:
        return self._extract_major_version(self._run_version_command([driver_path, "--version"]))

    def _driver_matches_installed_chrome(self, driver_path: str) -> bool:
        chrome_major = self._chrome_major_version()
        driver_major = self._chromedriver_major_version(driver_path)
        if not chrome_major or not driver_major:
            return True
        if chrome_major == driver_major:
            return True
        logger.info(
            "Ignoring ChromeDriver %s because driver major %s does not match Chrome major %s.",
            driver_path,
            driver_major,
            chrome_major,
        )
        return False

    def _cache_chromedriver(self, driver_path: str) -> str:
        self._chromedriver_path = driver_path
        return driver_path

    def _resolve_chromedriver(self) -> str | None:
        if self._chromedriver_path:
            return self._chromedriver_path

        if os.environ.get("CHROMEDRIVER_PATH"):
            driver_path = os.environ["CHROMEDRIVER_PATH"]
            if self._driver_matches_installed_chrome(driver_path):
                return self._cache_chromedriver(driver_path)
            logger.warning("CHROMEDRIVER_PATH points to an incompatible ChromeDriver; trying auto-resolution.")

        if platform.system() == "Windows":
            try:
                result = subprocess.run(["where", "chromedriver"], capture_output=True, text=True, timeout=5)
                if result.returncode == 0:
                    path = os.path.normpath(result.stdout.strip().splitlines()[0])
                    if os.path.exists(path) and self._driver_matches_installed_chrome(path):
                        return self._cache_chromedriver(path)
            except Exception:
                pass
        else:
            for candidate in ("/usr/bin/chromedriver", "/usr/local/bin/chromedriver"):
                if Path(candidate).exists() and self._driver_matches_installed_chrome(candidate):
                    return self._cache_chromedriver(candidate)

        wdm_driver = self._get_wdm_cached_driver()
        if wdm_driver and self._driver_matches_installed_chrome(wdm_driver):
            return self._cache_chromedriver(wdm_driver)

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
            t.join(timeout=20)

            if result:
                driver_path = os.path.normpath(os.path.abspath(result[0]))
                if self._driver_matches_installed_chrome(driver_path):
                    return self._cache_chromedriver(driver_path)
        except Exception as exc:
            logger.warning(
                "webdriver-manager could not resolve ChromeDriver (%s); falling back to Selenium Manager.",
                exc,
            )

        return None

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

    def _dismiss_overlays(self) -> None:
        if self._driver is None:
            return
        try:
            overlay_patterns = [
                ("[class*='popup']", "[class*='close']"),
                ("[class*='overlay']", "[class*='close']"),
                ("[class*='modal']", "[class*='close']"),
                ("[role='dialog']", "button[aria-label*='close' i], button[class*='close'], [class*='close'], svg"),
                ("[aria-modal='true']", "button[aria-label*='close' i], button[class*='close'], [class*='close'], svg"),
                ("div[class*='ReactModal']", "button[aria-label*='close' i], button[class*='close'], [class*='close'], svg"),
                ("[id*='popup']", "[id*='close']"),
                ("[id*='overlay']", "[id*='close']"),
                ("[id*='modal']", "[id*='close']"),
                (".ad-overlay", ".ad-overlay"),
                (".cookie-banner", ".cookie-banner button"),
                ("[class*='consent']", "[class*='consent'] button"),
                ("[class*='gdpr']", "[class*='gdpr'] button"),
                ("[class*='notice']", "[class*='notice'] [class*='close']"),
                (".adsbygoogle", ".adsbygoogle"),
            ]
            dismissed = False
            for overlay_sel, close_sel in overlay_patterns:
                overlays = self._driver.find_elements("css selector", overlay_sel)
                for overlay in overlays:
                    try:
                        rect = overlay.rect
                        if rect["width"] < 50 or rect["height"] < 50:
                            continue
                        style = self._driver.execute_script(
                            "return window.getComputedStyle(arguments[0]).display", overlay
                        )
                        if style == "none":
                            continue
                        close_btns = overlay.find_elements("css selector", close_sel)
                        for btn in close_btns:
                            try:
                                btn.click()
                                dismissed = True
                                break
                            except Exception:
                                pass
                        if not dismissed:
                            try:
                                overlay.click()
                                dismissed = True
                            except Exception:
                                pass
                    except Exception:
                        pass
                    if dismissed:
                        break
                if dismissed:
                    break

            if dismissed:
                time.sleep(0.5)
            try:
                self._driver.switch_to.active_element.send_keys("\ue00c")
            except Exception:
                pass
        except Exception:
            pass

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
            is_garbage_text,
        )

        driver = self._driver
        prev_count = 0
        stable_count = 0
        step = 0

        try:
            while step < max_steps:
                result = driver.execute_script(build_scroll_script())
                if result is None:
                    break
                metrics = result
                time.sleep(wait_ms / 1000.0)
                clicked_more = self._click_reader_load_more(driver)
                if clicked_more:
                    time.sleep(max(wait_ms, 800) / 1000.0)
                    stable_count = 0

                count_result = driver.execute_script(
                    build_paragraph_count_script(paragraph_selector)
                )
                current_count = count_result if count_result is not None else 0

                step += 1

                if current_count == prev_count:
                    stable_count += 1
                else:
                    stable_count = 0
                prev_count = current_count

                if step >= min_steps:
                    if metrics.get("atBottom") and stable_count >= 2:
                        break
                    if stable_count >= 3:
                        break

            logger.debug("Scroll complete: %d steps, %d paragraphs in DOM", step, prev_count)

            raw_result = driver.execute_script(build_extract_script(paragraph_selector))
            raw_paragraphs = raw_result if raw_result is not None else []
            paragraphs = [p for p in raw_paragraphs if not is_garbage_text(p)]
        except Exception as exc:
            logger.warning("scroll_and_extract failed: %s", exc)
            paragraphs = []
            step = 0

        try:
            driver.execute_script(build_scroll_to_top_script())
        except Exception:
            pass

        return paragraphs, step

    def _click_reader_load_more(self, driver) -> int:
        try:
            result = driver.execute_script(
                """
                (function () {
                    var labels = [
                        'load more',
                        'show more',
                        'read more',
                        'continue reading',
                        'continue',
                        'more'
                    ];
                    var candidates = Array.from(document.querySelectorAll(
                        'article button, article a, main button, main a, button, a[role="button"]'
                    ));
                    var clicked = 0;
                    for (var i = 0; i < candidates.length && clicked < 3; i++) {
                        var el = candidates[i];
                        var text = (el.innerText || el.textContent || '').trim().toLowerCase();
                        if (!text) continue;
                        var matches = labels.some(function (label) { return text === label || text.indexOf(label) >= 0; });
                        if (!matches) continue;
                        var rect = el.getBoundingClientRect();
                        if (rect.width < 20 || rect.height < 10) continue;
                        var style = window.getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') continue;
                        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
                        try {
                            el.scrollIntoView({ behavior: 'instant', block: 'center' });
                            el.click();
                            clicked += 1;
                        } catch (err) {}
                    }
                    return clicked;
                })();
                """
            )
            return int(result or 0)
        except Exception:
            return 0

    def _scroll_page(self, driver, domain: str) -> list[str] | None:
        from core.scroll_utils import (
            PARAGRAPH_SELECTORS,
            build_wait_for_container_script,
            build_scroll_to_element_script,
            build_extract_script,
            is_garbage_text,
        )

        def is_novelworm(d: str) -> bool:
            return d == "novelworm.com" or d.endswith(".novelworm.com")

        if is_novelworm(domain):
            # NovelWorm: content is in the initial HTML — no scrolling needed.
            # The chapter text lives in direct children of .content (title + body paragraphs).
            # Sidebar recommendations use separate .content containers — exclude them.
            novelworm_selectors = [
                ".content > .content-font",
                ".read-pc-body",
                ".read-pc-body-center",
                ".chapter-content",
            ]
            for sel in novelworm_selectors:
                try:
                    count = driver.execute_script(
                        f"return document.querySelectorAll('{sel}').length;"
                    )
                except Exception as e:
                    logger.debug("NovelWorm selector '%s' error: %s", sel, e)
                    count = 0
                if not count:
                    continue
                try:
                    raw = driver.execute_script(build_extract_script(sel))
                    paragraphs = [p for p in (raw or []) if not is_garbage_text(p)]
                except Exception:
                    paragraphs = []
                if paragraphs:
                    logger.debug(
                        "NovelWorm: extracted %d paragraphs from '%s' (count=%d, no scroll needed)",
                        len(paragraphs), sel, count,
                    )
                    return paragraphs
            # Fallback: if no selectors found content, try scrolling anyway
            logger.debug("NovelWorm: no selectors matched — falling back to scroll")
            for sel in novelworm_selectors:
                try:
                    count = driver.execute_script(
                        f"return document.querySelectorAll('{sel}').length;"
                    )
                except Exception:
                    count = 0
                if not count:
                    continue
                paragraphs, _ = self.scroll_and_extract(
                    paragraph_selector=sel,
                    wait_ms=800,
                    max_steps=50,
                    min_steps=3,
                )
                if paragraphs:
                    return paragraphs
            return None

        preferred_by_domain: dict[str, str] = {
            "wattpad": "p[data-p-id]",
            "www.inkitt.com": "article#story-text-container p[data-content], article#story-text-container p",
            "inkitt.com": "article#story-text-container p[data-content], article#story-text-container p",
        }
        preferred = preferred_by_domain.get(domain, "p")
        all_selectors = [preferred] + [s for s in PARAGRAPH_SELECTORS if s != preferred]

        for sel in all_selectors:
            try:
                count = driver.execute_script(
                    f"return document.querySelectorAll('{sel}').length;"
                )
            except Exception:
                count = 0
            if count and count > 0:
                paragraphs, _ = self.scroll_and_extract(
                    paragraph_selector=sel,
                    wait_ms=800,
                    max_steps=50,
                    min_steps=3,
                )
                if paragraphs:
                    return paragraphs
        return None

    def fetch_with_retry(
        self,
        url: str,
        timeout: int = 60,
        skip_scroll: bool = False,
        max_retries: int = 2,
    ) -> tuple[str, int, bytes, dict, list | None]:
        last_exc: Exception | None = None
        for attempt in range(max_retries + 1):
            try:
                result = self.fetch(url, timeout=timeout, skip_scroll=skip_scroll)
                return result
            except Exception as exc:
                last_exc = exc
                if attempt < max_retries:
                    wait = (attempt + 1) * 3
                    logger.info("Fetch attempt %d failed for %s — waiting %ds before retry", attempt + 1, url, wait)
                    time.sleep(wait)
                    try:
                        self._start(urlparse(url).netloc)
                    except Exception:
                        pass
        raise last_exc if last_exc else RuntimeError(f"All {max_retries + 1} fetch attempts failed for {url}")

    def fetch(self, url: str, timeout: int = 60, skip_scroll: bool = False) -> tuple[str, int, bytes, dict, list | None]:
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

        try:
            self._dismiss_overlays()
        except Exception:
            pass

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
