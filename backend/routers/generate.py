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
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from db.supabase_client import get_client
from models.schemas import GenerateRequest, GenerateResponse, ALLOWED_RESOLUTIONS
from routers.auth import get_current_user_id
from services.image_pipeline import fetch_images, download_and_save
from services.job_manager import JobConfig, create_job, run_pipeline
from services.storage import upload_user_image

logger = logging.getLogger(__name__)
router = APIRouter()

PLAN_LIMITS: dict = {
    "trial": 25,
    "creator": 30,
    "pro": None,  # unlimited
}


def _current_month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


@router.post("/generate", response_model=GenerateResponse, status_code=202)
async def generate(
    body: GenerateRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    db = get_client()

    # --- Subscription gate ---
    sub_result = (
        db.table("subscriptions")
        .select("status, plan")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    sub = sub_result.data
    if not sub or sub.get("status") != "active":
        raise HTTPException(status_code=403, detail="No active subscription.")

    # --- Usage gate ---
    plan = sub.get("plan", "creator")
    limit = PLAN_LIMITS.get(plan)
    if limit is not None:
        usage_result = (
            db.table("usage")
            .select("render_count")
            .eq("user_id", user_id)
            .eq("month", _current_month())
            .maybe_single()
            .execute()
        )
        usage = usage_result.data
        count = usage["render_count"] if usage else 0
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
