"""
tiktok.py

TikTok OAuth + scheduling endpoints.

Security:
- OAuth callback authenticates via HMAC-signed state (no JWT at callback time).
- All other endpoints require JWT.
- user_id always from verified JWT sub claim, never request body.
- Tokens are never returned to the frontend — only display_name and avatar_url.
"""

import logging
from datetime import datetime, timezone, timedelta

from pydantic import BaseModel

from fastapi import APIRouter, Depends, HTTPException

from routers.auth import get_current_user_id
from db.supabase_client import get_client
from models.schemas import PostNowRequest, SchedulePostRequest
from services import tiktok_service

logger = logging.getLogger(__name__)
router = APIRouter()


class TikTokExchangeRequest(BaseModel):
    code: str
    state: str


def _compose_caption(caption: str, hashtags: list[str] | None) -> str:
    parts = [caption or ""]
    if hashtags:
        parts.append(" ".join(f"#{h.lstrip('#')}" for h in hashtags))
    return " ".join(p for p in parts if p).strip()[:2200]


def _get_job_and_account_or_404(*, user_id: str, job_id: str, tiktok_account_id: str) -> tuple[dict, dict]:
    supabase = get_client()

    job_result = (
        supabase.table("jobs")
        .select("id, user_id")
        .eq("id", job_id)
        .eq("user_id", user_id)
        .eq("status", "done")
        .execute()
    )
    if not job_result.data:
        raise HTTPException(status_code=404, detail="Job not found or not completed.")

    acct_result = (
        supabase.table("tiktok_accounts")
        .select("*")
        .eq("id", tiktok_account_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not acct_result.data:
        raise HTTPException(status_code=404, detail="TikTok account not found.")

    return job_result.data[0], acct_result.data[0]


# ─── OAuth ────────────────────────────────────────────────────────────────────

@router.get("/tiktok/auth-url")
async def get_auth_url(user_id: str = Depends(get_current_user_id)):
    try:
        url = tiktok_service.build_auth_url(user_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return {"url": url}


@router.post("/tiktok/exchange")
async def exchange_tiktok_code(req: TikTokExchangeRequest):
    """Exchange OAuth code for tokens — no JWT, authenticated via HMAC-signed state."""
    try:
        user_id = tiktok_service.verify_state(req.state)
    except ValueError as exc:
        logger.warning("TikTok state verification failed: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid or expired state.")

    try:
        token_data = tiktok_service.exchange_code(req.code)
    except Exception as exc:
        logger.exception("TikTok token exchange failed: %s", exc)
        raise HTTPException(status_code=502, detail="Token exchange failed.")

    try:
        supabase = get_client()
        expires_at = (
            datetime.now(timezone.utc) + timedelta(seconds=token_data["expires_in"])
        ).isoformat()

        supabase.table("tiktok_accounts").upsert({
            "user_id": user_id,
            "tiktok_user_id": token_data["open_id"],
            "display_name": token_data.get("display_name"),
            "avatar_url": token_data.get("avatar_url"),
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token"),
            "token_expires_at": expires_at,
            "scope": token_data.get("scope", ""),
        }, on_conflict="user_id,tiktok_user_id").execute()

    except Exception as exc:
        logger.exception("TikTok account save failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to save account.")

    return {"success": True}


# ─── Accounts ─────────────────────────────────────────────────────────────────

@router.get("/tiktok/accounts")
async def list_accounts(user_id: str = Depends(get_current_user_id)):
    supabase = get_client()
    result = (
        supabase.table("tiktok_accounts")
        .select("id, tiktok_user_id, display_name, avatar_url, created_at")
        .eq("user_id", user_id)
        .execute()
    )
    return result.data or []


@router.delete("/tiktok/accounts/{account_id}", status_code=204)
async def disconnect_account(account_id: str, user_id: str = Depends(get_current_user_id)):
    supabase = get_client()
    result = (
        supabase.table("tiktok_accounts")
        .delete()
        .eq("id", account_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Account not found.")


# ─── Scheduling ───────────────────────────────────────────────────────────────

@router.post("/tiktok/schedule", status_code=201)
async def schedule_post(req: SchedulePostRequest, user_id: str = Depends(get_current_user_id)):
    if not req.draft_mode and req.scheduled_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="scheduled_at must be in the future.")

    supabase = get_client()
    _get_job_and_account_or_404(
        user_id=user_id,
        job_id=req.job_id,
        tiktok_account_id=req.tiktok_account_id,
    )

    insert_result = supabase.table("scheduled_posts").insert({
        "user_id": user_id,
        "job_id": req.job_id,
        "tiktok_account_id": req.tiktok_account_id,
        "caption": req.caption,
        "hashtags": req.hashtags,
        "privacy_level": req.privacy_level,
        "scheduled_at": req.scheduled_at.isoformat(),
        "draft_mode": req.draft_mode,
        "status": "pending",
    }).execute()

    return {"id": insert_result.data[0]["id"]}


@router.post("/tiktok/post-now", status_code=201)
async def post_now(req: PostNowRequest, user_id: str = Depends(get_current_user_id)):
    supabase = get_client()
    job, account = _get_job_and_account_or_404(
        user_id=user_id,
        job_id=req.job_id,
        tiktok_account_id=req.tiktok_account_id,
    )

    row = supabase.table("scheduled_posts").insert({
        "user_id": user_id,
        "job_id": req.job_id,
        "tiktok_account_id": req.tiktok_account_id,
        "caption": req.caption,
        "hashtags": req.hashtags,
        "privacy_level": req.privacy_level,
        "scheduled_at": datetime.now(timezone.utc).isoformat(),
        "draft_mode": False,
        "status": "posting",
    }).execute()
    post_id = row.data[0]["id"]

    try:
        storage_path = f"{job['user_id']}/{job['id']}.mp4"
        sign_result = supabase.storage.from_("outputs").create_signed_url(storage_path, 600)
        signed_url = (
            sign_result.get("signedURL")
            or sign_result.get("signed_url")
            or (sign_result.get("data") or {}).get("signedUrl")
        )
        if not signed_url:
            raise ValueError(f"Could not re-sign storage URL for job {job['id']}")

        publish_id = tiktok_service.post_video(
            access_token=tiktok_service.get_valid_token(account),
            video_url=signed_url,
            caption=_compose_caption(req.caption, req.hashtags),
            privacy_level=req.privacy_level,
            draft=False,
        )

        supabase.table("scheduled_posts").update({
            "status": "posted",
            "tiktok_publish_id": publish_id,
        }).eq("id", post_id).execute()
        return {"id": post_id, "publish_id": publish_id}
    except Exception as exc:
        logger.exception("Immediate TikTok post failed: %s", exc)
        supabase.table("scheduled_posts").update({
            "status": "failed",
            "error_message": str(exc)[:500],
        }).eq("id", post_id).execute()
        raise HTTPException(status_code=502, detail=f"Immediate TikTok post failed: {str(exc)[:300]}")


@router.get("/tiktok/scheduled")
async def list_scheduled(user_id: str = Depends(get_current_user_id)):
    supabase = get_client()
    result = (
        supabase.table("scheduled_posts")
        .select("*, tiktok_accounts(display_name), jobs(batch_title)")
        .eq("user_id", user_id)
        .order("scheduled_at", desc=True)
        .execute()
    )

    rows = []
    for row in (result.data or []):
        rows.append({
            "id": row["id"],
            "job_id": row["job_id"],
            "batch_title": (row.get("jobs") or {}).get("batch_title"),
            "tiktok_account_id": row.get("tiktok_account_id"),
            "tiktok_display_name": (row.get("tiktok_accounts") or {}).get("display_name"),
            "caption": row.get("caption", ""),
            "hashtags": row.get("hashtags") or [],
            "privacy_level": row.get("privacy_level", "PUBLIC_TO_EVERYONE"),
            "scheduled_at": row["scheduled_at"],
            "draft_mode": row.get("draft_mode", False),
            "status": row["status"],
            "tiktok_publish_id": row.get("tiktok_publish_id"),
            "error_message": row.get("error_message"),
            "created_at": row["created_at"],
        })
    return rows


@router.delete("/tiktok/scheduled/{post_id}", status_code=204)
async def cancel_scheduled(post_id: str, user_id: str = Depends(get_current_user_id)):
    supabase = get_client()
    result = (
        supabase.table("scheduled_posts")
        .update({"status": "cancelled"})
        .eq("id", post_id)
        .eq("user_id", user_id)
        .eq("status", "pending")
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Scheduled post not found or not cancellable.")
