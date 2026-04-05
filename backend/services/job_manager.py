"""
job_manager.py

Async job lifecycle management backed by Supabase Postgres.

Security considerations:
- Every DB query is scoped with .eq("user_id", user_id) — a user can never
  read, update, or cancel another user's job.
- job_id is a UUID generated server-side (gen_random_uuid()), never user-supplied.
- Temporary files are written to an OS temp dir scoped to job_id and deleted after upload.
- Usage counters are incremented via an atomic Postgres RPC to prevent race conditions.
- config JSONB is stored server-side; the client only receives job_id + status back.
"""

import asyncio
import logging
import os
import tempfile
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional

# Limit concurrent pipelines to avoid OOM on Railway's 512MB instance.
# Each pipeline peaks at ~150-200MB (downloads + grading + ffmpeg).
# At 512MB, base Python/FastAPI uses ~100-150MB leaving ~350MB headroom —
# only 1 pipeline fits safely. Raise to 2 if upgraded to a 1GB+ instance.
# Initialized lazily on first use so it binds to the running event loop.
_pipeline_semaphore: asyncio.Semaphore | None = None


def _get_semaphore() -> asyncio.Semaphore:
    global _pipeline_semaphore
    if _pipeline_semaphore is None:
        concurrency = int(os.environ.get("PIPELINE_CONCURRENCY", "1"))
        _pipeline_semaphore = asyncio.Semaphore(concurrency)
        logger.info("Pipeline semaphore initialised: max_concurrency=%d", concurrency)
    return _pipeline_semaphore

import queue as _q_mod
import threading as _threading

from db.supabase_client import get_client
from services.image_pipeline import fetch_images, download_and_save, download_from_queue, RateLimitError
from services.image_grader import apply_theme_grading
from services.video_builder import render_slideshow, extract_thumbnail
from services.storage import (
    upload_output, upload_thumbnail, get_signed_url, delete_file,
    list_accent_images, download_accent_image,
    upload_raw_images, download_raw_images_to_dir,
)
import shutil

logger = logging.getLogger(__name__)


@dataclass
class JobConfig:
    search_terms: List[str]
    resolution: str = "1080x1920"
    seconds_per_image: float = 0.13
    total_seconds: float = 11.0
    fps: int = 30
    allow_repeats: bool = True
    color_theme: str = "none"
    max_per_query: int = 3
    batch_title: Optional[str] = None
    uploaded_image_paths: Optional[List[str]] = None
    preset_name: Optional[str] = None
    uploaded_only: bool = False
    accent_folder: Optional[str] = None
    image_source: str = "unsplash"
    custom_grade_params: Optional[Dict] = None
    philosopher: Optional[str] = None
    philosopher_count: int = 3
    grade_philosopher: bool = False
    philosopher_is_user: bool = False
    text_overlay: Optional[Dict] = None
    ai_voiceover: Optional[Dict] = None
    layered_config: Optional[Dict] = None

    def to_dict(self) -> dict:
        d = {
            "mode": "layered" if self.layered_config else "images",
            "search_terms": self.search_terms,
            "resolution": self.resolution,
            "seconds_per_image": self.seconds_per_image,
            "total_seconds": self.total_seconds,
            "fps": self.fps,
            "allow_repeats": self.allow_repeats,
            "color_theme": self.color_theme,
            "max_per_query": self.max_per_query,
        }
        if self.preset_name:
            d["preset_name"] = self.preset_name
        d["image_source"] = self.image_source
        if self.accent_folder:
            d["accent_folder"] = self.accent_folder
        if self.custom_grade_params:
            d["custom_grade_params"] = self.custom_grade_params
        if self.philosopher:
            d["philosopher"] = self.philosopher
            d["philosopher_count"] = self.philosopher_count
            d["grade_philosopher"] = self.grade_philosopher
            d["philosopher_is_user"] = self.philosopher_is_user
        if self.text_overlay:
            d["text_overlay"] = self.text_overlay
        if self.ai_voiceover:
            d["ai_voiceover"] = self.ai_voiceover
        if self.layered_config:
            d["layered_config"] = self.layered_config
        return d

    def parse_resolution(self):
        w, h = self.resolution.lower().split("x")
        return int(w), int(h)


def _current_month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


async def create_job(user_id: str, config: JobConfig, db) -> str:
    """
    Insert a new job row and return the job_id.
    user_id is set server-side from the verified JWT — never from request body.
    """
    row = {
        "user_id": user_id,
        "status": "queued",
        "config": config.to_dict(),
        "progress_message": "Queued",
        "batch_title": config.batch_title,
    }
    result = db.table("jobs").insert(row).execute()
    job_id = result.data[0]["id"]
    logger.info("Created job %s for user %s", job_id, user_id)
    return job_id


def _make_download_progress_cb(job_id: str, user_id: str):
    """Returns a sync callback for live download progress (called from ThreadPoolExecutor)."""
    from db.supabase_client import get_client
    def cb(done: int, total: int):
        try:
            get_client().table("jobs").update({
                "progress_message": f"Downloading {done}/{total} images…"
            }).eq("id", job_id).eq("user_id", user_id).neq("status", "deleted").execute()
        except Exception as exc:
            logger.warning("Download progress update failed: %s", exc)
    return cb


