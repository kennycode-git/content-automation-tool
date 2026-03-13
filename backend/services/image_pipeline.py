"""
image_pipeline.py

Extracted from unsplash_extract_plus.py.
All status output uses logging. Access key passed as explicit parameter (not global).
"""

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
import requests
from PIL import Image

logger = logging.getLogger(__name__)

API = "https://api.unsplash.com/search/photos"

THEME_HINTS: dict = {
    "none":    [],
    "warm":    ["amber", "bronze", "autumn", "earth tones"],
    "dark":    ["dark", "night", "noir", "dramatic", "moody"],
    "grey":    ["silver", "stone", "concrete", "overcast", "fog", "mist"],
    "blue":    ["cobalt", "ocean", "sky", "arctic", "navy", "twilight"],
    "red":     ["crimson", "scarlet", "rose", "fire", "vermillion"],
    "bw":      ["monochrome", "black and white", "minimalist"],
    "sepia":   ["sepia", "vintage", "aged", "antique", "brown"],
    "low_exp": ["shadows", "low light", "dark", "underexposed"],
}

THEME_UNSPLASH_COLOR: dict = {
    "none":    None,
    "warm":    "orange",
    "dark":    "black",
    "grey":    None,
    "blue":    "blue",
    "red":     "red",
    "bw":      "black_and_white",
    "sepia":   "orange",   # closest supported color to brown
    "low_exp": "black",
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


class RateLimitError(Exception):
    """Raised when Unsplash returns 403 rate-limited. wait = seconds until quota resets."""
    def __init__(self, wait: int):
        self.wait = wait
        super().__init__(f"Unsplash rate limit hit — retry after {wait}s")


def fetch_page(
    query: str,
    page: int,
    per_page: int,
    access_key: str,
    color: Optional[str] = None,
    timeout: int = 12,
    retries: int = 3,
) -> dict:
    """Fetch one page of Unsplash search results. Returns dict with 'results' and '_remaining'."""
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
            reset_hdr = r.headers.get("X-Ratelimit-Reset")
            try:
                reset_epoch = int(reset_hdr) if reset_hdr else None
            except Exception:
                reset_epoch = None
            wait = max(65, reset_epoch - int(time.time())) if reset_epoch else 65
            logger.warning("Rate-limited — raising RateLimitError(wait=%ds)", wait)
            raise RateLimitError(wait)
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

    data = r.json()
    data["_remaining"] = remain
    return data


def fetch_images(
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

    left = need_total
    augmented = queries[:]  # top-up pass uses these with color= param

    for qi, q in enumerate(queries):
        if left <= 0:
            break
        want = min(per_q, left)
        page = 1
        pulled = 0
        logger.info("[%d/%d] Query: %r — target %d (left=%d)", qi + 1, q_count, q, want, left)

        while pulled < want:
            take = min(per_page, want - pulled)
            try:
                data = fetch_page(q, page, take, access_key)
            except RateLimitError:
                raise
            except Exception as e:
                logger.error("page %d: ERROR %s", page, e)
                break
            remaining = data.get("_remaining", "?")
            res = data.get("results", [])
            if not res:
                logger.info("page %d: no results", page)
                break
            for item in res:
                url = item["urls"]["regular"]
                fid = item["id"]
                results.append((fid, url))
                pulled += 1
                logger.debug("Collected %d/%d (global %d/%d)", pulled, want, len(results), need_total)
                if pulled >= want:
                    break
            page += 1
            if remaining != "?" and int(remaining) < 3:
                logger.warning("API quota nearly exhausted (%s left) — stopping early, will use repeats", remaining)
                return _dedup(results, need_total)
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
            data = fetch_page(q, page, take, access_key, color=unsplash_color)
        except RateLimitError:
            raise
        except Exception as e:
            logger.error("top-up ERROR: %s", e)
            break
        remaining = data.get("_remaining", "?")
        res = data.get("results", [])
        for item in res:
            results.append((item["id"], item["urls"]["regular"]))
            if len(results) >= need_total:
                break
        added = len(results) - before
        if added == 0:
            stall_count += 1
            if stall_count >= len(augmented):
                logger.info("[top-up] No new results after cycling all queries — stopping.")
                break
        else:
            stall_count = 0
        i += 1
        if remaining != "?" and int(remaining) < 3:
            logger.warning("API quota nearly exhausted (%s left) — stopping top-up early, will use repeats", remaining)
            break
        time.sleep(delay)

    return _dedup(results, need_total)


def _dedup(results: List[Tuple[str, str]], limit: int) -> List[Tuple[str, str]]:
    uniq, seen = [], set()
    for fid, url in results:
        if fid in seen:
            continue
        seen.add(fid)
        uniq.append((fid, url))
    return uniq[:limit]


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


def _download_one(fid: str, url: str, dest_dir: Path, tw: int, th: int) -> bool:
    out = dest_dir / f"{fid}.jpg"
    if out.exists():
        return True
    try:
        r = _session.get(url, stream=True, timeout=15)
        r.raise_for_status()
        img = Image.open(BytesIO(r.content)).convert("RGB")
        img = resize_cover(img, tw, th)
        img.save(out, "JPEG", quality=92, optimize=True)
        return True
    except Exception as e:
        logger.error("skip %s: %s", fid, e)
        return False


def download_and_save(
    items: List[Tuple[str, str]],
    dest_dir: str,
    tw: int,
    th: int,
    max_workers: int = 8,
) -> int:
    """Download, resize, and save images to dest_dir concurrently. Returns count saved."""
    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)
    logger.info("Saving %d images to: %s (workers=%d)", len(items), dest_dir, max_workers)

    saved = 0
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {
            pool.submit(_download_one, fid, url, dest, tw, th): (idx, fid)
            for idx, (fid, url) in enumerate(items, 1)
        }
        for future in as_completed(futures):
            idx, fid = futures[future]
            ok = future.result()
            if ok:
                saved += 1
                logger.info("%d/%d saved %s", idx, len(items), fid)

    logger.info("Saved %d/%d images.", saved, len(items))
    return saved
