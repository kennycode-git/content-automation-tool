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
    email = body.email.strip().lower()
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
    email = body.email.strip().lower()
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
    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<div style="background:#fff;border-radius:4px;overflow:hidden;font-family:Arial,sans-serif;max-width:600px">
  <div style="background:#111;padding:28px 40px;text-align:left">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:0">
      <img src="https://www.passiveclip.com/logo.png" alt="" style="height:36px;width:auto;display:block">
      <img src="https://www.passiveclip.com/just%20text.png" alt="PassiveClip" style="height:28px;width:auto;display:block">
    </div>
  </div>
  <div style="height:3px;background:#F5A623"></div>
  <div style="padding:44px 40px 36px;background:#fff">
    <p style="font-size:18px;line-height:1.75;color:#111;margin-bottom:20px;font-family:Arial,sans-serif;font-weight:700">You've been invited to PassiveClip.</p>
    <p style="font-size:15px;line-height:1.75;color:#333;margin-bottom:16px;font-family:Arial,sans-serif">PassiveClip turns a list of keywords into rendered MP4 videos: stock images, colour grades, smooth transitions, all handled automatically.</p>
    <p style="font-size:15px;line-height:1.75;color:#333;margin-bottom:16px;font-family:Arial,sans-serif">It's built for channels that need a steady stream of background video without spending hours in an editor. Accept the invite to set up your account.</p>
    <div style="margin:32px 0">
      <a href="https://www.passiveclip.com/login" style="display:inline-block;background:#F5A623;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:15px 32px;text-decoration:none;border-radius:2px;font-family:Arial,sans-serif;color:#111">Accept invite</a>
    </div>
    <hr style="border:none;border-top:1px solid #eee;margin:32px 0">
    <p style="font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#888;margin-bottom:12px;font-family:Arial,sans-serif">Quick start tutorial</p>
    <a href="https://www.passiveclip.com/tutorial" style="display:block;position:relative;border-radius:4px;overflow:hidden;margin-bottom:24px;text-decoration:none">
      <img src="https://www.passiveclip.com/tutorial-thumb.png" alt="Watch tutorial" style="width:100%;display:block">
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.35)">
        <div style="width:56px;height:56px;border-radius:50%;background:#F5A623;display:flex;align-items:center;justify-content:center">
          <div style="width:0;height:0;border-top:11px solid transparent;border-bottom:11px solid transparent;border-left:18px solid #111;margin-left:4px"></div>
        </div>
      </div>
    </a>
    <hr style="border:none;border-top:1px solid #eee;margin:32px 0">
    <p style="font-size:15px;color:#333;line-height:1.75;margin-bottom:8px;font-family:Arial,sans-serif">Sign in using: <strong>{email}</strong></p>
    <p style="font-size:15px;color:#333;line-height:1.75;margin-bottom:16px;font-family:Arial,sans-serif">This invite expires in 48 hours. If you weren't expecting this, you can safely ignore it.</p>
  </div>
  <div style="background:#111;padding:20px 40px">
    <p style="font-size:11px;color:#555;line-height:1.8;font-family:'Courier New',monospace;letter-spacing:0.04em">PassiveClip · Automated video for content creators</p>
  </div>
</div>
</body>
</html>"""

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