async def update_job_status(job_id: str, user_id: str, status: str, db, **kwargs) -> None:
    """
    Update job row. Always scoped to (job_id, user_id) to prevent cross-user writes.
    kwargs may include: progress_message, output_url, error_message, completed_at.
    """
    payload = {"status": status, **kwargs}
    db.table("jobs").update(payload).eq("id", job_id).eq("user_id", user_id).neq("status", "deleted").execute()
    logger.info("Job %s → %s", job_id, status)


async def get_job(job_id: str, user_id: str, db) -> Optional[dict]:
    """Fetch a single job, enforcing user_id ownership."""
    result = (
        db.table("jobs")
        .select("id, user_id, status, progress_message, output_url, thumbnail_url, error_message, batch_title, config, created_at, completed_at")
        .eq("id", job_id)
        .eq("user_id", user_id)  # ownership gate
        .execute()
    )
    return result.data[0] if result.data else None


async def list_jobs(user_id: str, db, limit: int = 10) -> List[dict]:
    """Return the last N jobs for a user."""
    result = (
        db.table("jobs")
        .select("id, status, progress_message, output_url, thumbnail_url, batch_title, config, created_at, completed_at")
        .eq("user_id", user_id)
        .neq("status", "deleted")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return result.data or []


async def _increment_usage(user_id: str, db) -> None:
    """
    Atomically increment render_count for the current month.
    Uses Postgres upsert to avoid race conditions under concurrent requests.
    """
    month = _current_month()
    db.rpc(
        "increment_render_count",
        {"p_user_id": user_id, "p_month": month},
    ).execute()


def _copy_uploaded_images(paths: List[str], dest_dir: str, width: int, height: int) -> int:
    """
    Download user-uploaded images from Supabase Storage concurrently, resize, and save as JPEG.
    Returns the number of images successfully saved.
    """
    from db.supabase_client import get_client
    from PIL import Image
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import io

    client = get_client()
    os.makedirs(dest_dir, exist_ok=True)

    def _copy_one(idx_path):
        i, path = idx_path
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
            out_path = os.path.join(dest_dir, f"upload_{i:04d}.jpg")
            img.save(out_path, "JPEG", quality=90)
            return True
        except Exception as e:
            logger.warning("Failed to copy uploaded image %s: %s", path, e)
            return False

    saved = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(_copy_one, (i, path)): path for i, path in enumerate(paths)}
        for future in as_completed(futures):
            if future.result():
                saved += 1
    logger.info("Copied %d/%d uploaded images to %s", saved, len(paths), dest_dir)
    return saved


