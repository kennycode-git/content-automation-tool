"""
jobs.py

GET    /api/jobs/{job_id}        — poll job status
GET    /api/jobs                 — list recent jobs (last 10)
DELETE /api/jobs/{job_id}        — cancel/delete a job permanently
POST   /api/jobs/{job_id}/resign — generate a fresh signed URL for an existing video file

Security considerations:
- All queries include .eq("user_id", user_id) from the verified JWT — a user
  can never read or delete another user's job.
- DELETE cleans up the storage file, dependent scheduled rows, and the DB row.
- output_url is a time-limited signed URL (48h) generated at job completion.
- resign regenerates the URL without re-running the pipeline — the MP4 file
  persists in Storage until explicitly deleted.
"""

import asyncio
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from db.supabase_client import get_client
from models.schemas import JobListItem, JobStatusResponse, PreviewBatchResult, PreviewImageItem, RegradeRequest
from routers.auth import get_current_user_id
from routers.preview import _stage_accent_preview_items, _stage_philosopher_preview_items, _upload_preview_item
from services.image_grader import apply_theme_grading
from services.job_manager import get_job, list_jobs, update_job_status, run_regrade_pipeline, create_job, JobConfig
from services.storage import delete_file, get_signed_url, delete_raw_images, list_raw_image_paths, download_raw_images_to_dir

logger = logging.getLogger(__name__)
router = APIRouter()


def _resolve_regrade_settings(req: RegradeRequest, original_config: dict) -> dict:
    effective_custom_grade_params = (
        req.custom_grade_params.model_dump() if req.custom_grade_params else original_config.get("custom_grade_params")
    )
    if req.color_theme == "custom" and not effective_custom_grade_params:
        raise HTTPException(status_code=400, detail="This job has no saved custom theme settings to reuse.")

    seconds_per_image = req.seconds_per_image
    if seconds_per_image is None:
        seconds_per_image = float(original_config.get("seconds_per_image", 0.13))

    total_seconds = req.total_seconds
    if total_seconds is None:
        total_seconds = float(original_config.get("total_seconds", 11.0))

    accent_folder = req.accent_folder if "accent_folder" in req.model_fields_set else original_config.get("accent_folder")
    philosopher = req.philosopher if "philosopher" in req.model_fields_set else original_config.get("philosopher")
    philosopher_count = req.philosopher_count if "philosopher_count" in req.model_fields_set else int(original_config.get("philosopher_count", 3))
    grade_philosopher = req.grade_philosopher if "grade_philosopher" in req.model_fields_set else bool(original_config.get("grade_philosopher", False))
    philosopher_is_user = req.philosopher_is_user if "philosopher_is_user" in req.model_fields_set else bool(original_config.get("philosopher_is_user", False))

    return {
        "seconds_per_image": seconds_per_image,
        "total_seconds": total_seconds,
        "accent_folder": accent_folder,
        "philosopher": philosopher,
        "philosopher_count": philosopher_count,
        "grade_philosopher": grade_philosopher,
        "philosopher_is_user": philosopher_is_user,
        "custom_grade_params": effective_custom_grade_params,
    }


