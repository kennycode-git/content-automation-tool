"""
pexels_pipeline.py

Fetch images from the Pexels API.
API endpoint: GET https://api.pexels.com/v1/search
Auth: Authorization: <access_key> (no "Client-ID" prefix)
Rate limits: 200 requests/hour (free tier), 20,000/month.
"""

import logging
import time
from typing import List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

PEXELS_API = "https://api.pexels.com/v1/search"

THEME_HINTS: dict = {
    "none":    [],
    "warm":    ["amber", "bronze", "autumn"],
    "dark":    ["dark", "night", "dramatic"],
    "grey":    ["silver", "stone", "mist"],
    "blue":    ["cobalt", "ocean", "sky"],
    "red":     ["crimson", "rose", "fire"],
    "bw":      ["monochrome", "minimalist"],
    "sepia":   ["vintage", "aged", "antique"],
    "low_exp": ["shadows", "low light"],
}

_session = requests.Session()
_session.headers.update({"User-Agent": "Mozilla/5.0 (compatible; CogitoSaaS/1.0)"})


def fetch_images_pexels(
    queries: List[str],
    need_total: int,
    tw: int,
    th: int,
    access_key: str,
    color_theme: str = "none",
    per_page: int = 30,
    delay: float = 0.3,
    max_per_query: Optional[int] = None,
) -> List[Tuple[str, str]]:
    """Fetch (id, url) pairs from Pexels across multiple queries.
    Signature mirrors fetch_images() in image_pipeline.py for drop-in use."""
    if not access_key:
        raise RuntimeError("Pexels access_key is required.")

    headers = {"Authorization": access_key}
    results: List[Tuple[str, str]] = []
    q_count = len(queries)
    if q_count == 0:
        return results

    per_q = max(1, need_total // q_count)
    if max_per_query is not None and max_per_query > 0:
        per_q = min(per_q, max_per_query)

    hints = THEME_HINTS.get(color_theme, [])
    left = need_total
    augmented = [(q + " " + hints[0]) if hints else q for q in queries]

    for qi, q in enumerate(augmented):
        if left <= 0:
            break
        want = min(per_q, left)
        page = 1
        pulled = 0
        logger.info("[pexels %d/%d] Query: %r — target %d", qi + 1, q_count, q, want)

        while pulled < want:
            take = min(per_page, want - pulled)
            try:
                r = _session.get(
                    PEXELS_API,
                    headers=headers,
                    params={"query": q, "per_page": take, "page": page},
                    timeout=12,
                )
                if r.status_code == 429:
                    wait = int(r.headers.get("Retry-After", 65))
                    logger.warning("Pexels rate limit — waiting %ds", wait)
                    time.sleep(wait)
                    continue
                r.raise_for_status()
            except requests.HTTPError as e:
                logger.error("Pexels HTTP error: %s — status: %s — body: %s", e, r.status_code, r.text[:200])
                if r.status_code in (401, 403):
                    raise RuntimeError(
                        f"Pexels API key invalid or unauthorized (HTTP {r.status_code}). "
                        "Check PEXELS_ACCESS_KEY environment variable."
                    )
                break

            photos = r.json().get("photos", [])
            if not photos:
                break
            for photo in photos:
                src = photo.get("src", {})
                url = src.get("large2x") or src.get("large") or src.get("medium")
                if not url:
                    continue
                results.append((f"px_{photo['id']}", url))
                pulled += 1
                if pulled >= want:
                    break
            page += 1
            time.sleep(delay)
        left -= pulled

    return _dedup(results, need_total)


def _dedup(results: List[Tuple[str, str]], limit: int) -> List[Tuple[str, str]]:
    uniq, seen = [], set()
    for fid, url in results:
        if fid in seen:
            continue
        seen.add(fid)
        uniq.append((fid, url))
    return uniq[:limit]
