"""
preview.py

POST /api/preview-stage — fetch, download, and colour-grade images for all batches,
upload them to the user-uploads bucket, and return signed URLs for frontend display.

No render credit is consumed — this is a preview/curation step only.
The job row is only created when the user confirms via POST /api/generate.

Security considerations:
- JWT required (get_current_user_id dependency).
- No subscription gate — no render credit consumed.
- user_id from verified JWT, never from request body.
- Uploaded preview images are namespaced under user_id in user-uploads bucket.
- Temp directory is always cleaned up in finally block.
"""

import asyncio
import io
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import List

from PIL import Image as PilImage

from fastapi import APIRouter, Depends, HTTPException

from db.supabase_client import get_client
from models.schemas import (
    PreviewStageRequest,
    PreviewStageResponse,
    PreviewBatchResult,
    PreviewImageItem,
    PreviewFindMoreRequest,
    PreviewFindMoreResponse,
    PreviewRefreshPhilosopherRequest,
    PreviewRefreshPhilosopherResponse,
    PreviewRefreshAccentRequest,
    PreviewRefreshAccentResponse,
)
from routers.auth import get_current_user_id
from services.image_pipeline import fetch_images, download_and_save, RateLimitError
from services.image_grader import apply_theme_grading
from services.storage import get_user_uploads_signed_url

logger = logging.getLogger(__name__)
router = APIRouter()

_PREVIEW_MAX_PX = 720  # longest edge for staged preview thumbnails


def _preview_thumbnail(fpath: Path) -> bytes:
    """Re-encode an image as a small JPEG thumbnail for preview display.
    Reduces the longest edge to _PREVIEW_MAX_PX and saves at quality 78.
    This is display-only — the full-res graded images are stored separately
    in the raw-image cache used for actual rendering.
    """
    with PilImage.open(fpath) as img:
        img = img.convert("RGB")
        img.thumbnail((_PREVIEW_MAX_PX, _PREVIEW_MAX_PX), PilImage.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=78, optimize=True)
        return buf.getvalue()


def _list_system_philosopher_images(key: str) -> list[str]:
    """
    Try a few likely storage prefixes for bundled philosopher images.
    This keeps preview staging resilient if the accent bucket structure differs
    slightly between environments.
    """
    from services.storage import list_accent_images

    prefixes = [
        f"philosopher/{key}",
        f"philosophers/{key}",
        key,
    ]
    for prefix in prefixes:
        try:
            paths = list_accent_images(prefix)
        except Exception as exc:
            logger.warning("Preview: failed to list accent images for %s: %s", prefix, exc)
            continue
        if paths:
            logger.info("Preview: found %d system philosopher images under accent/%s", len(paths), prefix)
            return paths

    logger.warning("Preview: no system philosopher images found for key=%s", key)
    return []


def _write_cover_jpeg(data: bytes, out_path: Path, width: int, height: int) -> None:
    img = PilImage.open(io.BytesIO(data)).convert("RGB")
    iw, ih = img.size
    scale = max(width / iw, height / ih)
    nw, nh = int(iw * scale), int(ih * scale)
    img = img.resize((nw, nh), PilImage.LANCZOS)
    left, top = (nw - width) // 2, (nh - height) // 2
    img = img.crop((left, top, left + width, top + height))
    img.save(out_path, "JPEG", quality=92)


async def _upload_preview_item(
    *,
    user_id: str,
    storage_suffix: str,
    local_path: Path,
    is_philosopher: bool = False,
    is_accent: bool = False,
    source_key: str | None = None,
) -> PreviewImageItem:
    client = get_client()
    preview_data = _preview_thumbnail(local_path)
    render_storage_path = f"{user_id}/staged/{storage_suffix}"
    preview_storage_path = f"{user_id}/preview/{storage_suffix}"
    with open(local_path, "rb") as f:
        render_data = f.read()
    client.storage.from_("user-uploads").upload(
        path=render_storage_path,
        file=render_data,
        file_options={"content-type": "image/jpeg", "upsert": "true"},
    )
    client.storage.from_("user-uploads").upload(
        path=preview_storage_path,
        file=preview_data,
        file_options={"content-type": "image/jpeg", "upsert": "true"},
    )
    signed_url = await get_user_uploads_signed_url(preview_storage_path)
    return PreviewImageItem(
        storage_path=preview_storage_path,
        render_storage_path=render_storage_path,
        signed_url=signed_url,
        is_philosopher=is_philosopher,
        is_accent=is_accent,
        source_key=source_key,
    )


