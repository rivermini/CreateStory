"""Site configuration discovery from YAML files."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class SiteInfo:
    config_name: str
    site_name: str
    base_url: str
    all_domains: list[str] = field(default_factory=list)
    rate_limit: float = 1.0


@dataclass
class SiteConfig:
    site_name: str
    base_url: str
    domains: list[str]
    rate_limit: float
    config_name: str


def discover_sites(configs_dir: Optional[Path] = None) -> list[SiteConfig]:
    import yaml

    if configs_dir is None:
        configs_dir = Path(__file__).parent.parent.parent / "configs"

    sites: list[SiteConfig] = []

    for yaml_path in sorted(configs_dir.glob("*.yaml")):
        try:
            with yaml_path.open("r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
        except Exception:
            continue

        site_name = data.get("site_name") or yaml_path.stem
        base_url = data.get("base_url", "")
        domains = data.get("domains", [])
        if isinstance(domains, str):
            domains = [domains]
        rate_limit = float(data.get("rate_limit", 1.0))

        sites.append(SiteConfig(
            site_name=site_name,
            base_url=base_url,
            domains=domains,
            rate_limit=rate_limit,
            config_name=yaml_path.stem,
        ))

    return sites


def slug_from_url(url: str) -> Optional[str]:
    if not url:
        return None

    url = url.rstrip("/")

    for pattern in [
        r"/stories/([^/?#]+)",
        r"/novel/([^/?#]+)",
        r"/story/([^/?#]+)",
        r"/book/([^/?#]+)",
        r"/series/([^/?#]+)",
        r"/works/([^/?#]+)",
        r"/[^/]+/([^/?#]+)",
    ]:
        m = re.search(pattern, url, re.IGNORECASE)
        if m:
            slug = m.group(1)
            slug = re.sub(r"-chapter-\d+(?:-\d+)?$", "", slug, flags=re.IGNORECASE)
            return slug

    segments = url.rstrip("/").split("/")
    if segments:
        return segments[-1]

    return None