def _download_accent_images(folder: str, dest_dir: str, width: int, height: int, max_count: int, file_prefix: str = "accent") -> int:
    """
    Download a random subset of accent images from the accent bucket, resize/crop,
    and save as JPEG into dest_dir WITHOUT any colour grading.
    file_prefix avoids filename collisions when multiple accent passes write to the same dir.
    Returns the number of images saved.
    """
    import random
    import io
    from PIL import Image

    os.makedirs(dest_dir, exist_ok=True)
    paths = list_accent_images(folder)
    if not paths:
        logger.warning("No accent images found in accent/%s", folder)
        return 0

    random.shuffle(paths)
    if len(paths) >= max_count:
        selected = paths[:max_count]
    else:
        # Fewer accent images than needed — cycle to fill quota
        selected = (paths * ((max_count // len(paths)) + 1))[:max_count]
        random.shuffle(selected)
    saved = 0
    for i, path in enumerate(selected):
        try:
            data = download_accent_image(path)
            img = Image.open(io.BytesIO(data)).convert("RGB")
            iw, ih = img.size
            scale = max(width / iw, height / ih)
            new_w, new_h = int(iw * scale), int(ih * scale)
            img = img.resize((new_w, new_h), Image.LANCZOS)
            left = (new_w - width) // 2
            top = (new_h - height) // 2
            img = img.crop((left, top, left + width, top + height))
            out_path = os.path.join(dest_dir, f"{file_prefix}_{i:04d}.jpg")
            img.save(out_path, "JPEG", quality=90)
            saved += 1
        except Exception as e:
            logger.warning("Failed to download accent image %s: %s", path, e)
    logger.info("Saved %d/%d accent images from accent/%s", saved, len(selected), folder)
    return saved


def _download_user_philosopher_images(
    user_id: str,
    key: str,
    dest_dir: str,
    width: int,
    height: int,
    max_count: int,
    file_prefix: str = "phil",
) -> int:
    """Download user philosopher images from user-uploads bucket."""
    from services.storage import list_user_philosopher_images, download_user_philosopher_image
    from services.image_injector import resize_cover
    import random
    from pathlib import Path
    from io import BytesIO
    from PIL import Image

    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)

    paths = list_user_philosopher_images(user_id, key)
    if not paths:
        logger.warning("No user philosopher images found for %s/%s", user_id, key)
        return 0

    selected = random.sample(paths, min(max_count, len(paths)))
    saved = 0
    for idx, path in enumerate(selected, 1):
        try:
            data = download_user_philosopher_image(path)
            img = Image.open(BytesIO(data)).convert("RGB")
            img = resize_cover(img, width, height)
            out = dest / f"{file_prefix}_{idx:03d}.jpg"
            img.save(str(out), "JPEG", quality=92, optimize=True)
            saved += 1
        except Exception as e:
            logger.warning("Failed to download user philosopher image %s: %s", path, e)
    logger.info("Downloaded %d/%d user philosopher images", saved, len(selected))
    return saved


async def run_pipeline(job_id: str, user_id: str, config: JobConfig, db) -> None:
    """
    Full short-form pipeline executed as a FastAPI BackgroundTask.
    Acquires _pipeline_semaphore before executing to cap concurrent memory usage.

    Steps:
      1. fetch_images  — query Unsplash and/or Pexels
      2. download_and_save — write to temp dir
      3. render_slideshow  — ffmpeg produces MP4
      4. upload_output     — push to Supabase Storage
      5. get_signed_url    — generate 48hr download link
      6. update job row    — mark done + store URL
      7. increment_usage   — atomic usage counter bump

    Temp dir is always cleaned up in the finally block.
    """
    async with _get_semaphore():
        await _run_pipeline_inner(job_id, user_id, config, db)


async def _run_pipeline_inner(job_id: str, user_id: str, config: JobConfig, db) -> None:
    access_key = os.environ.get("UNSPLASH_ACCESS_KEY", "")
    pexels_key = os.environ.get("PEXELS_ACCESS_KEY", "")
    width, height = config.parse_resolution()

    # Isolated temp directory for this job only
    tmp_root = tempfile.mkdtemp(prefix=f"job_{job_id}_")
    images_dir = os.path.join(tmp_root, "images")
    os.makedirs(images_dir, exist_ok=True)
    output_file = os.path.join(tmp_root, "output.mp4")

    try:
        # --- Step 0: Copy uploaded images (if any) ---
        if config.uploaded_image_paths:
            await update_job_status(job_id, user_id, "running", db, progress_message="Loading uploaded images…")
            await asyncio.to_thread(
                _copy_uploaded_images,
                config.uploaded_image_paths,
                images_dir,
                width,
                height,
            )

        # --- Steps 1+2: Fetch + download images (skipped in uploaded_only mode) ---
        if not config.uploaded_only:
            source = getattr(config, 'image_source', 'unsplash')
            need_total = max(1, int(config.total_seconds / config.seconds_per_image) + 10)
            items: list = []
            all_preview_thumbs: list = []

            switched_to_pexels = False

            # ── Unsplash (concurrent fetch + download) ──────────────────────────
            if source in ("unsplash", "both"):
                q = _q_mod.Queue()
                total_found = [0]
                preview_thumbs: list = []

                def _on_unsplash_item(fid, url, thumb=""):
                    total_found[0] += 1
                    q.put((fid, url))
                    if len(preview_thumbs) < 8 and thumb:
                        preview_thumbs.append(thumb)

                def _do_unsplash_fetch():
                    try:
                        return fetch_images(
                            queries=config.search_terms,
                            need_total=need_total,
                            tw=width,
                            th=height,
                            access_key=access_key,
                            color_theme=config.color_theme,
                            max_per_query=config.max_per_query,
                            on_item_found=_on_unsplash_item,
                        )
                    finally:
                        q.put(None)

                await update_job_status(job_id, user_id, "running", db,
                    progress_message="Fetching images from Unsplash…")
                progress_cb = _make_download_progress_cb(job_id, user_id)
                while True:
                    try:
                        unsplash_items, _ = await asyncio.gather(
                            asyncio.to_thread(_do_unsplash_fetch),
                            asyncio.to_thread(download_from_queue, q, images_dir, width, height,
                                              total_found, 8, progress_cb),
                        )
                        items.extend(unsplash_items)
                        all_preview_thumbs.extend(preview_thumbs)
                        break
                    except RateLimitError as e:
                        if pexels_key and source == "unsplash":
                            logger.warning("Unsplash rate limited — auto-switching to Pexels")
                            await update_job_status(job_id, user_id, "running", db,
                                progress_message="Unsplash limit reached — switching to Pexels automatically 🔄")
                            switched_to_pexels = True
                            break
                        else:
                            await update_job_status(job_id, user_id, "running", db,
                                progress_message=f"API limit reached — retrying in {e.wait}s… grab a cup of tea ☕")
                            await asyncio.sleep(e.wait)
                            await update_job_status(job_id, user_id, "running", db,
                                progress_message="Fetching images from Unsplash…")
                            # reset queue and counters for retry
                            q = _q_mod.Queue()
                            total_found[0] = 0
                            preview_thumbs.clear()

            # ── Pexels (concurrent fetch + download) ────────────────────────────
            if source in ("pexels", "both") or switched_to_pexels:
                if pexels_key:
                    from services.pexels_pipeline import fetch_images_pexels
                    q2 = _q_mod.Queue()
                    total_found2 = [0]
                    preview_thumbs2: list = []

                    def _on_pexels_item(fid, url, thumb=""):
                        total_found2[0] += 1
                        q2.put((fid, url))
                        if len(preview_thumbs2) < 8 and thumb:
                            preview_thumbs2.append(thumb)

                    def _do_pexels_fetch():
                        try:
                            return fetch_images_pexels(
                                queries=config.search_terms,
                                need_total=need_total,
                                tw=width,
                                th=height,
                                access_key=pexels_key,
                                color_theme=config.color_theme,
                                max_per_query=config.max_per_query,
                                on_item_found=_on_pexels_item,
                            )
                        finally:
                            q2.put(None)

                    await update_job_status(job_id, user_id, "running", db,
                        progress_message="Fetching images from Pexels…")
                    progress_cb2 = _make_download_progress_cb(job_id, user_id)
                    while True:
                        try:
                            pexels_items, _ = await asyncio.gather(
                                asyncio.to_thread(_do_pexels_fetch),
                                asyncio.to_thread(download_from_queue, q2, images_dir, width, height,
                                                  total_found2, 8, progress_cb2),
                            )
                            items.extend(pexels_items)
                            all_preview_thumbs.extend(preview_thumbs2)
                            break
                        except RateLimitError as e:
                            await update_job_status(job_id, user_id, "running", db,
                                progress_message=f"API limit reached — retrying in {e.wait}s… grab a cup of tea ☕")
                            await asyncio.sleep(e.wait)
                            await update_job_status(job_id, user_id, "running", db,
                                progress_message="Fetching images from Pexels…")
                            q2 = _q_mod.Queue()
                            total_found2[0] = 0
                            preview_thumbs2.clear()
                else:
                    logger.warning("PEXELS_ACCESS_KEY not set — skipping Pexels fetch")

            if not items and not config.uploaded_image_paths:
                raise RuntimeError("No images returned for the given search terms.")

            # Store preview thumb URLs in job config for frontend display
            if all_preview_thumbs:
                try:
                    cfg_dict = config.to_dict()
                    cfg_dict["preview_images"] = all_preview_thumbs[:8]
                    db.table("jobs").update({"config": cfg_dict}).eq("id", job_id).eq("user_id", user_id).execute()
                except Exception as exc:
                    logger.warning("Failed to store preview_images: %s", exc)

        # --- Step 2.5: Apply colour grading ---
        await update_job_status(job_id, user_id, "running", db, progress_message="Applying colour grade…")
        graded_dir = os.path.join(tmp_root, "graded")
        render_input = await asyncio.to_thread(apply_theme_grading, images_dir, graded_dir, config.color_theme, config.custom_grade_params)

        # --- Step 2.7: Inject accent images (ungraded, sprinkled into render pool) ---
        needed_frames = max(1, int(config.total_seconds / config.seconds_per_image))
        if config.accent_folder:
            await update_job_status(job_id, user_id, "running", db, progress_message="Adding accent images…")
            max_accent = max(1, needed_frames // 5)  # ~20% of frames
            await asyncio.to_thread(
                _download_accent_images,
                config.accent_folder,
                render_input,   # place directly into render dir — no grading applied
                width,
                height,
                max_accent,
                "accent",
            )

        # --- Step 2.8: Inject philosopher images (optionally graded) ---
        if config.philosopher:
            await update_job_status(job_id, user_id, "running", db, progress_message="Adding philosopher images…")
            max_phil = config.philosopher_count
            phil_staging = os.path.join(tmp_root, "phil_staging")
            if config.philosopher_is_user:
                await asyncio.to_thread(
                    _download_user_philosopher_images,
                    user_id,
                    config.philosopher,
                    phil_staging,
                    width,
                    height,
                    max_phil,
                    "phil",
                )
            else:
                await asyncio.to_thread(
                    _download_accent_images,
                    f"philosopher/{config.philosopher}",
                    phil_staging,
                    width,
                    height,
                    max_phil,
                    "phil",
                )
            if config.grade_philosopher and config.color_theme != "none":
                phil_graded = os.path.join(tmp_root, "phil_graded")
                graded_phil_dir = await asyncio.to_thread(
                    apply_theme_grading, phil_staging, phil_graded, config.color_theme, config.custom_grade_params
                )
                for fname in os.listdir(graded_phil_dir):
                    src = os.path.join(graded_phil_dir, fname)
                    if os.path.isfile(src):
                        shutil.copy2(src, os.path.join(render_input, fname))
            else:
                for fname in os.listdir(phil_staging):
                    src = os.path.join(phil_staging, fname)
                    if os.path.isfile(src):
                        shutil.copy2(src, os.path.join(render_input, fname))

        # --- Step 3: Render video ---
        await update_job_status(job_id, user_id, "running", db, progress_message="Rendering video…")
        lc = config.layered_config
        if lc:
            from services.layered_builder import render_layered_sync
            result = await asyncio.to_thread(
                render_layered_sync,
                input_folder=render_input,
                output_file=output_file,
                bg_urls=lc["background_video_urls"],
                opacity=lc.get("foreground_opacity", 0.55),
                bg_opacity=lc.get("background_opacity", 1.0),
                fg_speed=lc.get("foreground_speed", 0.25),
                color_theme=config.color_theme,
                custom_grade_params=config.custom_grade_params,
                grade_target=lc.get("grade_target", "both"),
                crossfade_dur=lc.get("crossfade_duration", 0.5),
                width=width,
                height=height,
                fps=config.fps,
                total_seconds=config.total_seconds,
                allow_repeats=config.allow_repeats,
                text_overlay=config.text_overlay,
            )
        else:
            result = await asyncio.to_thread(
                render_slideshow,
                input_folder=render_input,
                output_file=output_file,
                width=width,
                height=height,
                seconds_per_image=config.seconds_per_image,
                fps=config.fps,
                total_seconds=config.total_seconds,
                allow_repeats=config.allow_repeats,
                shuffle=True,
                text_overlay=config.text_overlay,
            )
        if result["returncode"] != 0:
            logger.error("ffmpeg failed (rc=%d). Last 20 lines:\n%s",
                         result["returncode"], "\n".join(result["log"][-20:]))
            raise RuntimeError(f"ffmpeg failed (rc={result['returncode']}). Check server logs.")

        # --- Step 3.5: Extract thumbnail ---
        thumb_url = None
        thumb_file = os.path.join(tmp_root, "thumb.jpg")
        try:
            thumb_ok = await asyncio.to_thread(extract_thumbnail, output_file, thumb_file, config.total_seconds)
            if thumb_ok:
                thumb_path = await upload_thumbnail(thumb_file, user_id, job_id)
                thumb_url = await get_signed_url(thumb_path, expiry_seconds=172800)
        except Exception as e:
            logger.warning("Thumbnail failed (non-fatal): %s", e)

        # --- Step 4 & 5: Upload + signed URL ---
        await update_job_status(job_id, user_id, "running", db, progress_message="Uploading output…")
        storage_path = await upload_output(output_file, user_id, job_id)
        signed_url = await get_signed_url(storage_path)

        # --- Step 6: Mark done ---
        await update_job_status(
            job_id, user_id, "done", db,
            output_url=signed_url,
            thumbnail_url=thumb_url,
            progress_message="Done",
            completed_at=datetime.now(timezone.utc).isoformat(),
        )

        # --- Step 7: Increment usage ---
        await _increment_usage(user_id, db)

        # --- Step 8: Cache raw images for post-render re-grading ---
        # Uploaded after usage increment so a failure here doesn't affect billing.
        # images_dir contains the ungraded originals (already resized to target resolution).
        # Skipped for uploaded_only jobs (no Unsplash/Pexels images to cache).
        if not config.uploaded_only:
            try:
                await asyncio.to_thread(upload_raw_images, images_dir, user_id, job_id)
                # Mark images as cached in job config so the frontend can show Re-grade
                job_row = db.table("jobs").select("config").eq("id", job_id).eq("user_id", user_id).execute()
                if job_row.data:
                    cfg = job_row.data[0].get("config") or {}
                    cfg["images_cached"] = True
                    db.table("jobs").update({"config": cfg}).eq("id", job_id).eq("user_id", user_id).execute()
            except Exception as exc:
                logger.warning("Raw image cache failed (non-fatal) for job %s: %s", job_id, exc)

        logger.info("Pipeline complete for job %s", job_id)

    except Exception as exc:
        logger.exception("Pipeline failed for job %s: %s", job_id, exc)
        await update_job_status(
            job_id, user_id, "failed", db,
            error_message=str(exc),
            completed_at=datetime.now(timezone.utc).isoformat(),
        )

    finally:
        try:
            shutil.rmtree(tmp_root, ignore_errors=True)
            logger.debug("Cleaned up temp dir: %s", tmp_root)
        except Exception:
            pass


async def run_variants_pipeline(
    job_ids: List[str],
    themes: List[str],
    user_id: str,
    config: JobConfig,
    db,
) -> None:
    """
    Fetch images once from Unsplash, then render all theme variants from the same
    source images. job_ids and themes are parallel lists.
    Acquires _pipeline_semaphore to cap concurrent memory usage.
    """
    async with _get_semaphore():
        await _run_variants_pipeline_inner(job_ids, themes, user_id, config, db)


async def _run_variants_pipeline_inner(
    job_ids: List[str],
    themes: List[str],
    user_id: str,
    config: JobConfig,
    db,
) -> None:
    access_key = os.environ.get("UNSPLASH_ACCESS_KEY", "")
    width, height = config.parse_resolution()

    tmp_root = tempfile.mkdtemp(prefix=f"variants_{user_id[:8]}_")
    shared_images_dir = os.path.join(tmp_root, "images")
    os.makedirs(shared_images_dir, exist_ok=True)

    try:
        # Fetch images once, download concurrently
        pexels_key = os.environ.get("PEXELS_ACCESS_KEY", "")
        need_total = max(1, int(config.total_seconds / config.seconds_per_image) + 10)

        q = _q_mod.Queue()
        total_found = [0]

        def _on_item(fid, url, thumb=""):
            total_found[0] += 1
            q.put((fid, url))

        def _do_fetch():
            try:
                return fetch_images(
                    queries=config.search_terms,
                    need_total=need_total,
                    tw=width,
                    th=height,
                    access_key=access_key,
                    color_theme="none",
                    max_per_query=config.max_per_query,
                    on_item_found=_on_item,
                )
            finally:
                q.put(None)

        for jid in job_ids:
            await update_job_status(jid, user_id, "running", db, progress_message="Fetching images…")

        while True:
            try:
                items, _ = await asyncio.gather(
                    asyncio.to_thread(_do_fetch),
                    asyncio.to_thread(download_from_queue, q, shared_images_dir, width, height, total_found, 8),
                )
                break
            except RateLimitError as e:
                for jid in job_ids:
                    await update_job_status(jid, user_id, "running", db,
                        progress_message=f"API limit reached — retrying in {e.wait}s… grab a cup of tea ☕")
                await asyncio.sleep(e.wait)
                for jid in job_ids:
                    await update_job_status(jid, user_id, "running", db, progress_message="Fetching images…")
                # reset for retry
                q = _q_mod.Queue()
                total_found[0] = 0

        if not items:
            raise RuntimeError("No images returned for the given search terms.")

        # --- Phase A+B: Grade → render → upload → cleanup, one variant at a time ---
        # Previously grading ran in parallel (asyncio.gather) which duplicated all images
        # N times simultaneously and caused OOM. Now fully sequential: only one variant's
        # graded images exist on disk at any point.
        for job_id, theme in zip(job_ids, themes):
            variant_tmp = os.path.join(tmp_root, f"v_{job_id[:8]}")
            os.makedirs(variant_tmp, exist_ok=True)
            graded_dir = os.path.join(variant_tmp, "graded")
            output_file = os.path.join(variant_tmp, "output.mp4")
            variant_config = JobConfig(
                search_terms=config.search_terms,
                resolution=config.resolution,
                seconds_per_image=config.seconds_per_image,
                total_seconds=config.total_seconds,
                fps=config.fps,
                allow_repeats=config.allow_repeats,
                color_theme=theme,
                max_per_query=config.max_per_query,
                batch_title=config.batch_title,
            )

            try:
                await update_job_status(job_id, user_id, "running", db, progress_message="Applying colour grade…")
                render_input = await asyncio.to_thread(apply_theme_grading, shared_images_dir, graded_dir, theme)

                await update_job_status(job_id, user_id, "running", db, progress_message="Rendering video…")
                result = await asyncio.to_thread(
                    render_slideshow,
                    input_folder=render_input,
                    output_file=output_file,
                    width=width,
                    height=height,
                    seconds_per_image=variant_config.seconds_per_image,
                    fps=variant_config.fps,
                    total_seconds=variant_config.total_seconds,
                    allow_repeats=variant_config.allow_repeats,
                    shuffle=True,
                    text_overlay=config.text_overlay,
                )
                if result["returncode"] != 0:
                    logger.error("ffmpeg failed (rc=%d). Last 20 lines:\n%s",
                                 result["returncode"], "\n".join(result["log"][-20:]))
                    raise RuntimeError(f"ffmpeg failed (rc={result['returncode']}). Check server logs.")

                thumb_url = None
                thumb_file = os.path.join(variant_tmp, "thumb.jpg")
                try:
                    thumb_ok = await asyncio.to_thread(extract_thumbnail, output_file, thumb_file, variant_config.total_seconds)
                    if thumb_ok:
                        thumb_path = await upload_thumbnail(thumb_file, user_id, job_id)
                        thumb_url = await get_signed_url(thumb_path, expiry_seconds=172800)
                except Exception as e:
                    logger.warning("Thumbnail failed (non-fatal): %s", e)

                await update_job_status(job_id, user_id, "running", db, progress_message="Uploading output…")
                storage_path = await upload_output(output_file, user_id, job_id)
                signed_url = await get_signed_url(storage_path)

                await update_job_status(
                    job_id, user_id, "done", db,
                    output_url=signed_url,
                    thumbnail_url=thumb_url,
                    progress_message="Done",
                    completed_at=datetime.now(timezone.utc).isoformat(),
                )
                await _increment_usage(user_id, db)
                logger.info("Variant job %s (theme=%s) complete", job_id, theme)

            except Exception as exc:
                logger.exception("Variant job %s (theme=%s) failed: %s", job_id, theme, exc)
                await update_job_status(
                    job_id, user_id, "failed", db,
                    error_message=str(exc),
                    completed_at=datetime.now(timezone.utc).isoformat(),
                )

            finally:
                # Clean up this variant's temp files immediately to free memory/disk
                # before the next variant starts grading.
                shutil.rmtree(variant_tmp, ignore_errors=True)

    except Exception as exc:
        logger.exception("Variants pipeline setup failed: %s", exc)
        for job_id in job_ids:
            await update_job_status(
                job_id, user_id, "failed", db,
                error_message=str(exc),
                completed_at=datetime.now(timezone.utc).isoformat(),
            )
    finally:
        try:
            shutil.rmtree(tmp_root, ignore_errors=True)
            logger.debug("Cleaned up variants temp dir: %s", tmp_root)
        except Exception:
            pass


async def run_regrade_pipeline(
    source_job_id: str,
    new_job_id: str,
    user_id: str,
    color_theme: str,
    seconds_per_image: float,
    total_seconds: float,
    original_config: dict,
    db,
    selected_paths: list | None = None,
    custom_grade_params_override: dict | None = None,
    accent_folder_override: str | None = None,
    layered_config_override: dict | None = None,
) -> None:
    """
    Re-grade cached raw images from source_job_id with a new colour theme and/or pacing,
    producing a new completed job at new_job_id.

    No Unsplash/Pexels fetch — uses the images stored at outputs/raw/{user_id}/{source_job_id}/.
    Acquires _pipeline_semaphore to cap concurrent memory usage.
    """
    async with _get_semaphore():
        await _run_regrade_pipeline_inner(
            source_job_id, new_job_id, user_id, color_theme,
            seconds_per_image, total_seconds, original_config, db,
            selected_paths=selected_paths,
            custom_grade_params_override=custom_grade_params_override,
            layered_config_override=layered_config_override,
        )


async def _run_regrade_pipeline_inner(
    source_job_id: str,
    new_job_id: str,
    user_id: str,
    color_theme: str,
    seconds_per_image: float,
    total_seconds: float,
    original_config: dict,
    db,
    selected_paths: list | None = None,
    custom_grade_params_override: dict | None = None,
    layered_config_override: dict | None = None,
) -> None:
    resolution = original_config.get("resolution", "1080x1920")
    w, h = resolution.lower().split("x")
    width, height = int(w), int(h)
    fps = int(original_config.get("fps", 30))
    allow_repeats = bool(original_config.get("allow_repeats", True))
    text_overlay = original_config.get("text_overlay")
    preset_name = original_config.get("preset_name")
    accent_folder = accent_folder_override
    philosopher = original_config.get("philosopher")
    philosopher_count = int(original_config.get("philosopher_count", 3))
    grade_philosopher = bool(original_config.get("grade_philosopher", False))
    philosopher_is_user = bool(original_config.get("philosopher_is_user", False))
    custom_grade_params = custom_grade_params_override or original_config.get("custom_grade_params")
    batch_title = original_config.get("batch_title") or original_config.get("batch_title")
    layered_config = layered_config_override or original_config.get("layered_config")

    tmp_root = tempfile.mkdtemp(prefix=f"regrade_{new_job_id[:8]}_")
    raw_dir = os.path.join(tmp_root, "raw")
    graded_dir = os.path.join(tmp_root, "graded")
    output_file = os.path.join(tmp_root, "output.mp4")

    try:
        # --- Step 1: Download cached raw images ---
        await update_job_status(new_job_id, user_id, "running", db,
            progress_message="Loading cached images…")
        count = await asyncio.to_thread(
            download_raw_images_to_dir, user_id, source_job_id, raw_dir
        )
        if count == 0:
            raise RuntimeError("No cached images found for this job. Re-grade is unavailable.")

        # If caller specified a subset of images, remove unselected cached images
        # and download any extra images that came from user-uploads (find-more / staged)
        if selected_paths:
            selected_fnames = {os.path.basename(p) for p in selected_paths}
            # Remove cached images the user deselected
            for fname in os.listdir(raw_dir):
                if fname not in selected_fnames:
                    os.remove(os.path.join(raw_dir, fname))

            # Download extra images from user-uploads bucket (e.g. find-more / staged previews).
            # Raw-cache paths start with "raw/"; anything else is a user-uploads path.
            extra_paths = [p for p in selected_paths if not p.startswith("raw/")]
            if extra_paths:
                def _download_extras(paths: list[str]) -> None:
                    from db.supabase_client import get_client as _get_client
                    _client = _get_client()
                    for path in paths:
                        try:
                            data = _client.storage.from_("user-uploads").download(path)
                            fname = os.path.basename(path)
                            dest = os.path.join(raw_dir, fname)
                            # Avoid overwriting an existing cached image with the same filename
                            if os.path.exists(dest):
                                base, ext = os.path.splitext(fname)
                                fname = f"{base}_new{ext}"
                                dest = os.path.join(raw_dir, fname)
                            with open(dest, "wb") as f:
                                f.write(data)
                        except Exception as exc:
                            logger.warning("Regrade: could not download extra image %s: %s", path, exc)
                await asyncio.to_thread(_download_extras, extra_paths)

        # Verify we still have at least one image after filtering/downloading
        remaining = [f for f in os.listdir(raw_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))]
        if not remaining:
            raise RuntimeError("No images remain after selection — please select at least one image.")

        # Cache images under the new job's ID so it can itself be re-edited
        try:
            await asyncio.to_thread(upload_raw_images, raw_dir, user_id, new_job_id)
        except Exception as exc:
            logger.warning("Regrade image cache failed (non-fatal) for job %s: %s", new_job_id, exc)

        # --- Step 2: Apply colour grading ---
        await update_job_status(new_job_id, user_id, "running", db,
            progress_message="Applying colour grade…")
        should_grade_foreground = not layered_config or layered_config.get("grade_target", "both") in ("foreground", "both")
        if should_grade_foreground:
            render_input = await asyncio.to_thread(
                apply_theme_grading, raw_dir, graded_dir, color_theme, custom_grade_params
            )
        else:
            render_input = raw_dir

        needed_frames = max(1, int(total_seconds / seconds_per_image))
        if accent_folder:
            await update_job_status(new_job_id, user_id, "running", db,
                progress_message="Adding accent images…")
            max_accent = max(1, needed_frames // 5)
            await asyncio.to_thread(
                _download_accent_images,
                accent_folder,
                render_input,
                width,
                height,
                max_accent,
                "accent",
            )

        if philosopher:
            await update_job_status(new_job_id, user_id, "running", db,
                progress_message="Adding philosopher images…")
            max_phil = philosopher_count
            phil_staging = os.path.join(tmp_root, "phil_staging")
            if philosopher_is_user:
                await asyncio.to_thread(
                    _download_user_philosopher_images,
                    user_id,
                    philosopher,
                    phil_staging,
                    width,
                    height,
                    max_phil,
                    "phil",
                )
            else:
                await asyncio.to_thread(
                    _download_accent_images,
                    f"philosopher/{philosopher}",
                    phil_staging,
                    width,
                    height,
                    max_phil,
                    "phil",
                )
            if grade_philosopher and color_theme != "none":
                phil_graded = os.path.join(tmp_root, "phil_graded")
                graded_phil_dir = await asyncio.to_thread(
                    apply_theme_grading, phil_staging, phil_graded, color_theme, custom_grade_params
                )
                for fname in os.listdir(graded_phil_dir):
                    src = os.path.join(graded_phil_dir, fname)
                    if os.path.isfile(src):
                        shutil.copy2(src, os.path.join(render_input, fname))
            else:
                for fname in os.listdir(phil_staging):
                    src = os.path.join(phil_staging, fname)
                    if os.path.isfile(src):
                        shutil.copy2(src, os.path.join(render_input, fname))

        # --- Step 3: Render video ---
        await update_job_status(new_job_id, user_id, "running", db,
            progress_message="Rendering video…")
        if layered_config:
            from services.layered_builder import render_layered_sync
            layered_config = dict(layered_config)
            layered_config["foreground_speed"] = seconds_per_image
            result = await asyncio.to_thread(
                render_layered_sync,
                input_folder=render_input,
                output_file=output_file,
                bg_urls=layered_config["background_video_urls"],
                opacity=layered_config.get("foreground_opacity", 0.55),
                bg_opacity=layered_config.get("background_opacity", 1.0),
                fg_speed=seconds_per_image,
                color_theme=color_theme,
                custom_grade_params=custom_grade_params,
                grade_target=layered_config.get("grade_target", "both"),
                crossfade_dur=layered_config.get("crossfade_duration", 0.5),
                width=width,
                height=height,
                fps=fps,
                total_seconds=total_seconds,
                allow_repeats=allow_repeats,
                text_overlay=text_overlay,
            )
        else:
            result = await asyncio.to_thread(
                render_slideshow,
                input_folder=render_input,
                output_file=output_file,
                width=width,
                height=height,
                seconds_per_image=seconds_per_image,
                fps=fps,
                total_seconds=total_seconds,
                allow_repeats=allow_repeats,
                shuffle=True,
                text_overlay=text_overlay,
            )
        if result["returncode"] != 0:
            logger.error("ffmpeg regrade failed (rc=%d). Last 20 lines:\n%s",
                         result["returncode"], "\n".join(result["log"][-20:]))
            raise RuntimeError(f"ffmpeg failed (rc={result['returncode']}). Check server logs.")

        # --- Step 3.5: Extract thumbnail ---
        thumb_url = None
        thumb_file = os.path.join(tmp_root, "thumb.jpg")
        try:
            thumb_ok = await asyncio.to_thread(extract_thumbnail, output_file, thumb_file, total_seconds)
            if thumb_ok:
                thumb_path = await upload_thumbnail(thumb_file, user_id, new_job_id)
                thumb_url = await get_signed_url(thumb_path, expiry_seconds=172800)
        except Exception as exc:
            logger.warning("Regrade thumbnail failed (non-fatal): %s", exc)

        # --- Step 4+5: Upload + signed URL ---
        await update_job_status(new_job_id, user_id, "running", db,
            progress_message="Uploading output…")
        storage_path = await upload_output(output_file, user_id, new_job_id)
        signed_url = await get_signed_url(storage_path)

        # Build config for new job row
        new_config = dict(original_config)
        new_config["color_theme"] = color_theme
        new_config["seconds_per_image"] = seconds_per_image
        new_config["total_seconds"] = total_seconds
        new_config["images_cached"] = True
        new_config["custom_grade_params"] = custom_grade_params
        if layered_config:
            layered_config["foreground_speed"] = seconds_per_image
            new_config["layered_config"] = layered_config
        if preset_name:
            new_config["preset_name"] = preset_name

        # --- Step 6: Mark done ---
        await update_job_status(
            new_job_id, user_id, "done", db,
            output_url=signed_url,
            thumbnail_url=thumb_url,
            progress_message="Done",
            completed_at=datetime.now(timezone.utc).isoformat(),
        )
        db.table("jobs").update({"config": new_config}).eq("id", new_job_id).eq("user_id", user_id).execute()

        # --- Step 7: Increment usage ---
        await _increment_usage(user_id, db)
        logger.info("Regrade pipeline complete: source=%s new=%s theme=%s", source_job_id, new_job_id, color_theme)

    except Exception as exc:
        logger.exception("Regrade pipeline failed for job %s: %s", new_job_id, exc)
        await update_job_status(
            new_job_id, user_id, "failed", db,
            error_message=str(exc),
            completed_at=datetime.now(timezone.utc).isoformat(),
        )
    finally:
        try:
            shutil.rmtree(tmp_root, ignore_errors=True)
        except Exception:
            pass
