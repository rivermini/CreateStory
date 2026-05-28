"""Registry of discovered site configurations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from api.services.config_discovery import SiteConfig, SiteInfo, discover_sites


@dataclass
class MatchedSite:
    config_name: str
    site_name: str
    base_url: str
    all_domains: list[str]
    rate_limit: float


class SiteRegistry:
    def __init__(self, configs_dir=None):
        self._configs = discover_sites(configs_dir)
        self._build_index()

    def _build_index(self) -> None:
        self._domains: dict[str, SiteInfo] = {}
        self._configs_by_name: dict[str, SiteConfig] = {}

        for cfg in self._configs:
            site = SiteInfo(
                config_name=cfg.config_name,
                site_name=cfg.site_name,
                base_url=cfg.base_url,
                all_domains=cfg.domains,
                rate_limit=cfg.rate_limit,
            )
            self._configs_by_name[cfg.config_name] = cfg
            for domain in cfg.domains:
                self._domains[domain.lower()] = site
                if domain.startswith("www."):
                    bare = domain[4:]
                    self._domains[bare.lower()] = site

    @property
    def sites(self) -> list[SiteInfo]:
        return [SiteInfo(
            config_name=c.config_name,
            site_name=c.site_name,
            base_url=c.base_url,
            all_domains=c.domains,
            rate_limit=c.rate_limit,
        ) for c in self._configs]

    def match_url(self, url: str) -> Optional[MatchedSite]:
        import re

        if not url:
            return None

        m = re.match(r"https?://([^/:]+)", url, re.IGNORECASE)
        if not m:
            return None

        domain = m.group(1).lower()

        if domain in self._domains:
            site = self._domains[domain]
            return MatchedSite(
                config_name=site.config_name,
                site_name=site.site_name,
                base_url=site.base_url,
                all_domains=site.all_domains,
                rate_limit=site.rate_limit,
            )

        parts = domain.split(".")
        for i in range(1, len(parts)):
            sub = ".".join(parts[i:])
            if sub in self._domains:
                site = self._domains[sub]
                return MatchedSite(
                    config_name=site.config_name,
                    site_name=site.site_name,
                    base_url=site.base_url,
                    all_domains=site.all_domains,
                    rate_limit=site.rate_limit,
                )

        return None

    def known_domains(self) -> list[str]:
        return list(self._domains.keys())


_registry: Optional[SiteRegistry] = None


def get_registry() -> SiteRegistry:
    global _registry
    if _registry is None:
        _registry = SiteRegistry()
    return _registry
