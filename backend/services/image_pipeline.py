"""
image_pipeline.py

Extracted from unsplash_extract_plus.py.
All status output uses logging. Access key passed as explicit parameter (not global).
"""

import logging
import time
from io import BytesIO
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
import requests
from PIL import Image

logger = logging.getLogger(__name__)

API = "https://api.unsplash.com/search/photos"

THEME_HINTS: dict = {
    "none": [],
    "warm": ["amber", "bronze", "autumn", "sepia", "earth tones"],
    "dark": ["shadow", "night", "noir", "dramatic", "moody"],
    "grey": ["silver", "stone", "concrete", "overcast", "fog", "mist"],
    "blue": ["cobalt", "ocean", "sky", "arctic", "navy", "twilight"],
    "red":  ["crimson", "scarlet", "rose", "fire", "vermillion"],
    "bw":   ["monochrome", "black and white", "minimalist"],
}

THEME_UNSPLASH_COLOR: dict = {
    "none": None,
    "warm": "orange",
    "dark": "black",
    "grey": None,
    "blue": "blue",
    "red":  "red",
    "bw":   "black_and_white",
}

_session = requests.Session()
_session.headers.update({"User-Agent": "Mozilla/5.0 (compatible; CogitoSaaS/1.0)"})


def resize_cover(img: Image.Image, tw: int, th: int) -> Image.Image:
    ow, oh = img.size
    r = max(tw / ow, th / oh)
    nw, nh = int(ow * r), int(oh * r)
    img = img.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - tw) // 2
    top = (nh - th) // 2
    return img.crop((left, top, left + tw, top + th))


def _sleep_until_reset(resp: requests.Response) -> None:
    reset_hdr = resp.headers.get("X-Ratelimit-Reset")
    remain = resp.headers.get("X-Ratelimit-Remaining")
    try:
        reset_epoch = int(reset_hdr) if reset_hdr else None
    except Exception:
        reset_epoch = None

    wait = max(0, reset_epoch - int(time.time())) if reset_epoch else 60
    logger.warning("Rate-limited: remaining=%s — sleeping %ss until reset", remain, wait)
    time.sleep(wait)


def fetch_page(
    query: str,
    page: int,
    per_page: int,
    access_key: str,
    color: Optional[str] = None,
    timeout: int = 12,
    retries: int = 3,
) -> List[dict]:
    """Fetch one page of Unsplash search results. access_key injected by caller."""
    if not access_key:
        raise RuntimeError("Unsplash access_key is required.")
    headers = {
        "Authorization": f"Client-ID {access_key}",
        "Accept-Version": "v1",
    }
    params: dict = {"query": query, "page": page, "per_page": per_page}
    if color:
        params["color"] = color

    attempt = 0
    while True:
        r = _session.get(API, headers=headers, params=params, timeout=timeout)
        if r.status_code == 403 and "Rate Limit" in r.text:
            _sleep_until_reset(r)
            attempt += 1
            continue
        try:
            r.raise_for_status()
            break
        except requests.HTTPError as e:
            attempt += 1
            if attempt >= retries:
                raise RuntimeError(f"{e} — body: {r.text[:200]}...")
            backoff = 2 ** attempt
            logger.warning("fetch_page error: %s — retrying in %ss (attempt %d/%d)", e, backoff, attempt, retries)
            time.sleep(backoff)

    remain = r.headers.get("X-Ratelimit-Remaining", "?")
    limit = r.headers.get("X-Ratelimit-Limit", "?")
    logger.info("Quota: %s/%s remaining", remain, limit)
    if remain != "?" and int(remain) < 5:
        logger.warning("Only %s API calls left this hour!", remain)

    return r.json().get("results", [])


