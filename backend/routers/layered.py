"""
layered.py

GET /api/layered/search-backgrounds — Pexels video search for background layer videos.

Security:
- JWT required (get_current_user_id dependency).
- download_url validated to start with https://videos.pexels.com/ (prevents SSRF).
- query length capped at 100 chars, count capped at 20.
"""

import logging
import os
import re
from typing import List

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from routers.auth import get_current_user_id

logger = logging.getLogger(__name__)
router = APIRouter()

_ALLOWED_URL_RE = re.compile(r"^https://videos\.pexels\.com/")


class BgVideoResult(BaseModel):
    id: str
    duration: int
    thumbnail: str
    preview_url: str
    download_url: str
    width: int
    height: int


class BgVideoSearchResponse(BaseModel):
    page: int
    per_page: int
    has_more: bool
    items: List[BgVideoResult]


@router.get("/layered/search-backgrounds", response_model=BgVideoSearchResponse)
async def search_background_videos(
    query: str = Query(..., min_length=1, max_length=100),
    count: int = Query(default=9, ge=1, le=20),
    page: int = Query(default=1, ge=1, le=50),
    user_id: str = Depends(get_current_user_id),
):
    """
    Search Pexels for background videos to use in the layered rendering mode.
    Returns thumbnail + preview + download URLs — no server-side downloading.
    """
    pexels_key = os.environ.get("PEXELS_ACCESS_KEY", "")
    if not pexels_key:
        raise HTTPException(status_code=503, detail="Pexels API key not configured.")

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            "https://api.pexels.com/videos/search",
            headers={"Authorization": pexels_key},
            params={
                "query": query,
                "per_page": min(count * 2, 40),  # fetch extra, filter to portrait
                "page": page,
                "orientation": "portrait",
                "size": "large",
            },
        )

    if resp.status_code == 401:
        raise HTTPException(status_code=503, detail="Pexels API auth error — check PEXELS_ACCESS_KEY.")
    if resp.status_code != 200:
        logger.error("Pexels API error %d: %s", resp.status_code, resp.text[:200])
        raise HTTPException(status_code=502, detail="Pexels video search failed.")

    results: List[BgVideoResult] = []
    for video in resp.json().get("videos", []):
        files = video.get("video_files", [])

        # Prefer portrait-oriented HD files
        portrait = [f for f in files if f.get("height", 0) >= f.get("width", 1)]
        candidates = portrait if portrait else files
        candidates.sort(key=lambda f: f.get("height", 0), reverse=True)

        best = next((f for f in candidates if _ALLOWED_URL_RE.match(f.get("link", ""))), None)
        if not best:
            continue

        # Smaller preview file (sd/hd) to avoid streaming large HD in the picker
        preview = next(
            (f["link"] for f in files if f.get("quality") in ("sd", "hd")
             and _ALLOWED_URL_RE.match(f.get("link", ""))),
            best["link"],
        )

        results.append(BgVideoResult(
            id=f"bgv_{video['id']}",
            duration=video.get("duration", 0),
            thumbnail=video.get("image", ""),
            preview_url=preview,
            download_url=best["link"],
            width=best.get("width", 1080),
            height=best.get("height", 1920),
        ))

        if len(results) >= count:
            break

    return BgVideoSearchResponse(
        page=page,
        per_page=count,
        has_more=len(results) >= count,
        items=results,
    )
