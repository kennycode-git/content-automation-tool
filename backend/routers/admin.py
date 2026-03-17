"""
admin.py

Protected admin endpoints. Secured by X-Admin-Key header matched against
the ADMIN_SECRET_KEY environment variable. Never expose this key publicly.
"""

import logging
import os
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr

from db.supabase_client import get_client

logger = logging.getLogger(__name__)
router = APIRouter()

ADMIN_KEY       = os.environ.get("ADMIN_SECRET_KEY", "")
RESEND_API_KEY  = os.environ.get("RESEND_API_KEY", "")
RESEND_FROM     = os.environ.get("RESEND_FROM_EMAIL", "noreply@passiveclip.com")

PLAN_LIMITS = {"trial": 100, "creator": 100, "pro": None}


def _check_key(request: Request):
    if not ADMIN_KEY:
        raise HTTPException(status_code=500, detail="ADMIN_SECRET_KEY not configured on server.")
    if request.headers.get("X-Admin-Key") != ADMIN_KEY:
        raise HTTPException(status_code=401, detail="Invalid admin key.")


def _current_month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


class InviteBody(BaseModel):
    email: EmailStr


class AdjustRendersBody(BaseModel):
    user_id: str
    action: str   # "reset" | "add"
    amount: Optional[int] = None


# ─── Invite management ────────────────────────────────────────────────────────

@router.post("/admin/invite")
async def add_invite(body: InviteBody, request: Request):
    """Insert an email into trial_invites. Idempotent."""
    _check_key(request)
    email = body.email.lower()
    sb = get_client()

    existing = (
        sb.table("trial_invites")
        .select("email, claimed")
        .eq("email", email)
        .execute()
    )
    if existing.data:
        status = "claimed" if existing.data[0]["claimed"] else "unclaimed"
        return {"added": False, "status": status, "message": f"{email} already in trial_invites ({status})."}

    sb.table("trial_invites").insert({"email": email}).execute()
    logger.info("Admin added trial invite: %s", email)
    return {"added": True, "status": "unclaimed", "message": f"{email} added to trial."}


@router.delete("/admin/invite")
async def delete_invite(body: InviteBody, request: Request):
    """Remove an email from trial_invites."""
    _check_key(request)
    email = body.email.lower()
    sb = get_client()
    sb.table("trial_invites").delete().eq("email", email).execute()
    logger.info("Admin removed trial invite: %s", email)
    return {"deleted": True}


# ─── Users list (enriched) ───────────────────────────────────────────────────

@router.get("/admin/users")
async def list_users(request: Request):
    """
    Return all trial invites enriched with subscription + usage data for signed-up users.
    """
    _check_key(request)
    sb = get_client()

    invites = (
        sb.table("trial_invites")
        .select("email, claimed, created_at")
        .order("created_at", desc=True)
        .execute()
        .data or []
    )

    # Build email → user_id map from Supabase auth
    email_to_uid: dict = {}
    try:
        auth_users = sb.auth.admin.list_users()
        for u in (auth_users or []):
            if getattr(u, "email", None):
                email_to_uid[u.email.lower()] = u.id
    except Exception as exc:
        logger.warning("Could not fetch auth users: %s", exc)

    # Subscriptions keyed by user_id
    subs = {
        s["user_id"]: s
        for s in (sb.table("subscriptions").select("user_id, plan, status, trial_expires_at").execute().data or [])
    }

    # Current-month usage keyed by user_id
    usage = {
        u["user_id"]: u["render_count"]
        for u in (
            sb.table("usage")
            .select("user_id, render_count")
            .eq("month", _current_month())
            .execute()
            .data or []
        )
    }

    # Total jobs per user
    job_counts: dict = {}
    last_job: dict = {}
    for j in (
        sb.table("jobs")
        .select("user_id, created_at")
        .neq("status", "deleted")
        .order("created_at", desc=True)
        .limit(500)
        .execute()
        .data or []
    ):
        uid = j["user_id"]
        job_counts[uid] = job_counts.get(uid, 0) + 1
        if uid not in last_job:
            last_job[uid] = j["created_at"]

    result = []
    for inv in invites:
        entry: dict = {**inv, "user_id": None, "plan": None, "render_count": None,
                       "render_limit": None, "trial_expires_at": None,
                       "last_job_at": None, "total_jobs": None}
        uid = email_to_uid.get(inv["email"].lower())
        if uid:
            sub  = subs.get(uid, {})
            plan = sub.get("plan", "trial")
            entry.update({
                "user_id":          uid,
                "plan":             plan,
                "render_count":     usage.get(uid, 0),
                "render_limit":     PLAN_LIMITS.get(plan),
                "trial_expires_at": sub.get("trial_expires_at"),
                "last_job_at":      last_job.get(uid),
                "total_jobs":       job_counts.get(uid, 0),
            })
        result.append(entry)

    return {"invites": result}


