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
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from db.supabase_client import get_client
from models.schemas import (
    PreviewStageRequest,
    PreviewStageResponse,
    PreviewBatchResult,
    PreviewImageItem,
    PreviewFindMoreRequest,
    PreviewFindMoreResponse,
)
from routers.auth import get_current_user_id
from services.image_pipeline import fetch_images, download_and_save, RateLimitError
from services.image_grader import apply_theme_grading
from services.storage import get_user_uploads_signed_url

logger = logging.getLogger(__name__)
router = APIRouter()


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
) -> tuple[str, bool]:
    """
    Synchronous worker that runs fetch → download → grade for a single batch.
    Returns (graded_dir_path, pexels_fallback_used).
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
    return render_dir, pexels_fallback


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
                render_dir, used_pexels = await asyncio.to_thread(
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
                )
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
                    with open(fpath, "rb") as f:
                        data = f.read()
                    storage_path = f"{user_id}/preview/{ts}_{batch_idx}_{fname}"
                    client.storage.from_("user-uploads").upload(
                        path=storage_path,
                        file=data,
                        file_options={"content-type": "image/jpeg", "upsert": "true"},
                    )
                    signed_url = await get_user_uploads_signed_url(storage_path)
                    image_items.append(PreviewImageItem(storage_path=storage_path, signed_url=signed_url))
                except Exception as e:
                    logger.warning("Preview: failed to upload/sign %s: %s", fname, e)

            batch_results.append(PreviewBatchResult(
                batch_title=batch.batch_title,
                search_terms=batch.search_terms,
                images=image_items,
            ))
            logger.info(
                "Preview batch %d staged: %d images for user %s",
                batch_idx, len(image_items), user_id,
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
    # e.g. existing_count=20 → page_start=1 (still on first page but exclude_photo_ids handles dups)
    # e.g. existing_count=30 → page_start=2 (fresh page of results)
    _per_page = 30
    page_start = max(2, 1 + body.existing_count // _per_page)
    # Fetch a buffer beyond count to absorb any remaining duplicates
    need_total = body.count + max(5, body.count // 2)

    tmp_root = tempfile.mkdtemp(prefix="find_more_")
    client = get_client()

    try:
        images_dir = os.path.join(tmp_root, "images")
        graded_dir = os.path.join(tmp_root, "graded")

        try:
            render_dir, _ = await asyncio.to_thread(
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
                page_start=page_start,
            )
        except Exception as e:
            logger.exception("Find more failed: %s", e)
            raise HTTPException(status_code=500, detail=f"Image fetch failed: {e}")

        # Remove any images whose photo ID is already in the current batch
        exclude_ids = set(body.exclude_photo_ids or [])
        if exclude_ids:
            for fname in os.listdir(render_dir):
                stem = Path(fname).stem  # fid without .jpg
                if stem in exclude_ids:
                    try:
                        os.remove(os.path.join(render_dir, fname))
                    except Exception:
                        pass

        image_items: list[PreviewImageItem] = []
        render_path = Path(render_dir)
        fnames = sorted(f for f in os.listdir(render_dir) if Path(render_dir, f).is_file())

        for fname in fnames[:body.count]:
            fpath = render_path / fname
            try:
                with open(fpath, "rb") as f:
                    data = f.read()
                storage_path = f"{user_id}/preview/{ts}_more_{fname}"
                client.storage.from_("user-uploads").upload(
                    path=storage_path,
                    file=data,
                    file_options={"content-type": "image/jpeg", "upsert": "true"},
                )
                signed_url = await get_user_uploads_signed_url(storage_path)
                image_items.append(PreviewImageItem(storage_path=storage_path, signed_url=signed_url))
            except Exception as e:
                logger.warning("Find more: failed to upload/sign %s: %s", fname, e)

        logger.info("Find more: %d images fetched for user %s", len(image_items), user_id)
        return PreviewFindMoreResponse(images=image_items)

    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)
