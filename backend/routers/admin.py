"""
admin.py

Protected admin endpoints. Secured by X-Admin-Key header matched against
the ADMIN_SECRET_KEY environment variable. Never expose this key publicly.
"""

import logging
import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr

from db.supabase_client import get_client

logger = logging.getLogger(__name__)
router = APIRouter()

ADMIN_KEY = os.environ.get("ADMIN_SECRET_KEY", "")


def _check_key(request: Request):
    if not ADMIN_KEY:
        raise HTTPException(status_code=500, detail="ADMIN_SECRET_KEY not configured on server.")
    if request.headers.get("X-Admin-Key") != ADMIN_KEY:
        raise HTTPException(status_code=401, detail="Invalid admin key.")


class InviteBody(BaseModel):
    email: EmailStr


@router.post("/admin/invite")
async def add_invite(body: InviteBody, request: Request):
    """Insert an email into trial_invites. Idempotent — safe to call twice."""
    _check_key(request)
    email = body.email.lower()
    sb = get_client()

    existing = (
        sb.table("trial_invites")
        .select("email, claimed")
        .eq("email", email)
        .maybe_single()
        .execute()
    )

    if existing.data:
        status = "claimed" if existing.data["claimed"] else "unclaimed"
        return {"added": False, "status": status, "message": f"{email} already in trial_invites ({status})."}

    sb.table("trial_invites").insert({"email": email}).execute()
    logger.info("Admin added trial invite: %s", email)
    return {"added": True, "status": "unclaimed", "message": f"{email} added to trial."}


@router.get("/admin/invites")
async def list_invites(request: Request):
    """List all trial invites with their status."""
    _check_key(request)
    sb = get_client()
    result = (
        sb.table("trial_invites")
        .select("email, claimed, created_at")
        .order("created_at", desc=True)
        .execute()
    )
    return {"invites": result.data or []}