# ─── Send invite email ────────────────────────────────────────────────────────

@router.post("/admin/send-invite")
async def send_invite_email(body: InviteBody, request: Request):
    """Send an invite email via Resend."""
    _check_key(request)
    if not RESEND_API_KEY:
        raise HTTPException(status_code=500, detail="RESEND_API_KEY not configured.")

    email = body.email.lower()
    html = f"""
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;background:#1c1917;color:#e7e5e4;padding:40px;border-radius:16px;">
      <div style="margin-bottom:28px;">
        <span style="color:#f59e0b;font-size:22px;font-weight:700;">PassiveClip</span>
      </div>
      <h1 style="color:#f5f5f4;font-size:20px;font-weight:700;margin:0 0 12px;">You've been invited.</h1>
      <p style="color:#a8a29e;font-size:15px;line-height:1.7;margin:0 0 28px;">
        You've been given access to PassiveClip — a tool for generating short-form
        philosophy and mindset content at scale using AI-curated visuals.
      </p>
      <a href="https://passiveclip.com"
         style="display:inline-block;background:#f59e0b;color:#000;font-weight:700;
                padding:13px 28px;border-radius:10px;text-decoration:none;font-size:15px;">
        Get started →
      </a>
      <p style="color:#57534e;font-size:12px;margin-top:32px;line-height:1.6;">
        Sign up using this exact email address: <strong style="color:#78716c;">{email}</strong><br>
        If you didn't expect this, you can ignore it.
      </p>
    </div>
    """

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json={"from": RESEND_FROM, "to": [email],
                  "subject": "You've been invited to PassiveClip", "html": html},
            timeout=10,
        )

    if not resp.is_success:
        logger.error("Resend error %d: %s", resp.status_code, resp.text)
        raise HTTPException(status_code=500, detail=f"Email failed: {resp.text}")

    logger.info("Invite email sent to %s", email)
    return {"sent": True, "message": f"Invite sent to {email}"}


# ─── Render adjustment ────────────────────────────────────────────────────────

@router.post("/admin/adjust-renders")
async def adjust_renders(body: AdjustRendersBody, request: Request):
    """
    Adjust a user's render count for the current month.
    action='reset'  → set render_count to 0 (full allowance restored)
    action='add'    → subtract `amount` from render_count (floor 0)
    """
    _check_key(request)
    sb = get_client()
    month = _current_month()

    row = (
        sb.table("usage")
        .select("render_count")
        .eq("user_id", body.user_id)
        .eq("month", month)
        .execute()
    )
    current = row.data[0]["render_count"] if row.data else 0

    if body.action == "reset":
        new_count = 0
    elif body.action == "add":
        new_count = max(0, current - (body.amount or 0))
    else:
        raise HTTPException(status_code=400, detail="action must be 'reset' or 'add'")

    if row.data:
        sb.table("usage").update({"render_count": new_count}).eq("user_id", body.user_id).eq("month", month).execute()
    else:
        sb.table("usage").insert({"user_id": body.user_id, "month": month, "render_count": new_count}).execute()

    logger.info("Admin adjusted renders for %s: %d → %d", body.user_id, current, new_count)
    return {"updated": True, "render_count": new_count}
