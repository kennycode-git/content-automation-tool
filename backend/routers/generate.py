"""
generate.py

POST /api/generate — create a new video generation job.

Security / data-protection flow:
1. JWT verified by get_current_user_id() dependency (401 if invalid/expired).
2. Subscription gate: user must have an active subscription row (403 otherwise).
3. Usage gate: monthly render_count must be below the plan limit (429 otherwise).
4. Input validated by Pydantic GenerateRequest (400 on bad data).
5. Job row inserted with server-derived user_id (never from request body).
6. Pipeline dispatched as BackgroundTask — response returns immediately with job_id.
"""

import asyncio
import logging
import os
import shutil
import tempfile
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field, field_validator

from db.supabase_client import get_client
from models.schemas import GenerateRequest, GenerateResponse, ALLOWED_RESOLUTIONS, ALLOWED_COLOR_THEMES
from routers.auth import get_current_user_id
from services.image_pipeline import fetch_images, download_and_save
from services.job_manager import JobConfig, create_job, run_pipeline, run_variants_pipeline
from services.storage import upload_user_image

logger = logging.getLogger(__name__)
router = APIRouter()

# Set to False when Stripe is live and you want to enforce subscriptions.
TRIAL_MODE = True

PLAN_LIMITS: dict = {
    "trial": 100,
    "creator": 100,
    "pro": None,  # unlimited
}


def _current_month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _trial_expired(sub: dict) -> bool:
    """Returns True if the trial_expires_at timestamp has passed."""
    expires_raw = sub.get("trial_expires_at")
    if not expires_raw:
        return False
    try:
        expires = datetime.fromisoformat(expires_raw.replace("Z", "+00:00"))
        return datetime.now(timezone.utc) > expires
    except Exception:
        return False


@router.post("/generate", response_model=GenerateResponse, status_code=202)
async def generate(
    body: GenerateRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    db = get_client()

    if not TRIAL_MODE:
        # --- Subscription gate ---
        sub_result = (
            db.table("subscriptions")
            .select("status, plan, trial_expires_at")
            .eq("user_id", user_id)
            .execute()
        )
        sub = sub_result.data[0] if sub_result.data else None
        if not sub or sub.get("status") != "active":
            raise HTTPException(status_code=403, detail="No active subscription.")

        # --- Trial expiry check ---
        plan = sub.get("plan", "creator")
        if plan == "trial" and _trial_expired(sub):
            raise HTTPException(
                status_code=403,
                detail={"code": "trial_expired", "message": "Your 21-day trial has ended. Upgrade to continue generating."},
            )

        # --- Usage gate ---
        limit = PLAN_LIMITS.get(plan)
        if limit is not None:
            usage_result = (
                db.table("usage")
                .select("render_count")
                .eq("user_id", user_id)
                .eq("month", _current_month())
                .execute()
            )
            count = usage_result.data[0]["render_count"] if usage_result.data else 0
            if count >= limit:
                raise HTTPException(
                    status_code=429,
                    detail=f"Monthly render limit of {limit} reached. Upgrade to Pro for unlimited renders.",
                )

    # --- Create job ---
    config = JobConfig(
        search_terms=body.search_terms,
        resolution=body.resolution,
        seconds_per_image=body.seconds_per_image,
        total_seconds=body.total_seconds,
        fps=body.fps,
        allow_repeats=body.allow_repeats,
        color_theme=body.color_theme,
        max_per_query=body.max_per_query,
        batch_title=body.batch_title,
        uploaded_image_paths=body.uploaded_image_paths or None,
        preset_name=body.preset_name,
        uploaded_only=body.uploaded_only,
        accent_folder=body.accent_folder or None,
        image_source=body.image_source,
        custom_grade_params=body.custom_grade_params.model_dump() if body.custom_grade_params else None,
        philosopher=body.philosopher or None,
        grade_philosopher=body.grade_philosopher,
        text_overlay=body.text_overlay.model_dump() if body.text_overlay else None,
    )
    job_id = await create_job(user_id, config, db)

    # --- Dispatch pipeline as background task ---
    background_tasks.add_task(run_pipeline, job_id, user_id, config, db)

    logger.info("Job %s queued for user %s", job_id, user_id)
    return GenerateResponse(job_id=job_id)


ALLOWED_IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_IMAGE_COUNT = 20


@router.post("/upload-images")
async def upload_images(
    files: List[UploadFile] = File(...),
    user_id: str = Depends(get_current_user_id),
):
    """
    Upload up to 20 images (JPEG/PNG/WebP, max 10 MB each) to user-uploads bucket.
    Returns storage paths to be passed to /api/generate as uploaded_image_paths.
    """
    if len(files) > MAX_IMAGE_COUNT:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_IMAGE_COUNT} files per upload.")

    paths = []
    for f in files:
        if f.content_type not in ALLOWED_IMAGE_MIMES:
            raise HTTPException(status_code=400, detail=f"File '{f.filename}' must be JPEG, PNG, or WebP.")
        data = await f.read()
        if len(data) > MAX_IMAGE_SIZE:
            raise HTTPException(status_code=400, detail=f"File '{f.filename}' exceeds 10 MB limit.")
        path = await upload_user_image(data, user_id, f.filename or "image.jpg")
        paths.append(path)

    logger.info("Uploaded %d images for user %s", len(paths), user_id)
    return {"paths": paths}