async def _stage_philosopher_preview_items(
    *,
    user_id: str,
    philosopher: str,
    philosopher_count: int,
    philosopher_is_user: bool,
    grade_philosopher: bool,
    color_theme: str,
    custom_grade_params: dict | None,
    width: int,
    height: int,
    storage_prefix: str,
    exclude_source_keys: set[str] | None = None,
) -> list[PreviewImageItem]:
    import random

    from services.storage import download_accent_image, download_user_philosopher_image, list_user_philosopher_images

    exclude = exclude_source_keys or set()
    if philosopher_is_user:
        all_paths = list_user_philosopher_images(user_id, philosopher)
    else:
        all_paths = _list_system_philosopher_images(philosopher)

    available = [path for path in all_paths if path not in exclude]
    if not available:
        return []

    selected = random.sample(available, min(philosopher_count, len(available)))
    items: list[PreviewImageItem] = []

    with tempfile.TemporaryDirectory(prefix="phil_preview_") as tmp_root:
        tmp_dir = Path(tmp_root)
        staging_dir = tmp_dir / "staging"
        staging_dir.mkdir(parents=True, exist_ok=True)

        for idx, source_key in enumerate(selected, 1):
            data = (
                download_user_philosopher_image(source_key)
                if philosopher_is_user
                else download_accent_image(source_key)
            )
            _write_cover_jpeg(data, staging_dir / f"phil_{idx:03d}.jpg", width, height)

        upload_dir = staging_dir
        if grade_philosopher and color_theme and color_theme != "none":
            graded_dir = tmp_dir / "graded"
            graded_out = await asyncio.to_thread(
                apply_theme_grading,
                str(staging_dir),
                str(graded_dir),
                color_theme,
                custom_grade_params,
            )
            upload_dir = Path(graded_out)

        for idx, source_key in enumerate(selected, 1):
            local_path = upload_dir / f"phil_{idx:03d}.jpg"
            if not local_path.is_file():
                continue
            items.append(await _upload_preview_item(
                user_id=user_id,
                storage_suffix=f"{storage_prefix}_{idx:03d}.jpg",
                local_path=local_path,
                is_philosopher=True,
                source_key=source_key,
            ))
    return items


async def _stage_accent_preview_items(
    *,
    user_id: str,
    accent_folder: str,
    accent_count: int,
    width: int,
    height: int,
    storage_prefix: str,
    exclude_source_keys: set[str] | None = None,
) -> list[PreviewImageItem]:
    import random

    from services.storage import download_accent_image, list_accent_images

    exclude = exclude_source_keys or set()
    all_paths = list_accent_images(accent_folder)
    available = [path for path in all_paths if path not in exclude]
    if not available:
        return []

    selected = random.sample(available, min(accent_count, len(available)))
    items: list[PreviewImageItem] = []

    with tempfile.TemporaryDirectory(prefix="accent_preview_") as tmp_root:
        tmp_dir = Path(tmp_root)
        staging_dir = tmp_dir / "staging"
        staging_dir.mkdir(parents=True, exist_ok=True)

        for idx, source_key in enumerate(selected, 1):
            data = download_accent_image(source_key)
            _write_cover_jpeg(data, staging_dir / f"accent_{idx:03d}.jpg", width, height)

        for idx, source_key in enumerate(selected, 1):
            local_path = staging_dir / f"accent_{idx:03d}.jpg"
            if not local_path.is_file():
                continue
            items.append(await _upload_preview_item(
                user_id=user_id,
                storage_suffix=f"{storage_prefix}_{idx:03d}.jpg",
                local_path=local_path,
                is_accent=True,
                source_key=source_key,
            ))
    return items


