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

from db.supabase_client import get_client
from services.image_pipeline import fetch_images, download_and_save, RateLimitError
from services.image_grader import apply_theme_grading
from services.video_builder import render_slideshow, extract_thumbnail
from services.storage import upload_output, upload_thumbnail, get_signed_url, delete_file, list_accent_images, download_accent_image
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

    def to_dict(self) -> dict:
        d = {
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
        if self.custom_grade_params:
            d["custom_grade_params"] = self.custom_grade_params
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
        .single()
        .execute()
    )
    return result.data if result.data else None


async def list_jobs(user_id: str, db, limit: int = 10) -> List[dict]:
    """Return the last N jobs for a user."""
    result = (
        db.table("jobs")
        .select("id, status, progress_message, output_url, thumbnail_url, batch_title, config, created_at, completed_at")
        .eq("user_id", user_id)
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
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_copy_one, (i, path)): path for i, path in enumerate(paths)}
        for future in as_completed(futures):
            if future.result():
                saved += 1
    logger.info("Copied %d/%d uploaded images to %s", saved, len(paths), dest_dir)
    return saved


def _download_accent_images(folder: str, dest_dir: str, width: int, height: int, max_count: int) -> int:
    """
    Download a random subset of accent images from the accent bucket, resize/crop,
    and save as JPEG into dest_dir WITHOUT any colour grading.
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
            out_path = os.path.join(dest_dir, f"accent_{i:04d}.jpg")
            img.save(out_path, "JPEG", quality=90)
            saved += 1
        except Exception as e:
            logger.warning("Failed to download accent image %s: %s", path, e)
    logger.info("Saved %d/%d accent images from accent/%s", saved, len(selected), folder)
    return saved


async def run_pipeline(job_id: str, user_id: str, config: JobConfig, db) -> None:
    """
    Full short-form pipeline executed as a FastAPI BackgroundTask.

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

            # Fetch from Unsplash
            switched_to_pexels = False
            if source in ("unsplash", "both"):
                await update_job_status(job_id, user_id, "running", db, progress_message="Fetching images from Unsplash…")
                while True:
                    try:
                        unsplash_items = await asyncio.to_thread(
                            fetch_images,
                            queries=config.search_terms,
                            need_total=need_total,
                            tw=width,
                            th=height,
                            access_key=access_key,
                            color_theme=config.color_theme,
                            max_per_query=config.max_per_query,
                        )
                        items.extend(unsplash_items)
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

            # Fetch from Pexels
            if source in ("pexels", "both") or switched_to_pexels:
                if pexels_key:
                    from services.pexels_pipeline import fetch_images_pexels
                    await update_job_status(job_id, user_id, "running", db, progress_message="Fetching images from Pexels…")
                    pexels_items = await asyncio.to_thread(
                        fetch_images_pexels,
                        queries=config.search_terms,
                        need_total=need_total,
                        tw=width,
                        th=height,
                        access_key=pexels_key,
                        color_theme=config.color_theme,
                        max_per_query=config.max_per_query,
                    )
                    items.extend(pexels_items)
                else:
                    logger.warning("PEXELS_ACCESS_KEY not set — skipping Pexels fetch")

            if not items and not config.uploaded_image_paths:
                raise RuntimeError("No images returned for the given search terms.")

            if items:
                await update_job_status(job_id, user_id, "running", db, progress_message=f"Downloading 0/{len(items)} images…")
                progress_cb = _make_download_progress_cb(job_id, user_id)
                saved = await asyncio.to_thread(download_and_save, items, images_dir, width, height, 8, progress_cb)
                if saved == 0 and not config.uploaded_image_paths:
                    raise RuntimeError("No images could be downloaded.")

        # --- Step 2.5: Apply colour grading ---
        await update_job_status(job_id, user_id, "running", db, progress_message="Applying colour grade…")
        graded_dir = os.path.join(tmp_root, "graded")
        render_input = await asyncio.to_thread(apply_theme_grading, images_dir, graded_dir, config.color_theme, config.custom_grade_params)

        # --- Step 2.7: Inject accent images (ungraded, sprinkled into render pool) ---
        if config.accent_folder:
            await update_job_status(job_id, user_id, "running", db, progress_message="Adding accent images…")
            needed_frames = max(1, int(config.total_seconds / config.seconds_per_image))
            max_accent = max(1, needed_frames // 5)  # ~20% of frames
            await asyncio.to_thread(
                _download_accent_images,
                config.accent_folder,
                render_input,   # place directly into render dir — no grading applied
                width,
                height,
                max_accent,
            )

        # --- Step 3: Render video ---
        await update_job_status(job_id, user_id, "running", db, progress_message="Rendering video…")
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


async def _run_single_variant(
    job_id: str,
    user_id: str,
    config: JobConfig,
    theme: str,
    shared_images_dir: str,
    variant_tmp: str,
    db,
) -> None:
    """Apply grading + render + upload for one variant, reading from shared_images_dir."""
    width, height = config.parse_resolution()
    output_file = os.path.join(variant_tmp, "output.mp4")

    await update_job_status(job_id, user_id, "running", db, progress_message="Applying colour grade…")
    graded_dir = os.path.join(variant_tmp, "graded")
    render_input = await asyncio.to_thread(apply_theme_grading, shared_images_dir, graded_dir, theme)

    await update_job_status(job_id, user_id, "running", db, progress_message="Rendering video…")
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
    )
    if result["returncode"] != 0:
        logger.error("ffmpeg failed (rc=%d). Last 20 lines:\n%s",
                     result["returncode"], "\n".join(result["log"][-20:]))
        raise RuntimeError(f"ffmpeg failed (rc={result['returncode']}). Check server logs.")

    thumb_url = None
    thumb_file = os.path.join(variant_tmp, "thumb.jpg")
    try:
        thumb_ok = await asyncio.to_thread(extract_thumbnail, output_file, thumb_file, config.total_seconds)
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
    """
    access_key = os.environ.get("UNSPLASH_ACCESS_KEY", "")
    width, height = config.parse_resolution()

    tmp_root = tempfile.mkdtemp(prefix=f"variants_{user_id[:8]}_")
    shared_images_dir = os.path.join(tmp_root, "images")
    os.makedirs(shared_images_dir, exist_ok=True)

    try:
        for job_id in job_ids:
            await update_job_status(job_id, user_id, "running", db, progress_message="Fetching images…")

        need_total = max(1, int(config.total_seconds / config.seconds_per_image) + 10)
        while True:
            try:
                items = await asyncio.to_thread(
                    fetch_images,
                    queries=config.search_terms,
                    need_total=need_total,
                    tw=width,
                    th=height,
                    access_key=access_key,
                    color_theme="none",
                    max_per_query=config.max_per_query,
                )
                break
            except RateLimitError as e:
                for job_id in job_ids:
                    await update_job_status(job_id, user_id, "running", db,
                        progress_message=f"API limit reached — retrying in {e.wait}s… grab a cup of tea ☕")
                await asyncio.sleep(e.wait)
                for job_id in job_ids:
                    await update_job_status(job_id, user_id, "running", db,
                        progress_message="Fetching images…")
        if not items:
            raise RuntimeError("No images returned for the given search terms.")

        for job_id in job_ids:
            await update_job_status(job_id, user_id, "running", db, progress_message=f"Downloading {len(items)} images…")

        saved = await asyncio.to_thread(download_and_save, items, shared_images_dir, width, height)
        if saved == 0:
            raise RuntimeError("No images could be downloaded.")

        for job_id, theme in zip(job_ids, themes):
            variant_tmp = os.path.join(tmp_root, f"v_{job_id[:8]}")
            os.makedirs(variant_tmp, exist_ok=True)
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
                await _run_single_variant(job_id, user_id, variant_config, theme, shared_images_dir, variant_tmp, db)
            except Exception as exc:
                logger.exception("Variant job %s (theme=%s) failed: %s", job_id, theme, exc)
                await update_job_status(
                    job_id, user_id, "failed", db,
                    error_message=str(exc),
                    completed_at=datetime.now(timezone.utc).isoformat(),
                )

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