THEME_LABELS: dict = {
    "none": "Natural", "dark": "Dark Tones", "warm": "Amber", "sepia": "Sepia",
    "low_exp": "Low Exposure", "grey": "Silver", "blue": "Cobalt",
    "red": "Crimson", "bw": "Monochrome",
}


class VariantsRequest(BaseModel):
    search_terms: List[str] = Field(..., min_length=1, max_length=20)
    resolution: str = Field(default="1080x1920")
    seconds_per_image: float = Field(default=0.3, ge=0.05, le=5.0)
    total_seconds: float = Field(default=3.0, ge=1.0, le=120.0)
    fps: int = Field(default=30, ge=15, le=60)
    allow_repeats: bool = True
    max_per_query: int = Field(default=3, ge=1, le=30)
    batch_title: str | None = Field(default=None, max_length=120)
    themes: List[str] = Field(..., min_length=1, max_length=9)

    @field_validator("themes")
    @classmethod
    def validate_themes(cls, v: List[str]) -> List[str]:
        for t in v:
            if t not in ALLOWED_COLOR_THEMES:
                raise ValueError(f"Invalid theme: {t}")
        return v


@router.post("/variants", status_code=202)
async def generate_variants(
    body: VariantsRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    db = get_client()

    if not TRIAL_MODE:
        # --- Subscription gate ---
        sub_result = (
            db.table("subscriptions").select("status, plan, trial_expires_at")
            .eq("user_id", user_id).execute()
        )
        sub = sub_result.data[0] if sub_result.data else None
        if not sub or sub.get("status") != "active":
            raise HTTPException(status_code=403, detail="No active subscription.")

        # --- Trial expiry check ---
        plan = sub.get("plan", "creator")
        if plan == "trial" and _trial_expired(sub):
            raise HTTPException(
                status_code=403,
                detail={"code": "trial_expired", "message": "Your 21-day trial has ended. Upgrade to continue generating."},
            )

        # --- Usage gate (check enough renders remain for all variants) ---
        limit = PLAN_LIMITS.get(plan)
        if limit is not None:
            usage_result = (
                db.table("usage").select("render_count")
                .eq("user_id", user_id).eq("month", _current_month())
                .execute()
            )
            count = usage_result.data[0]["render_count"] if usage_result.data else 0
            if count + len(body.themes) > limit:
                raise HTTPException(
                    status_code=429,
                    detail=f"Not enough renders remaining ({limit - count} left, {len(body.themes)} needed). Upgrade to Pro for unlimited renders.",
                )

    # --- Create one job row per theme ---
    job_ids: List[str] = []
    for theme in body.themes:
        theme_label = THEME_LABELS.get(theme, theme)
        title = f"{body.batch_title} · {theme_label}" if body.batch_title else theme_label
        config = JobConfig(
            search_terms=body.search_terms,
            resolution=body.resolution,
            seconds_per_image=body.seconds_per_image,
            total_seconds=body.total_seconds,
            fps=body.fps,
            allow_repeats=body.allow_repeats,
            color_theme=theme,
            max_per_query=body.max_per_query,
            batch_title=title,
        )
        job_id = await create_job(user_id, config, db)
        job_ids.append(job_id)

    # --- Dispatch single background task that shares the image fetch ---
    base_config = JobConfig(
        search_terms=body.search_terms,
        resolution=body.resolution,
        seconds_per_image=body.seconds_per_image,
        total_seconds=body.total_seconds,
        fps=body.fps,
        allow_repeats=body.allow_repeats,
        color_theme="none",
        max_per_query=body.max_per_query,
        batch_title=body.batch_title,
    )
    background_tasks.add_task(run_variants_pipeline, job_ids, body.themes, user_id, base_config, db)

    logger.info("Variants job (%d themes) queued for user %s: %s", len(body.themes), user_id, job_ids)
    return {"job_ids": job_ids}


class PrefetchRequest(BaseModel):
    search_terms: List[str] = Field(..., min_length=1, max_length=20)
    resolution: str = Field(default="1080x1920")
    seconds_per_image: float = Field(default=0.3, ge=0.05, le=5.0)
    total_seconds: float = Field(default=3.0, ge=1.0, le=120.0)
    max_per_query: int = Field(default=3, ge=1, le=30)


@router.post("/prefetch-images")
async def prefetch_images(
    body: PrefetchRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Fetch images from Unsplash for a batch, download+resize them, upload to user-uploads,
    and return the storage paths. Used by the variants feature so all theme variants share
    the same source images rather than fetching independently.
    """
    if body.resolution not in ALLOWED_RESOLUTIONS:
        raise HTTPException(status_code=400, detail="Invalid resolution.")

    access_key = os.environ.get("UNSPLASH_ACCESS_KEY", "")
    w, h = (int(x) for x in body.resolution.lower().split("x"))
    need_total = max(1, int(body.total_seconds / body.seconds_per_image) + 10)

    tmp_root = tempfile.mkdtemp(prefix="prefetch_")
    images_dir = os.path.join(tmp_root, "images")
    os.makedirs(images_dir, exist_ok=True)

    try:
        items = await asyncio.to_thread(
            fetch_images,
            queries=body.search_terms,
            need_total=need_total,
            tw=w,
            th=h,
            access_key=access_key,
            color_theme="none",   # neutral fetch — grading applied per variant job
            max_per_query=body.max_per_query,
        )
        if not items:
            raise HTTPException(status_code=422, detail="No images returned by Unsplash for these search terms.")

        saved = await asyncio.to_thread(download_and_save, items, images_dir, w, h)
        if saved == 0:
            raise HTTPException(status_code=422, detail="No images could be downloaded.")

        # Upload each image to user-uploads and collect paths
        paths = []
        for fname in sorted(os.listdir(images_dir)):
            fpath = os.path.join(images_dir, fname)
            if not os.path.isfile(fpath):
                continue
            with open(fpath, "rb") as f:
                data = f.read()
            path = await upload_user_image(data, user_id, fname)
            paths.append(path)

        logger.info("Prefetched %d images for user %s", len(paths), user_id)
        return {"paths": paths}

    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


@router.get("/usage")
async def get_usage(user_id: str = Depends(get_current_user_id)):
    """Return plan, render count, limit, and trial status for the current user."""
    db = get_client()
    sub_result = (
        db.table("subscriptions")
        .select("status, plan, trial_expires_at")
        .eq("user_id", user_id)
        .execute()
    )
    sub = sub_result.data[0] if sub_result.data else {}
    plan = sub.get("plan", "none")

    trial_expires_at = sub.get("trial_expires_at") if plan == "trial" else None
    trial_expired = False
    if plan == "trial" and trial_expires_at:
        try:
            expires = datetime.fromisoformat(trial_expires_at.replace("Z", "+00:00"))
            trial_expired = datetime.now(timezone.utc) > expires
        except Exception:
            pass

    usage_result = (
        db.table("usage")
        .select("render_count")
        .eq("user_id", user_id)
        .eq("month", _current_month())
        .execute()
    )
    render_count = usage_result.data[0]["render_count"] if usage_result.data else 0
    limit = PLAN_LIMITS.get(plan)

    return {
        "plan": plan,
        "status": sub.get("status"),
        "render_count": render_count,
        "limit": limit,
        "trial_expires_at": trial_expires_at,
        "trial_expired": trial_expired,
    }
