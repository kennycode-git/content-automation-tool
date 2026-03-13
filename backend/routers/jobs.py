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

from fastapi import APIRouter, Depends, HTTPException

from db.supabase_client import get_client
from models.schemas import JobListItem, JobStatusResponse
from routers.auth import get_current_user_id
from services.job_manager import get_job, list_jobs, update_job_status
from services.storage import delete_file, get_signed_url

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
        color_theme=cfg.get("color_theme"),
        resolution=cfg.get("resolution"),
        seconds_per_image=cfg.get("seconds_per_image"),
        total_seconds=cfg.get("total_seconds"),
        preset_name=cfg.get("preset_name"),
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

    # Clean up storage file if present (don't fail if already gone)
    storage_path = f"{user_id}/{job_id}.mp4"
    try:
        await delete_file(storage_path)
    except Exception as exc:
        logger.warning("Could not delete storage file %s: %s", storage_path, exc)

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
