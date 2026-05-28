"""Site detection service."""

from __future__ import annotations

import logging
import re
from typing import Optional

from api.models.site_info import NovelMetadata, SiteDetectResponse, SiteInfoResponse
from api.services.config_discovery import slug_from_url
from api.services.site_registry import SiteRegistry

logger = logging.getLogger(__name__)

_SEASON_RE = re.compile(r"[Ss]eason\s*(\d+)\s*(?:of|/)\s*(\d+)")


def _fetch_wattpad_metadata(story_id: str) -> Optional[NovelMetadata]:
    from api.services.wattpad_api import get

    api_url = (
        f"https://www.wattpad.com/api/v3/stories/{story_id}"
        f"?fields=id,title,description,cover,completed,mature,"
        f"readCount,voteCount,commentCount,numParts,rating,tags,"
        f"language,isPaywalled,paidModel,"
        f"user(name,avatar,fullname),"
        f"parts(id,title,url,length,createDate,voteCount,readCount)"
    )

    try:
        resp = get(api_url, story_id=story_id, timeout=20)
        if resp.status_code != 200:
            return None
        data = resp.json()
    except Exception:
        return None

    if not isinstance(data, dict):
        return None

    user = data.get("user", {})
    description = data.get("description", "") or ""
    season_match = _SEASON_RE.search(description)
    season_current = int(season_match.group(1)) if season_match else None
    season_total = int(season_match.group(2)) if season_match else None

    return NovelMetadata(
        title=data.get("title"),
        author=user.get("name"),
        authors=[user.get("name")] if user.get("name") else None,
        author_fullname=user.get("fullname") or user.get("name"),
        author_avatar=user.get("avatar"),
        cover_url=data.get("cover"),
        description=description,
        views=data.get("readCount"),
        stars=data.get("voteCount"),
        comment_count=data.get("commentCount"),
        num_parts=data.get("numParts"),
        language=data.get("language"),
        tags=data.get("tags") or [],
        completed=data.get("completed"),
        mature=data.get("mature"),
        is_paywalled=data.get("isPaywalled"),
        season_current=season_current,
        season_total=season_total,
    )


class SiteService:
    def __init__(self) -> None:
        self._registry = SiteRegistry()

    def detect_site(self, url: str) -> SiteDetectResponse:
        if not url:
            return SiteDetectResponse(valid=False, message="URL cannot be empty.")

        if not url.startswith(("http://", "https://")):
            return SiteDetectResponse(valid=False, message="URL must start with http:// or https://.")

        site_info = self._registry.match_url(url)

        if site_info is None:
            known = ", ".join(self._registry.known_domains())
            return SiteDetectResponse(
                valid=False,
                message=f"Unsupported site. Known sites: {known}",
            )

        slug = slug_from_url(url)
        if not slug:
            return SiteDetectResponse(
                valid=False,
                site=SiteInfoResponse(
                    config_name=site_info.config_name,
                    site_name=site_info.site_name,
                    base_url=site_info.base_url,
                    rate_limit=site_info.rate_limit,
                ),
                message="Could not extract a novel slug from the URL.",
            )

        resolved_url: Optional[str] = None
        story_title: Optional[str] = None
        novel_meta: Optional[NovelMetadata] = None

        if site_info.config_name == "wattpad":
            from api.services.wattpad_url_resolver import resolve_wattpad_url

            story_info = resolve_wattpad_url(url)
            if story_info:
                resolved_url = story_info.detected_url
                story_title = story_info.story_title
                slug = story_info.story_id
                novel_meta = _fetch_wattpad_metadata(story_info.story_id)
            else:
                resolved_url = url

        elif site_info.config_name == "novelworm":
            try:
                from handlers.selenium_handler import _get_browser
                browser = _get_browser()
                _, _, body, _, _ = browser.fetch(url, timeout=30, skip_scroll=True)
                html = body.decode("utf-8", errors="replace")
            except Exception:
                html = ""
            if html:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(html, "html.parser")
                for sel, attr in [
                    ("meta[property='og:title']", "content"),
                    ("h1.story-title", None),
                    (".story-header h1", None),
                    (".story-info h1", None),
                    ("[class*='story-title']", None),
                ]:
                    el = soup.select_one(sel)
                    if el:
                        story_title = (el.get(attr, "") or el.get_text(strip=True)).strip() if attr else el.get_text(strip=True)
                        if story_title:
                            break

        return SiteDetectResponse(
            site=SiteInfoResponse(
                config_name=site_info.config_name,
                site_name=site_info.site_name,
                base_url=site_info.base_url,
                rate_limit=site_info.rate_limit,
            ),
            slug=slug,
            valid=True,
            message="Site detected successfully.",
            story_title=story_title,
            resolved_url=resolved_url,
            novel_metadata=novel_meta,
        )

    def list_sites(self) -> list[SiteInfoResponse]:
        return [
            SiteInfoResponse(
                config_name=s.config_name,
                site_name=s.site_name,
                base_url=s.base_url,
                rate_limit=s.rate_limit,
            )
            for s in self._registry.sites
        ]


_site_service: Optional[SiteService] = None


def get_site_service() -> SiteService:
    global _site_service
    if _site_service is None:
        _site_service = SiteService()
    return _site_service
