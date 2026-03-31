"""
pexels_video_pipeline.py

Fetch video clip metadata from the Pexels Videos API.
API endpoint: GET https://api.pexels.com/videos/search
Auth: Authorization: <access_key> (same as photo API, no prefix)
Rate limits: shared with photo API (200 req/hour, 20,000/month)

Returns metadata only — no downloading. Downloads happen in clip_job_manager.py
when the user submits a generate request.
"""

import logging
import time
from dataclasses import dataclass
from typing import List, Optional

import requests

from services.image_pipeline import RateLimitError
from services.pexels_pipeline import THEME_HINTS

logger = logging.getLogger(__name__)

PEXELS_VIDEOS_API = "https://api.pexels.com/videos/search"

_session = requests.Session()
_session.headers.update({"User-Agent": "Mozilla/5.0 (compatible; CogitoSaaS/1.0)"})


@dataclass
class PexelsClip:
    id: str           # "pv_{video_id}"
    duration: int     # seconds
    thumbnail: str    # direct JPEG URL (the "image" field from Pexels)
    preview_url: str  # HD MP4 link for browser <video> preview
    download_url: str # HD MP4 link for server-side download (same as preview_url)
    width: int
    height: int


def _best_video_file(video_files: list) -> Optional[dict]:
    """
    Select the best quality video file from a Pexels video's file list.
    Prefers HD (quality=="hd") with width >= 1280. Falls back to highest width.
    """
    if not video_files:
        return None
    hd = [f for f in video_files if f.get("quality") == "hd" and f.get("width", 0) >= 1280]
    if hd:
        return max(hd, key=lambda f: f.get("width", 0))
    return max(video_files, key=lambda f: f.get("width", 0))


def fetch_video_clips(
    queries: List[str],
    per_query: int,
    access_key: str,
    color_theme: str = "none",
    delay: float = 0.15,
) -> List[PexelsClip]:
    """
    Fetch video clip metadata from the Pexels Videos API across multiple queries.
    Returns deduplicated PexelsClip list (metadata only — no downloading).

    Args:
        queries:     1-3 search terms.
        per_query:   Max clips to fetch per term (1-10).
        access_key:  Pexels API key.
        color_theme: Used to append theme hint words to queries.
        delay:       Seconds between API requests (rate limit courtesy).

    Raises:
        RateLimitError: On HTTP 429 (rate limit hit).
        RuntimeError:   On auth errors or total fetch failure.
    """
    if not access_key:
        raise RuntimeError("PEXELS_ACCESS_KEY is required for video clips.")

    headers = {"Authorization": access_key}
    hints = THEME_HINTS.get(color_theme, [])

    clips: List[PexelsClip] = []
    seen_ids: set = set()

    for qi, query in enumerate(queries):
        augmented_query = f"{query} {hints[qi % len(hints)]}" if hints else query
        logger.info("[clip %d/%d] Query: %r — target %d clips", qi + 1, len(queries), augmented_query, per_query)

        page = 1
        fetched = 0
        while fetched < per_query:
            per_page = min(15, per_query - fetched)  # Pexels video API max per_page is 80, keep small
            params = {"query": augmented_query, "per_page": per_page, "page": page}

            try:
                r = _session.get(PEXELS_VIDEOS_API, headers=headers, params=params, timeout=12)
            except requests.RequestException as e:
                logger.error("Pexels video API request failed: %s", e)
                break

            if r.status_code == 429:
                wait = int(r.headers.get("Retry-After", 65))
                logger.warning("Pexels video rate limited — raising RateLimitError(wait=%ds)", wait)
                raise RateLimitError(wait)
            if r.status_code in (401, 403):
                raise RuntimeError(f"Pexels video API auth error ({r.status_code}) — check PEXELS_ACCESS_KEY")
            if not r.ok:
                logger.error("Pexels video API error %d: %s", r.status_code, r.text[:200])
                break

            data = r.json()
            videos = data.get("videos", [])
            if not videos:
                logger.info("[clip %d/%d] page %d: no results", qi + 1, len(queries), page)
                break

            for v in videos:
                vid_id = f"pv_{v['id']}"
                if vid_id in seen_ids:
                    continue
                best = _best_video_file(v.get("video_files", []))
                if not best:
                    continue
                link = best.get("link", "")
                if not link.startswith("https://videos.pexels.com/"):
                    continue  # skip unexpected URLs

                clips.append(PexelsClip(
                    id=vid_id,
                    duration=v.get("duration", 0),
                    thumbnail=v.get("image", ""),
                    preview_url=link,
                    download_url=link,
                    width=best.get("width", 0),
                    height=best.get("height", 0),
                ))
                seen_ids.add(vid_id)
                fetched += 1
                if fetched >= per_query:
                    break

            page += 1
            time.sleep(delay)

    logger.info("fetch_video_clips: returned %d clips for %d queries", len(clips), len(queries))
    return clips