def _stage_batch_sync(
    *,
    search_terms: List[str],
    uploaded_image_paths: List[str] | None,
    width: int,
    height: int,
    need_total: int,
    access_key: str,
    pexels_key: str,
    color_theme: str,
    custom_grade_params: dict | None,
    image_source: str,
    images_dir: str,
    graded_dir: str,
    page_start: int = 1,
    accent_folder: str | None = None,
    philosopher: str | None = None,
    philosopher_count: int = 3,
    grade_philosopher: bool = False,
    philosopher_is_user: bool = False,
    user_id: str = "",
    phil_dir: str = "",
) -> tuple[str, str | None, bool, list[str], int]:
    """
    Synchronous worker that runs fetch → download → grade for a single batch.
    Returns (graded_dir_path, philosopher_dir_path, pexels_fallback_used, selected_philosopher_paths, accent_count).
    If Unsplash hits a rate limit and pexels_key is available, falls back to Pexels.
    Must be called via asyncio.to_thread.
    """
    os.makedirs(images_dir, exist_ok=True)
    pexels_fallback = False

    # --- Copy any user-uploaded images first ---
    if uploaded_image_paths:
        from db.supabase_client import get_client as _get_client
        from PIL import Image
        import io

        client = _get_client()
        for i, path in enumerate(uploaded_image_paths):
            try:
                if user_id and not path.startswith(f"{user_id}/"):
                    logger.warning("Preview: rejected uploaded image outside user namespace: %s", path)
                    continue
                data = client.storage.from_("user-uploads").download(path)
                img = Image.open(io.BytesIO(data)).convert("RGB")
                iw, ih = img.size
                scale = max(width / iw, height / ih)
                new_w, new_h = int(iw * scale), int(ih * scale)
                img = img.resize((new_w, new_h), Image.LANCZOS)
                left = (new_w - width) // 2
                top = (new_h - height) // 2
                img = img.crop((left, top, left + width, top + height))
                out_path = os.path.join(images_dir, f"upload_{i:04d}.jpg")
                img.save(out_path, "JPEG", quality=90)
            except Exception as e:
                logger.warning("Preview: failed to copy uploaded image %s: %s", path, e)

    # --- Fetch + download images ---
    # No max_per_query cap for preview — fetch as many as possible for a full curation pool.
    items: list = []

    if image_source in ("unsplash", "both"):
        try:
            unsplash_items = fetch_images(
                queries=search_terms,
                need_total=need_total,
                tw=width,
                th=height,
                access_key=access_key,
                color_theme=color_theme,
                max_per_query=None,
                page_start=page_start,
            )
            items.extend(unsplash_items)
        except RateLimitError:
            logger.warning("Preview: Unsplash rate limit hit — falling back to Pexels")
            if pexels_key:
                from services.pexels_pipeline import fetch_images_pexels
                pexels_items = fetch_images_pexels(
                    queries=search_terms,
                    need_total=need_total,
                    tw=width,
                    th=height,
                    access_key=pexels_key,
                    color_theme=color_theme,
                    max_per_query=None,
                    page_start=page_start,
                )
                items.extend(pexels_items)
                pexels_fallback = True
            else:
                raise

    if image_source in ("pexels", "both") and pexels_key:
        from services.pexels_pipeline import fetch_images_pexels
        pexels_items = fetch_images_pexels(
            queries=search_terms,
            need_total=need_total,
            tw=width,
            th=height,
            access_key=pexels_key,
            color_theme=color_theme,
            max_per_query=None,
            page_start=page_start,
        )
        items.extend(pexels_items)

    if items:
        download_and_save(items, images_dir, width, height)

    # --- Apply colour grading ---
    render_dir = apply_theme_grading(images_dir, graded_dir, color_theme, custom_params=custom_grade_params)

    needed_frames = max(1, need_total - 10)
    accent_count = max(1, needed_frames // 5) if accent_folder else 0

    # --- Philosopher images ---
    phil_out_dir: str | None = None
    selected_phil_paths: list[str] = []
    if philosopher and phil_dir:
        import random
        os.makedirs(phil_dir, exist_ok=True)

        if philosopher_is_user and user_id:
            from services.storage import list_user_philosopher_images, download_user_philosopher_image
            phil_paths = list_user_philosopher_images(user_id, philosopher)
            selected = random.sample(phil_paths, min(philosopher_count, len(phil_paths))) if phil_paths else []
            selected_phil_paths = list(selected)
            for idx, path in enumerate(selected, 1):
                try:
                    data = download_user_philosopher_image(path)
                    img = PilImage.open(io.BytesIO(data)).convert("RGB")
                    iw, ih = img.size
                    scale = max(width / iw, height / ih)
                    nw, nh = int(iw * scale), int(ih * scale)
                    img = img.resize((nw, nh), PilImage.LANCZOS)
                    left, top = (nw - width) // 2, (nh - height) // 2
                    img = img.crop((left, top, left + width, top + height))
                    img.save(os.path.join(phil_dir, f"phil_{idx:03d}.jpg"), "JPEG", quality=92)
                except Exception as e:
                    logger.warning("Preview: failed to download user philosopher image %s: %s", path, e)
        else:
            from services.storage import download_accent_image
            phil_paths = _list_system_philosopher_images(philosopher)
            selected = random.sample(phil_paths, min(philosopher_count, len(phil_paths))) if phil_paths else []
            selected_phil_paths = list(selected)
            for idx, path in enumerate(selected, 1):
                try:
                    data = download_accent_image(path)
                    img = PilImage.open(io.BytesIO(data)).convert("RGB")
                    iw, ih = img.size
                    scale = max(width / iw, height / ih)
                    nw, nh = int(iw * scale), int(ih * scale)
                    img = img.resize((nw, nh), PilImage.LANCZOS)
                    left, top = (nw - width) // 2, (nh - height) // 2
                    img = img.crop((left, top, left + width, top + height))
                    img.save(os.path.join(phil_dir, f"phil_{idx:03d}.jpg"), "JPEG", quality=92)
                except Exception as e:
                    logger.warning("Preview: failed to download philosopher image %s: %s", path, e)

        if os.listdir(phil_dir):
            if grade_philosopher and color_theme and color_theme != "none":
                phil_graded = phil_dir + "_graded"
                phil_out_dir = apply_theme_grading(phil_dir, phil_graded, color_theme, custom_params=custom_grade_params)
            else:
                phil_out_dir = phil_dir

    return render_dir, phil_out_dir, pexels_fallback, selected_phil_paths, accent_count


@router.post("/preview-stage", response_model=PreviewStageResponse)
async def preview_stage(
    body: PreviewStageRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Stage images for preview without creating a job or consuming render credits.

    For each batch:
      1. Fetch + download from Unsplash (colour-theme biased)
      2. Apply colour grading
      3. Upload graded images to user-uploads bucket under user_id/preview/
      4. Return signed URLs for frontend display

    Batches are processed sequentially to stay within Unsplash rate limits.
    """
    access_key = os.environ.get("UNSPLASH_ACCESS_KEY", "")
    pexels_key = os.environ.get("PEXELS_ACCESS_KEY", "")
    w, h = (int(x) for x in body.resolution.lower().split("x"))
    # Fetch a generous pool for preview so the user has real selection choice.
    # At least 30 images regardless of video length settings.
    video_need = max(1, int(body.total_seconds / body.seconds_per_image) + 10)
    need_total = max(video_need, 30)
    ts = int(time.time() * 1000)

    tmp_root = tempfile.mkdtemp(prefix="preview_")
    client = get_client()
    batch_results: list[PreviewBatchResult] = []
    any_pexels_fallback = False

    try:
        for batch_idx, batch in enumerate(body.batches):
            images_dir = os.path.join(tmp_root, f"batch_{batch_idx}", "images")
            graded_dir = os.path.join(tmp_root, f"batch_{batch_idx}", "graded")

            # Run sync pipeline in thread pool
            try:
                effective_theme = batch.color_theme or body.color_theme
                effective_grade_params = (
                    batch.custom_grade_params.model_dump() if batch.custom_grade_params else None
                ) if effective_theme == "custom" else None
                render_dir, _, used_pexels, _, _accent_count = await asyncio.to_thread(
                    _stage_batch_sync,
                    search_terms=batch.search_terms,
                    uploaded_image_paths=batch.uploaded_image_paths or None,
                    width=w,
                    height=h,
                    need_total=need_total,
                    access_key=access_key,
                    pexels_key=pexels_key,
                    color_theme=effective_theme,
                    custom_grade_params=effective_grade_params,
                    image_source=body.image_source,
                    images_dir=images_dir,
                    graded_dir=graded_dir,
                    accent_folder=batch.accent_folder,
                    user_id=user_id,
                )
                accent_count = max(1, int(body.total_seconds / body.seconds_per_image) // 5) if batch.accent_folder else 0
                if used_pexels:
                    any_pexels_fallback = True
            except Exception as e:
                logger.exception("Preview stage failed for batch %d: %s", batch_idx, e)
                raise HTTPException(status_code=500, detail=f"Image staging failed: {e}")

            # Upload each graded image and collect signed URLs
            image_items: list[PreviewImageItem] = []
            render_path = Path(render_dir)
            fnames = sorted(f for f in os.listdir(render_dir) if Path(render_dir, f).is_file())

            for fname in fnames:
                fpath = render_path / fname
                try:
                    image_items.append(await _upload_preview_item(
                        user_id=user_id,
                        storage_suffix=f"{ts}_{batch_idx}_{fname}",
                        local_path=fpath,
                    ))
                except Exception as e:
                    logger.warning("Preview: failed to upload/sign %s: %s", fname, e)

            # Upload philosopher images (prepend so they appear first in the grid)
            phil_items: list[PreviewImageItem] = []
            if batch.philosopher:
                try:
                    phil_items = await _stage_philosopher_preview_items(
                        user_id=user_id,
                        philosopher=batch.philosopher,
                        philosopher_count=batch.philosopher_count,
                        philosopher_is_user=batch.philosopher_is_user,
                        grade_philosopher=batch.grade_philosopher,
                        color_theme=effective_theme,
                        custom_grade_params=effective_grade_params,
                        width=w,
                        height=h,
                        storage_prefix=f"{ts}_{batch_idx}_phil",
                    )
                except Exception as e:
                    logger.warning("Preview: failed to stage philosopher images for batch %d: %s", batch_idx, e)

            accent_items: list[PreviewImageItem] = []
            if batch.accent_folder and accent_count > 0:
                try:
                    accent_items = await _stage_accent_preview_items(
                        user_id=user_id,
                        accent_folder=batch.accent_folder,
                        accent_count=accent_count,
                        width=w,
                    height=h,
                    storage_prefix=f"{ts}_{batch_idx}_accent",
                    )
                except Exception as e:
                    logger.warning("Preview: failed to stage accent images for batch %d: %s", batch_idx, e)

            batch_results.append(PreviewBatchResult(
                batch_title=batch.batch_title,
                search_terms=batch.search_terms,
                color_theme=effective_theme,
                accent_folder=batch.accent_folder,
                philosopher=batch.philosopher,
                grade_philosopher=batch.grade_philosopher,
                philosopher_is_user=batch.philosopher_is_user,
                images=phil_items + accent_items + image_items,
            ))
            logger.info(
                "Preview batch %d staged: %d images (%d philosopher, %d accent) for user %s",
                batch_idx, len(phil_items) + len(accent_items) + len(image_items), len(phil_items), len(accent_items), user_id,
            )

        return PreviewStageResponse(batches=batch_results, pexels_fallback=any_pexels_fallback)

    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


@router.post("/preview-find-more", response_model=PreviewFindMoreResponse)
async def preview_find_more(
    body: PreviewFindMoreRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Fetch additional images for a batch already open in PreviewModal.
    No render credit consumed — images are staged in user-uploads like /preview-stage.
    """
    access_key = os.environ.get("UNSPLASH_ACCESS_KEY", "")
    pexels_key = os.environ.get("PEXELS_ACCESS_KEY", "")
    w, h = (int(x) for x in body.resolution.lower().split("x"))
    ts = int(time.time() * 1000)

    # Skip pages already fetched. Pexels/Unsplash default per_page=30.
    # Start from the estimated next page, but continue trying a few pages if
    # duplicate filtering leaves us short of the requested count.
    _per_page = 30
    page_start = max(1, 1 + body.existing_count // _per_page)
    need_total = max(body.count * 3, body.count + 20)

    tmp_root = tempfile.mkdtemp(prefix="find_more_")
    client = get_client()

    try:
        image_items: list[PreviewImageItem] = []
        exclude_ids = set(body.exclude_photo_ids or [])
        seen_ids = set(exclude_ids)

        max_attempts = 4
        for attempt in range(max_attempts):
            if len(image_items) >= body.count:
                break

            attempt_page = page_start + attempt
            images_dir = os.path.join(tmp_root, f"images_{attempt}")
            graded_dir = os.path.join(tmp_root, f"graded_{attempt}")

            try:
                render_dir, _, _, _, _ = await asyncio.to_thread(
                    _stage_batch_sync,
                    search_terms=body.search_terms,
                    uploaded_image_paths=None,
                    width=w,
                    height=h,
                    need_total=need_total,
                    access_key=access_key,
                    pexels_key=pexels_key,
                    color_theme=body.color_theme,
                    custom_grade_params=None,
                    image_source=body.image_source,
                    images_dir=images_dir,
                    graded_dir=graded_dir,
                    page_start=attempt_page,
                )
            except Exception as e:
                logger.exception("Find more failed on page %s: %s", attempt_page, e)
                raise HTTPException(status_code=500, detail=f"Image fetch failed: {e}")

            render_path = Path(render_dir)
            fnames = sorted(f for f in os.listdir(render_dir) if Path(render_dir, f).is_file())
            added_this_attempt = 0

            for fname in fnames:
                if len(image_items) >= body.count:
                    break

                stem = Path(fname).stem
                if stem in seen_ids:
                    continue
                seen_ids.add(stem)

                fpath = render_path / fname
                try:
                    data = _preview_thumbnail(fpath)
                    storage_path = f"{user_id}/preview/{ts}_more_{attempt}_{fname}"
                    client.storage.from_("user-uploads").upload(
                        path=storage_path,
                        file=data,
                        file_options={"content-type": "image/jpeg", "upsert": "true"},
                    )
                    signed_url = await get_user_uploads_signed_url(storage_path)
                    image_items.append(PreviewImageItem(storage_path=storage_path, signed_url=signed_url))
                    added_this_attempt += 1
                except Exception as e:
                    logger.warning("Find more: failed to upload/sign %s: %s", fname, e)

            if added_this_attempt == 0:
                logger.info("Find more: page %d produced no new unique images", attempt_page)

        logger.info("Find more: %d images fetched for user %s", len(image_items), user_id)
        return PreviewFindMoreResponse(images=image_items)

    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


@router.post("/preview-refresh-philosopher", response_model=PreviewRefreshPhilosopherResponse)
async def preview_refresh_philosopher(
    body: PreviewRefreshPhilosopherRequest,
    user_id: str = Depends(get_current_user_id),
):
    w, h = (int(x) for x in body.resolution.lower().split("x"))
    items = await _stage_philosopher_preview_items(
        user_id=user_id,
        philosopher=body.philosopher,
        philosopher_count=1,
        philosopher_is_user=body.philosopher_is_user,
        grade_philosopher=body.grade_philosopher,
        color_theme=body.color_theme,
        custom_grade_params=None,
        width=w,
        height=h,
        storage_prefix=f"{int(time.time() * 1000)}_refresh_phil",
        exclude_source_keys=set(body.exclude_source_keys),
    )
    if not items:
        raise HTTPException(status_code=404, detail="No unused philosopher images are available for this batch.")
    return PreviewRefreshPhilosopherResponse(image=items[0])


@router.post("/preview-refresh-accent", response_model=PreviewRefreshAccentResponse)
async def preview_refresh_accent(
    body: PreviewRefreshAccentRequest,
    user_id: str = Depends(get_current_user_id),
):
    width, height = (int(x) for x in body.resolution.lower().split("x"))
    ts = int(time.time() * 1000)
    items = await _stage_accent_preview_items(
        user_id=user_id,
        accent_folder=body.accent_folder,
        accent_count=1,
        width=width,
        height=height,
        storage_prefix=f"{ts}_accent_refresh",
        exclude_source_keys=set(body.exclude_source_keys),
    )
    if not items:
        raise HTTPException(status_code=404, detail="No unused accent images are available for this batch.")
    return PreviewRefreshAccentResponse(image=items[0])
