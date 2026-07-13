"""Fail an image build when the bundled Chromium/ChromeDriver cannot start."""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service


def main() -> None:
    profile = Path(tempfile.mkdtemp(prefix="chromium-build-smoke-"))
    driver = None
    try:
        options = Options()
        options.binary_location = "/usr/bin/chromium"
        for argument in (
            "--headless=new",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            f"--user-data-dir={profile}",
        ):
            options.add_argument(argument)
        driver = webdriver.Chrome(
            service=Service(executable_path="/usr/bin/chromedriver"),
            options=options,
        )
        driver.get("data:text/html,<title>CreateStory Chromium smoke</title>")
        if driver.title != "CreateStory Chromium smoke":
            raise RuntimeError(f"Unexpected Chromium smoke-test title: {driver.title!r}")
        print(f"Chromium WebDriver smoke passed: {driver.capabilities.get('browserVersion', 'unknown')}")
    finally:
        if driver is not None:
            driver.quit()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    main()
