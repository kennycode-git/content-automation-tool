"""
scheduler.py

APScheduler background job: fires pending TikTok posts at their scheduled_at time.
Runs every 60 seconds. Marks rows 'posting' before executing to prevent double-fire.
"""

import logging
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler

from db.supabase_client import get_client
from services.tiktok_service import get_valid_token, post_video

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler(timezone="UTC")


def _storage_path(user_id: str, job_id: str) -> str:
    return f"outputs/{user_id}/{job_id}.mp4"


def process_due_posts() -> None:
    """Query pending scheduled posts and execute any that are due."""
    try:
        supabase = get_client()
        now_iso = datetime.now(timezone.utc).isoformat()

        result = (
            supabase.table("scheduled_posts")
            .select("*, tiktok_accounts(*), jobs(id, user_id)")
            .eq("status", "pending")
            .lte("scheduled_at", now_iso)
            .execute()
        )
        posts = result.data or []

        if not posts:
            return

        logger.info("TikTok scheduler: processing %d due post(s)", len(posts))

        for post in posts:
            post_id = post["id"]
            try:
                # Atomically claim the row — only one process will succeed
                claim = (
                    supabase.table("scheduled_posts")
                    .update({"status": "posting"})
                    .eq("id", post_id)
                    .eq("status", "pending")
                    .execute()
                )
                if not claim.data:
                    # Another process already claimed it
                    continue

                account = post.get("tiktok_accounts")
                job = post.get("jobs")

                if not account:
                    raise ValueError("TikTok account disconnected")
                if not job:
                    raise ValueError("Job not found")

                user_id = job["user_id"]
                job_id = job["id"]
                path = _storage_path(user_id, job_id)

                # Re-sign the URL fresh at post time (48h URLs would be stale for future posts)
                sign_result = supabase.storage.from_("outputs").create_signed_url(path, 600)
                signed_url = (
                    sign_result.get("signedURL")
                    or sign_result.get("signed_url")
                    or (sign_result.get("data") or {}).get("signedUrl")
                )
                if not signed_url:
                    raise ValueError(f"Could not re-sign storage URL for job {job_id}")

                access_token = get_valid_token(account)

                caption_parts = [post.get("caption") or ""]
                hashtags = post.get("hashtags") or []
                if hashtags:
                    caption_parts.append(" ".join(f"#{h.lstrip('#')}" for h in hashtags))
                full_caption = " ".join(p for p in caption_parts if p).strip()[:2200]

                publish_id = post_video(
                    access_token=access_token,
                    video_url=signed_url,
                    caption=full_caption,
                    privacy_level=post.get("privacy_level", "PUBLIC_TO_EVERYONE"),
                )

                supabase.table("scheduled_posts").update({
                    "status": "posted",
                    "tiktok_publish_id": publish_id,
                }).eq("id", post_id).execute()

                logger.info("Post %s → posted, publish_id=%s", post_id, publish_id)

            except Exception as exc:
                logger.exception("Post %s failed: %s", post_id, exc)
                supabase.table("scheduled_posts").update({
                    "status": "failed",
                    "error_message": str(exc)[:500],
                }).eq("id", post_id).execute()

    except Exception as exc:
        logger.exception("process_due_posts top-level error: %s", exc)


scheduler.add_job(process_due_posts, "interval", minutes=1, id="tiktok_scheduler")