async def _build_reedit_preview(
    *,
    job_id: str,
    user_id: str,
    cfg: dict,
    color_theme: str,
    seconds_per_image: float,
    total_seconds: float,
    accent_folder: str | None,
    philosopher: str | None,
    philosopher_count: int,
    grade_philosopher: bool,
    philosopher_is_user: bool,
    custom_grade_params: dict | None,
) -> PreviewBatchResult:
    width, height = (int(x) for x in cfg.get("resolution", "1080x1920").lower().split("x"))
    raw_paths = await asyncio.to_thread(list_raw_image_paths, user_id, job_id)
    if not raw_paths:
        raise HTTPException(status_code=404, detail="No cached images for this job.")

    ts = int(time.time() * 1000)
    tmp_root = tempfile.mkdtemp(prefix=f"reedit_review_{job_id[:8]}_")
    try:
        raw_dir = os.path.join(tmp_root, "raw")
        graded_dir = os.path.join(tmp_root, "graded")
        count = await asyncio.to_thread(download_raw_images_to_dir, user_id, job_id, raw_dir)
        if count == 0:
            raise HTTPException(status_code=404, detail="No cached images for this job.")

        if color_theme != "none":
            render_dir = await asyncio.to_thread(
                apply_theme_grading,
                raw_dir,
                graded_dir,
                color_theme,
                custom_grade_params,
            )
        else:
            render_dir = raw_dir

        raw_path_by_name = {os.path.basename(path): path for path in raw_paths}
        image_items: list[PreviewImageItem] = []
        for fname in sorted(f for f in os.listdir(render_dir) if Path(render_dir, f).is_file()):
            local_path = Path(render_dir) / fname
            raw_storage_path = raw_path_by_name.get(fname)
            if not raw_storage_path:
                continue
            staged = await _upload_preview_item(
                user_id=user_id,
                storage_suffix=f"{ts}_{job_id}_review_{fname}",
                local_path=local_path,
            )
            image_items.append(PreviewImageItem(
                storage_path=raw_storage_path,
                render_storage_path=raw_storage_path,
                signed_url=staged.signed_url,
            ))

        needed_frames = max(1, int(total_seconds / seconds_per_image))
        accent_count = max(1, needed_frames // 5) if accent_folder else 0

        accent_items: list[PreviewImageItem] = []
        if accent_folder and accent_count > 0:
            accent_items = await _stage_accent_preview_items(
                user_id=user_id,
                accent_folder=accent_folder,
                accent_count=accent_count,
                width=width,
                height=height,
                storage_prefix=f"{ts}_{job_id}_review_accent",
            )

        philosopher_items: list[PreviewImageItem] = []
        if philosopher:
            philosopher_items = await _stage_philosopher_preview_items(
                user_id=user_id,
                philosopher=philosopher,
                philosopher_count=philosopher_count,
                philosopher_is_user=philosopher_is_user,
                grade_philosopher=grade_philosopher,
                color_theme=color_theme,
                custom_grade_params=custom_grade_params,
                width=width,
                height=height,
                storage_prefix=f"{ts}_{job_id}_review_phil",
            )

        return PreviewBatchResult(
            batch_title=cfg.get("batch_title"),
            search_terms=cfg.get("search_terms", []),
            color_theme=color_theme,
            accent_folder=accent_folder,
            philosopher=philosopher,
            grade_philosopher=grade_philosopher,
            philosopher_is_user=philosopher_is_user,
            images=philosopher_items + accent_items + image_items,
        )
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job_status(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
):
    db = get_client()
    job = await get_job(job_id, user_id, db)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    cfg = job.get("config") or {}
    return JobStatusResponse(
        job_id=job["id"],
        status=job["status"],
        progress_message=job.get("progress_message"),
        output_url=job.get("output_url"),
        thumbnail_url=job.get("thumbnail_url"),
        error_message=job.get("error_message"),
        batch_title=job.get("batch_title"),
        mode=cfg.get("mode"),
        search_terms=cfg.get("search_terms"),
        fps=cfg.get("fps"),
        allow_repeats=cfg.get("allow_repeats"),
        color_theme=cfg.get("color_theme"),
        resolution=cfg.get("resolution"),
        seconds_per_image=cfg.get("seconds_per_image"),
        total_seconds=cfg.get("total_seconds"),
        max_per_query=cfg.get("max_per_query"),
        image_source=cfg.get("image_source"),
        accent_folder=cfg.get("accent_folder"),
        philosopher=cfg.get("philosopher"),
        philosopher_count=cfg.get("philosopher_count"),
        grade_philosopher=cfg.get("grade_philosopher"),
        philosopher_is_user=cfg.get("philosopher_is_user"),
        transition=cfg.get("transition"),
        transition_duration=cfg.get("transition_duration"),
        max_clip_duration=cfg.get("max_clip_duration"),
        clip_count=cfg.get("clip_count"),
        layered_config=cfg.get("layered_config"),
        preset_name=cfg.get("preset_name"),
        preview_images=cfg.get("preview_images"),
        custom_grade_params=cfg.get("custom_grade_params"),
        text_overlay=cfg.get("text_overlay"),
        ai_voiceover=cfg.get("ai_voiceover"),
        images_cached=cfg.get("images_cached", False),
        created_at=job["created_at"],
        completed_at=job.get("completed_at"),
    )


@router.get("/jobs", response_model=list[JobListItem])
async def get_recent_jobs(user_id: str = Depends(get_current_user_id)):
    db = get_client()
    jobs = await list_jobs(user_id, db, limit=15)
    return [
        JobListItem(
            job_id=j["id"],
            status=j["status"],
            progress_message=j.get("progress_message"),
            output_url=j.get("output_url"),
            thumbnail_url=j.get("thumbnail_url"),
            batch_title=j.get("batch_title"),
            mode=(j.get("config") or {}).get("mode"),
            search_terms=(j.get("config") or {}).get("search_terms"),
            resolution=(j.get("config") or {}).get("resolution"),
            seconds_per_image=(j.get("config") or {}).get("seconds_per_image"),
            total_seconds=(j.get("config") or {}).get("total_seconds"),
            fps=(j.get("config") or {}).get("fps"),
            allow_repeats=(j.get("config") or {}).get("allow_repeats"),
            color_theme=(j.get("config") or {}).get("color_theme"),
            max_per_query=(j.get("config") or {}).get("max_per_query"),
            image_source=(j.get("config") or {}).get("image_source"),
            accent_folder=(j.get("config") or {}).get("accent_folder"),
            philosopher=(j.get("config") or {}).get("philosopher"),
            philosopher_count=(j.get("config") or {}).get("philosopher_count"),
            grade_philosopher=(j.get("config") or {}).get("grade_philosopher"),
            philosopher_is_user=(j.get("config") or {}).get("philosopher_is_user"),
            transition=(j.get("config") or {}).get("transition"),
            transition_duration=(j.get("config") or {}).get("transition_duration"),
            max_clip_duration=(j.get("config") or {}).get("max_clip_duration"),
            clip_count=(j.get("config") or {}).get("clip_count"),
            layered_config=(j.get("config") or {}).get("layered_config"),
            preset_name=(j.get("config") or {}).get("preset_name"),
            custom_grade_params=(j.get("config") or {}).get("custom_grade_params"),
            text_overlay=(j.get("config") or {}).get("text_overlay"),
            ai_voiceover=(j.get("config") or {}).get("ai_voiceover"),
            images_cached=(j.get("config") or {}).get("images_cached", False),
            created_at=j["created_at"],
            completed_at=j.get("completed_at"),
        )
        for j in jobs
    ]


@router.delete("/jobs/{job_id}", status_code=204)
async def delete_job(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
):
    db = get_client()
    job = await get_job(job_id, user_id, db)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    # Clean up output MP4 and cached raw images (don't fail if already gone)
    storage_path = f"{user_id}/{job_id}.mp4"
    try:
        await delete_file(storage_path)
    except Exception as exc:
        logger.warning("Could not delete storage file %s: %s", storage_path, exc)

    try:
        import asyncio
        await asyncio.to_thread(delete_raw_images, user_id, job_id)
    except Exception as exc:
        logger.warning("Could not delete raw images for job %s: %s", job_id, exc)

    try:
        db.table("scheduled_posts").delete().eq("job_id", job_id).execute()
    except Exception as exc:
        logger.warning("Could not delete scheduled post rows for job %s: %s", job_id, exc)

    db.table("jobs").delete().eq("id", job_id).eq("user_id", user_id).execute()

    logger.info("Job %s permanently deleted by user %s", job_id, user_id)


@router.post("/jobs/{job_id}/resign")
async def resign_job(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Generate a fresh 48h signed URL for an existing completed video.
    The MP4 file stays in Storage — only the download link is refreshed.
    """
    db = get_client()
    job = await get_job(job_id, user_id, db)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job["status"] != "done":
        raise HTTPException(status_code=400, detail="Job is not complete.")

    storage_path = f"{user_id}/{job_id}.mp4"
    try:
        new_url = await get_signed_url(storage_path)
    except Exception as exc:
        logger.warning("resign failed for job %s: %s", job_id, exc)
        raise HTTPException(
            status_code=404,
            detail="Could not refresh URL — the video file may have been deleted from storage.",
        )

    db.table("jobs").update({"output_url": new_url}).eq("id", job_id).eq("user_id", user_id).execute()
    logger.info("Resigned URL for job %s (user %s)", job_id, user_id)
    return {"output_url": new_url}


@router.post("/jobs/{job_id}/regrade")
async def regrade_job(
    job_id: str,
    req: RegradeRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    """
    Re-grade cached raw images from an existing completed job with a new colour theme
    and/or pacing, creating a new job row. No Unsplash/Pexels fetch — fast re-render.
    Returns the new job_id immediately; poll /api/jobs/{new_job_id} for status.
    """
    db = get_client()
    source_job = await get_job(job_id, user_id, db)
    if not source_job:
        raise HTTPException(status_code=404, detail="Job not found.")
    if source_job["status"] != "done":
        raise HTTPException(status_code=400, detail="Source job must be completed.")

    original_config = source_job.get("config") or {}
    if not original_config.get("images_cached"):
        raise HTTPException(
            status_code=400,
            detail="No cached images available for this job. Re-grade is only available for recently completed jobs.",
        )
    resolved = _resolve_regrade_settings(req, original_config)
    seconds_per_image = resolved["seconds_per_image"]
    total_seconds = resolved["total_seconds"]
    accent_folder = resolved["accent_folder"]
    philosopher = resolved["philosopher"]
    philosopher_count = resolved["philosopher_count"]
    grade_philosopher = resolved["grade_philosopher"]
    philosopher_is_user = resolved["philosopher_is_user"]
    effective_custom_grade_params = resolved["custom_grade_params"]

    # Build a config for the new job row
    source_title = source_job.get("batch_title") or original_config.get("batch_title")
    new_title = f"{source_title} · {req.color_theme}" if source_title else req.color_theme

    new_config = JobConfig(
        search_terms=original_config.get("search_terms", []),
        resolution=original_config.get("resolution", "1080x1920"),
        seconds_per_image=seconds_per_image,
        total_seconds=total_seconds,
        fps=int(original_config.get("fps", 30)),
        allow_repeats=bool(original_config.get("allow_repeats", True)),
        color_theme=req.color_theme,
        max_per_query=int(original_config.get("max_per_query", 3)),
        batch_title=new_title,
        preset_name=original_config.get("preset_name"),
        accent_folder=accent_folder,
        image_source=original_config.get("image_source", "unsplash"),
        custom_grade_params=effective_custom_grade_params if req.color_theme == "custom" else original_config.get("custom_grade_params"),
        philosopher=philosopher,
        philosopher_count=philosopher_count,
        grade_philosopher=grade_philosopher,
        philosopher_is_user=philosopher_is_user,
        text_overlay=original_config.get("text_overlay"),
        ai_voiceover=original_config.get("ai_voiceover"),
        layered_config=req.layered_config.model_dump() if req.layered_config else original_config.get("layered_config"),
    )
    new_job_id = await create_job(user_id, new_config, db)
    logger.info("Regrade job %s created from source %s (theme=%s)", new_job_id, job_id, req.color_theme)

    background_tasks.add_task(
        run_regrade_pipeline,
        source_job_id=job_id,
        new_job_id=new_job_id,
        user_id=user_id,
        color_theme=req.color_theme,
        seconds_per_image=seconds_per_image,
        total_seconds=total_seconds,
        original_config=original_config,
        db=db,
        selected_paths=req.selected_paths,
        custom_grade_params_override=effective_custom_grade_params if req.color_theme == "custom" else None,
        accent_folder_override=accent_folder,
        philosopher_override=philosopher,
        philosopher_count_override=philosopher_count,
        grade_philosopher_override=grade_philosopher,
        philosopher_is_user_override=philosopher_is_user,
        layered_config_override=req.layered_config.model_dump() if req.layered_config else None,
    )
    return {"job_id": new_job_id, "status": "queued"}


@router.post("/jobs/{job_id}/review-images", response_model=PreviewBatchResult)
async def review_job_images(
    job_id: str,
    req: RegradeRequest,
    user_id: str = Depends(get_current_user_id),
):
    db = get_client()
    job = await get_job(job_id, user_id, db)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    cfg = job.get("config") or {}
    if not cfg.get("images_cached"):
        raise HTTPException(status_code=404, detail="No cached images for this job.")

    resolved = _resolve_regrade_settings(req, cfg)
    return await _build_reedit_preview(
        job_id=job_id,
        user_id=user_id,
        cfg=cfg,
        color_theme=req.color_theme,
        seconds_per_image=resolved["seconds_per_image"],
        total_seconds=resolved["total_seconds"],
        accent_folder=resolved["accent_folder"],
        philosopher=resolved["philosopher"],
        philosopher_count=resolved["philosopher_count"],
        grade_philosopher=resolved["grade_philosopher"],
        philosopher_is_user=resolved["philosopher_is_user"],
        custom_grade_params=resolved["custom_grade_params"] if req.color_theme == "custom" else None,
    )


@router.get("/jobs/{job_id}/raw-images", response_model=PreviewBatchResult)
async def get_raw_images(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Return signed URLs for a job's cached raw images, for image review before re-edit."""
    import asyncio
    db = get_client()
    job = await get_job(job_id, user_id, db)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    cfg = job.get("config") or {}
    if not cfg.get("images_cached"):
        raise HTTPException(status_code=404, detail="No cached images for this job.")

    paths = await asyncio.to_thread(list_raw_image_paths, user_id, job_id)
    signed: list[PreviewImageItem] = []
    for path in paths:
        try:
            url = await get_signed_url(path, expiry_seconds=3600)
            signed.append(PreviewImageItem(storage_path=path, signed_url=url))
        except Exception:
            pass  # skip files that can't be signed

    phil_items: list[PreviewImageItem] = []
    philosopher = cfg.get("philosopher")
    if philosopher:
        resolution = cfg.get("resolution", "1080x1920")
        try:
            width, height = (int(x) for x in resolution.lower().split("x"))
            phil_items = await _stage_philosopher_preview_items(
                user_id=user_id,
                philosopher=philosopher,
                philosopher_count=int(cfg.get("philosopher_count", 3)),
                philosopher_is_user=bool(cfg.get("philosopher_is_user", False)),
                grade_philosopher=bool(cfg.get("grade_philosopher", False)),
                color_theme=cfg.get("color_theme", "none"),
                custom_grade_params=cfg.get("custom_grade_params"),
                width=width,
                height=height,
                storage_prefix=f"{job_id}_raw_phil",
            )
        except Exception as exc:
            logger.warning("Could not stage philosopher review images for job %s: %s", job_id, exc)

    return PreviewBatchResult(
        batch_title=job.get("batch_title"),
        search_terms=cfg.get("search_terms", []),
        color_theme=cfg.get("color_theme"),
        philosopher=philosopher,
        grade_philosopher=bool(cfg.get("grade_philosopher", False)),
        philosopher_is_user=bool(cfg.get("philosopher_is_user", False)),
        images=phil_items + signed,
    )


@router.delete("/jobs/{job_id}/images", status_code=204)
async def delete_job_images(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Delete the cached raw images for a completed job, freeing storage.
    After this call, re-grade will no longer be available for this job.
    """
    import asyncio
    db = get_client()
    job = await get_job(job_id, user_id, db)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    try:
        await asyncio.to_thread(delete_raw_images, user_id, job_id)
    except Exception as exc:
        logger.warning("Could not delete raw images for job %s: %s", job_id, exc)

    # Clear images_cached flag
    cfg = job.get("config") or {}
    cfg["images_cached"] = False
    db.table("jobs").update({"config": cfg}).eq("id", job_id).eq("user_id", user_id).execute()
    logger.info("Deleted cached images for job %s (user %s)", job_id, user_id)
