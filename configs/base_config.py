"""Helper functions for loading and validating YAML site configs."""

from pathlib import Path
from typing import Any

import yaml


DEFAULT_CONFIGS_DIR = Path(__file__).parent


def load_site_config(name: str, configs_dir: Path | None = None) -> dict[str, Any]:
    if configs_dir is None:
        configs_dir = DEFAULT_CONFIGS_DIR

    config_path = configs_dir / f"{name}.yaml"

    with open(config_path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def validate_config(config: dict[str, Any]) -> list[str]:
    required_keys = ["site_name", "base_url", "selectors"]
    warnings = []

    for key in required_keys:
        if key not in config:
            warnings.append(f"Missing recommended key: '{key}'")

    selectors = config.get("selectors", {})
    required_selectors = ["novel_title", "chapter_list", "chapter_body"]
    for sel in required_selectors:
        if sel not in selectors:
            warnings.append(f"Missing selector: 'selectors.{sel}'")

    return warnings
