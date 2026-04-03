"""
clips.py

GET  /api/clips/search   — fetch Pexels video clip metadata for the picker UI
POST /api/clips/generate — create a clip render job

Security:
- JWT required on both endpoints (get_current_user_id dependency).
- download_url validated in ClipTrim schema to start with https://videos.pexels.com/
- id validated in ClipTrim schema to match ^pv_\d+$ (prevents SSRF via crafted IDs)
- Same subscription + usage gate as /api/generate.
"""

import logging
import os
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from db.supabase_client import get_client
from models.schemas import ClipGenerateRequest, ClipSearchResponse, ClipSearchResult, GenerateResponse
from routers.auth import get_current_user_id
from routers.generate import TRIAL_MODE, PLAN_LIMITS, _current_month, _trial_expired
from services.clip_job_manager import ClipJobConfig, run_clips_pipeline
from services.job_manager import create_job, JobConfig
from services.pexels_video_pipeline import fetch_video_clips

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/clips/search", response_model=ClipSearchResponse)
async def search_clips(
    terms: str = Query(..., description="Comma-separated search terms (max 3)"),
    per_term: int = Query(default=5, ge=1, le=10),
    color_theme: str = Query(default="none"),
    user_id: str = Depends(get_current_user_id),
):
    """
    Fetch Pexels video clip metadata for the preview picker.
    Returns clip thumbnails + preview URLs — no server-side downloading.
    """
    pexels_key = os.environ.get("PEXELS_ACCESS_KEY", "")
    if not pexels_key:
        raise HTTPException(status_code=503, detail="Pexels API key not configured.")

    term_list = [t.strip() for t in terms.split(",") if t.strip()][:3]
    if not term_list:
        raise HTTPException(status_code=422, detail="At least one search term is required.")

    try:
        raw_clips = await __import__("asyncio").to_thread(
            fetch_video_clips,
            queries=term_list,
            per_query=per_term,
            access_key=pexels_key,
            color_theme=color_theme,
        )
    except Exception as exc:
        logger.exception("Clip search failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Clip search failed: {exc}")

    clips = [
        ClipSearchResult(
            id=c.id,
            duration=c.duration,
            thumbnail=c.thumbnail,
            preview_url=c.preview_url,
            download_url=c.download_url,
            width=c.width,
            height=c.height,
        )
        for c in raw_clips
    ]
    return ClipSearchResponse(clips=clips)


@router.post("/clips/generate", response_model=GenerateResponse, status_code=202)
async def generate_from_clips(
    body: ClipGenerateRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    """
    Create a video render job from user-selected Pexels clips.
    Clips are downloaded and rendered server-side as a BackgroundTask.
    """
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

        plan = sub.get("plan", "creator")
        if plan == "trial" and _trial_expired(sub):
            raise HTTPException(
                status_code=403,
                detail={"code": "trial_expired", "message": "Your 21-day trial has ended. Upgrade to continue."},
            )

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
                    detail=f"Monthly render limit of {limit} reached.",
                )

    # Build clip specs from validated request
    clip_specs = [
        {
            "id": c.id,
            "download_url": c.download_url,
            "trim_start": c.trim_start,
            "trim_end": c.trim_end,
            "duration": c.duration,
        }
        for c in body.clips
    ]

    config = ClipJobConfig(
        clip_specs=clip_specs,
        resolution=body.resolution,
        fps=body.fps,
        color_theme=body.color_theme,
        transition=body.transition,
        transition_duration=body.transition_duration,
        max_clip_duration=body.max_clip_duration,
        batch_title=body.batch_title,
        text_overlay=body.text_overlay.model_dump() if body.text_overlay else None,
        ai_voiceover=body.ai_voiceover.model_dump() if body.ai_voiceover else None,
    )

    # Reuse create_job by wrapping ClipJobConfig into a compatible minimal JobConfig
    # (job row stores config as JSONB — we use a thin adapter)
    class _ClipJobAdapter:
        """Minimal duck-type adapter so create_job() can serialise ClipJobConfig."""
        def __init__(self, cfg: ClipJobConfig):
            self._cfg = cfg
            self.batch_title = cfg.batch_title

        def to_dict(self):
            return self._cfg.to_dict()

    adapter = _ClipJobAdapter(config)
    job_id = await create_job(user_id, adapter, db)

    background_tasks.add_task(run_clips_pipeline, job_id, user_id, config, db)

    logger.info("Clip job %s queued for user %s (%d clips)", job_id, user_id, len(clip_specs))
    return GenerateResponse(job_id=job_id)