def fetch_images(
    queries: List[str],
    need_total: int,
    tw: int,
    th: int,
    access_key: str,
    color_theme: str = "none",
    per_page: int = 30,
    delay: float = 1.0,
    max_per_query: Optional[int] = None,
) -> List[Tuple[str, str]]:
    """Fetch image (id, url) pairs from Unsplash across multiple queries."""
    results: List[Tuple[str, str]] = []
    q_count = len(queries)
    if q_count == 0:
        return results

    per_q = max(1, need_total // q_count)
    if max_per_query is not None and max_per_query > 0:
        per_q = min(per_q, max_per_query)

    logger.info(
        "Distribution: %d total across %d queries = ~%d per query (max_per_query=%s)",
        need_total, q_count, per_q, max_per_query,
    )

    hints = THEME_HINTS.get(color_theme, [])
    left = need_total
    augmented = [
        (q + " " + hints[0]) if hints else q for q in queries
    ]

    for qi, q in enumerate(augmented):
        if left <= 0:
            break
        want = min(per_q, left)
        page = 1
        pulled = 0
        logger.info("[%d/%d] Query: %r — target %d (left=%d)", qi + 1, q_count, q, want, left)

        while pulled < want:
            take = min(per_page, want - pulled)
            try:
                res = fetch_page(q, page, take, access_key)
            except Exception as e:
                logger.error("page %d: ERROR %s", page, e)
                break
            if not res:
                logger.info("page %d: no results", page)
                break
            for item in res:
                url = item["urls"]["full"]
                fid = item["id"]
                results.append((fid, url))
                pulled += 1
                logger.debug("Collected %d/%d (global %d/%d)", pulled, want, len(results), need_total)
                if pulled >= want:
                    break
            page += 1
            time.sleep(delay)
        left -= pulled

    # Top-up pass — bail out if a full cycle through all queries adds nothing new
    unsplash_color = THEME_UNSPLASH_COLOR.get(color_theme)
    i = 0
    stall_count = 0
    while len(results) < need_total and augmented:
        q = augmented[i % len(augmented)]
        page = 1 + (len(results) // per_page)
        take = min(per_page, need_total - len(results))
        logger.info("[top-up] %d/%d — %r page %d, take %d", len(results), need_total, q, page, take)
        before = len(results)
        try:
            res = fetch_page(q, page, take, access_key, color=unsplash_color)
        except Exception as e:
            logger.error("top-up ERROR: %s", e)
            break
        for item in res:
            results.append((item["id"], item["urls"]["full"]))
            if len(results) >= need_total:
                break
        added = len(results) - before
        if added == 0:
            stall_count += 1
            if stall_count >= len(augmented):
                # Full cycle with no new results — Unsplash has nothing more to give
                logger.info("[top-up] No new results after cycling all queries — stopping.")
                break
        else:
            stall_count = 0
        i += 1
        time.sleep(delay)

    # Dedup by id
    uniq, seen = [], set()
    for fid, url in results:
        if fid in seen:
            continue
        seen.add(fid)
        uniq.append((fid, url))
    return uniq[:need_total]


def brown_ratio(img: Image.Image) -> float:
    """Estimate brown-dominance in HSV. Numpy version (fast)."""
    arr = np.array(img.convert("RGB"))
    hsv = np.array(Image.fromarray(arr, "RGB").convert("HSV"))
    h = hsv[:, :, 0].astype(np.int16)
    s = hsv[:, :, 1].astype(np.int16)
    v = hsv[:, :, 2].astype(np.int16)
    lo, hi = int(255 * 10 / 360), int(255 * 40 / 360)
    mask = (h >= lo) & (h <= hi) & (s >= 40) & (v >= 30)
    return float(mask.sum()) / float(mask.size)


def brightness_ratio(img: Image.Image) -> float:
    """Average brightness (V channel in HSV) on 0-1 scale."""
    hsv = np.array(img.convert("HSV"), dtype=np.float32)
    return float(hsv[:, :, 2].mean() / 255.0)


def download_and_save(
    items: List[Tuple[str, str]],
    dest_dir: str,
    tw: int,
    th: int,
) -> int:
    """Download, resize, and save images to dest_dir. Returns count saved."""
    Path(dest_dir).mkdir(parents=True, exist_ok=True)
    saved = 0
    logger.info("Saving to: %s", dest_dir)

    for idx, (fid, url) in enumerate(items, 1):
        out = Path(dest_dir) / f"{fid}.jpg"
        if out.exists():
            logger.info("%d/%d skip existing %s", idx, len(items), out.name)
            saved += 1
            continue
        try:
            r = _session.get(url, stream=True, timeout=15)
            r.raise_for_status()
            img = Image.open(BytesIO(r.content)).convert("RGB")
            img = resize_cover(img, tw, th)
            img.save(out, "JPEG", quality=92, optimize=True)
            logger.info("%d/%d saved %s", idx, len(items), out.name)
            saved += 1
        except Exception as e:
            logger.error("%d/%d skip %s: %s", idx, len(items), fid, e)
        time.sleep(0.2)

    logger.info("Saved %d/%d images.", saved, len(items))
    return saved
