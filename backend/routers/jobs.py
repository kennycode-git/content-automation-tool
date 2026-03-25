"""
jobs.py

GET    /api/jobs/{job_id}        — poll job status
GET    /api/jobs                 — list recent jobs (last 10)
DELETE /api/jobs/{job_id}        — cancel/delete a job
POST   /api/jobs/{job_id}/resign — generate a fresh signed URL for an existing video file

Security considerations:
- All queries include .eq("user_id", user_id) from the verified JWT — a user
  can never read or delete another user's job.
- DELETE cleans up the storage file before soft-deleting the DB row.
- output_url is a time-limited signed URL (48h) generated at job completion.
- resign regenerates the URL without re-running the pipeline — the MP4 file
  persists in Storage until explicitly deleted.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from db.supabase_client import get_client
from models.schemas import JobListItem, JobStatusResponse, RegradeRequest
from routers.auth import get_current_user_id
from services.job_manager import get_job, list_jobs, update_job_status, run_regrade_pipeline, create_job, JobConfig
from services.storage import delete_file, get_signed_url, delete_raw_images

logger = logging.getLogger(__name__)
router = APIRouter()


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
        search_terms=cfg.get("search_terms"),
        color_theme=cfg.get("color_theme"),
        resolution=cfg.get("resolution"),
        seconds_per_image=cfg.get("seconds_per_image"),
        total_seconds=cfg.get("total_seconds"),
        max_per_query=cfg.get("max_per_query"),
        preset_name=cfg.get("preset_name"),
        preview_images=cfg.get("preview_images"),
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
            search_terms=(j.get("config") or {}).get("search_terms"),
            resolution=(j.get("config") or {}).get("resolution"),
            seconds_per_image=(j.get("config") or {}).get("seconds_per_image"),
            total_seconds=(j.get("config") or {}).get("total_seconds"),
            fps=(j.get("config") or {}).get("fps"),
            allow_repeats=(j.get("config") or {}).get("allow_repeats"),
            color_theme=(j.get("config") or {}).get("color_theme"),
            max_per_query=(j.get("config") or {}).get("max_per_query"),
            preset_name=(j.get("config") or {}).get("preset_name"),
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

    # Soft-delete: null out output_url and mark deleted
    db.table("jobs").update({
        "status": "deleted",
        "output_url": None,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", job_id).eq("user_id", user_id).execute()

    logger.info("Job %s deleted by user %s", job_id, user_id)


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

    # Derive seconds_per_image: use request value or fall back to original
    seconds_per_image = req.seconds_per_image
    if seconds_per_image is None:
        seconds_per_image = float(original_config.get("seconds_per_image", 0.13))

    # Build a config for the new job row
    source_title = source_job.get("batch_title") or original_config.get("batch_title")
    new_title = f"{source_title} · {req.color_theme}" if source_title else req.color_theme

    new_config = JobConfig(
        search_terms=original_config.get("search_terms", []),
        resolution=original_config.get("resolution", "1080x1920"),
        seconds_per_image=seconds_per_image,
        total_seconds=float(original_config.get("total_seconds", 11.0)),
        fps=int(original_config.get("fps", 30)),
        allow_repeats=bool(original_config.get("allow_repeats", True)),
        color_theme=req.color_theme,
        max_per_query=int(original_config.get("max_per_query", 3)),
        batch_title=new_title,
        preset_name=original_config.get("preset_name"),
        text_overlay=original_config.get("text_overlay"),
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
        original_config=original_config,
        db=db,
    )
    return {"job_id": new_job_id, "status": "queued"}


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
