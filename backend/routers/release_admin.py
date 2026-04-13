"""Admin release announcement broadcast endpoints."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, EmailStr, Field

from db.supabase_client import get_client
from routers.admin import _check_key
from services.release_email import (
    parse_unsubscribe_token,
    read_release_markdown,
    render_release_email,
    send_broadcast_job,
    send_preview_email,
    utc_now,
)

logger = logging.getLogger(__name__)
router = APIRouter()


class GeneratePreviewBody(BaseModel):
    version: str = Field(..., min_length=1, max_length=40)
    markdown_path: str = Field(..., min_length=1, max_length=240)
    title: Optional[str] = Field(default=None, max_length=140)
    changelog_url: Optional[str] = Field(default=None, max_length=500)
    use_llm_summary: bool = False
    created_by: Optional[str] = None


class SendPreviewBody(BaseModel):
    release_id: str
    preview_email: EmailStr
    triggered_by: Optional[str] = None


class ApproveAndSendBody(BaseModel):
    release_id: str
    approved_by: Optional[str] = None
    batch_size: int = Field(default=50, ge=1, le=100)


def _release_or_404(db, release_id: str) -> dict:
    rows = db.table("release_announcements").select("*").eq("id", release_id).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Release not found.")
    return rows[0]


@router.post("/admin/releases/generate-preview")
async def generate_preview(body: GeneratePreviewBody, request: Request):
    """Read markdown, render email HTML/text, and store a preview-generated release."""
    _check_key(request)
    db = get_client()
    try:
        markdown = read_release_markdown(body.markdown_path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    rendered = await render_release_email(
        markdown=markdown,
        version=body.version,
        title=body.title,
        changelog_url=body.changelog_url,
        recipient_user_id="preview",
        recipient_email="preview@passiveclip.com",
        use_llm_summary=body.use_llm_summary,
    )
    payload = {
        "version": body.version,
        "title": body.title or rendered.headline,
        "markdown_path": body.markdown_path,
        "markdown_content": markdown,
        "summary_text": rendered.summary_text,
        "email_subject": rendered.subject,
        "email_html": rendered.html,
        "email_text": rendered.text,
        "changelog_url": body.changelog_url,
        "status": "preview_generated",
        "created_by": body.created_by,
    }

    existing = db.table("release_announcements").select("id").eq("version", body.version).execute().data or []
    if existing:
        release_id = existing[0]["id"]
        release = db.table("release_announcements").update(payload).eq("id", release_id).execute().data[0]
    else:
        release = db.table("release_announcements").insert(payload).execute().data[0]

    return {
        "release_id": release["id"],
        "version": release["version"],
        "status": release["status"],
        "subject": release["email_subject"],
        "summary_text": release["summary_text"],
        "email_html": release["email_html"],
        "email_text": release["email_text"],
    }


@router.post("/admin/releases/send-preview")
async def send_preview(body: SendPreviewBody, request: Request):
    """Send the generated release email to a single human reviewer."""
    _check_key(request)
    db = get_client()
    release = _release_or_404(db, body.release_id)
    if not release.get("email_html") or not release.get("email_text"):
        raise HTTPException(status_code=409, detail="Generate a preview before sending a preview email.")
    job = await send_preview_email(
        db,
        release=release,
        preview_email=str(body.preview_email),
        triggered_by=body.triggered_by,
    )
    return {
        "release_id": body.release_id,
        "broadcast_job_id": job["id"],
        "preview_email": str(body.preview_email),
        "status": job["status"],
    }


@router.post("/admin/releases/approve-and-send")
async def approve_and_send(body: ApproveAndSendBody, background_tasks: BackgroundTasks, request: Request):
    """Approve a release and queue the retry-safe broadcast job."""
    _check_key(request)
    db = get_client()
    release = _release_or_404(db, body.release_id)
    if release.get("status") in {"sending", "sent"}:
        raise HTTPException(status_code=409, detail=f"Release is already {release['status']}.")
    if not release.get("email_html") or not release.get("email_text"):
        raise HTTPException(status_code=409, detail="Generate and review a preview before approval.")

    db.table("release_announcements").update({
        "status": "approved",
        "approved_by": body.approved_by,
        "approved_at": utc_now(),
    }).eq("id", body.release_id).execute()

    job = db.table("release_broadcast_jobs").insert({
        "release_id": body.release_id,
        "triggered_by": body.approved_by,
        "status": "queued",
    }).execute().data[0]
    background_tasks.add_task(
        send_broadcast_job,
        db,
        release_id=body.release_id,
        job_id=job["id"],
        batch_size=body.batch_size,
    )
    return {
        "release_id": body.release_id,
        "broadcast_job_id": job["id"],
        "status": "queued",
    }


@router.get("/admin/releases/{release_id}")
async def get_release(release_id: str, request: Request):
    """Return release, broadcast jobs, and recipient delivery counts."""
    _check_key(request)
    db = get_client()
    release = _release_or_404(db, release_id)
    jobs = (
        db.table("release_broadcast_jobs")
        .select("*")
        .eq("release_id", release_id)
        .order("created_at", desc=True)
        .execute()
        .data or []
    )
    recipients = (
        db.table("release_broadcast_recipients")
        .select("send_status")
        .eq("release_id", release_id)
        .execute()
        .data or []
    )
    counts: dict[str, int] = {}
    for row in recipients:
        status = row.get("send_status", "unknown")
        counts[status] = counts.get(status, 0) + 1
    return {"release": release, "broadcast_jobs": jobs, "recipient_counts": counts}


@router.get("/releases/unsubscribe", response_class=HTMLResponse)
async def unsubscribe(token: str):
    """One-click unsubscribe link for product update emails."""
    db = get_client()
    try:
        user_id, email = parse_unsubscribe_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if user_id == "preview":
        return HTMLResponse(
            "<!doctype html><html><body style='font-family:Arial,sans-serif;background:#f5f2ed;color:#171512;padding:40px;'>"
            "<div style='max-width:520px;margin:0 auto;background:white;border:1px solid #e7dfd4;border-radius:16px;padding:28px;'>"
            "<h1 style='margin-top:0;'>Preview email link</h1>"
            "<p>This was a preview email, so no subscription preference was changed.</p>"
            "</div></body></html>"
        )

    try:
        db.table("email_update_preferences").upsert({
            "user_id": user_id,
            "subscribed_to_product_updates": False,
            "unsubscribed_at": utc_now(),
        }, on_conflict="user_id").execute()
    except Exception:
        logger.exception("Release email unsubscribe failed for %s (%s)", email, user_id)
        return HTMLResponse(
            "<!doctype html><html><body style='font-family:Arial,sans-serif;background:#f5f2ed;color:#171512;padding:40px;'>"
            "<div style='max-width:520px;margin:0 auto;background:white;border:1px solid #e7dfd4;border-radius:16px;padding:28px;'>"
            "<h1 style='margin-top:0;'>We couldn't unsubscribe you</h1>"
            "<p>Please contact support and we'll update your email preference manually.</p>"
            "</div></body></html>",
            status_code=500,
        )
    logger.info("Release email unsubscribe: %s (%s)", email, user_id)
    return HTMLResponse(
        "<!doctype html><html><body style='font-family:Arial,sans-serif;background:#f5f2ed;color:#171512;padding:40px;'>"
        "<div style='max-width:520px;margin:0 auto;background:white;border:1px solid #e7dfd4;border-radius:16px;padding:28px;'>"
        "<h1 style='margin-top:0;'>You’re unsubscribed</h1>"
        "<p>You will no longer receive PassiveClip product update emails.</p>"
        "</div></body></html>"
    )
