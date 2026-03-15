"""
trial_auth.py

Invite-only account claiming for the closed trial period.

Flow:
  1. POST /api/auth/check-invite  — verify email is in trial_invites
     Returns: { status: "not_found" | "unclaimed" | "claimed" }
  2. POST /api/auth/claim-invite  — create Supabase auth user + mark invite claimed
     Frontend then calls supabase.auth.signInWithPassword to get a session.

Security:
- No JWT required — pre-auth endpoints.
- Email normalised to lowercase before lookup.
- claim-invite re-validates invite is unclaimed before creating user (race guard).
- Supabase user creation uses service_role admin API — never exposed to client.
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr

from db.supabase_client import get_client

logger = logging.getLogger(__name__)
router = APIRouter()


class EmailBody(BaseModel):
    email: EmailStr


class ClaimBody(BaseModel):
    email: EmailStr
    password: str


@router.post("/auth/check-invite")
async def check_invite(body: EmailBody):
    """Check whether an email is registered for the trial and whether it has been claimed."""
    email = body.email.lower()
    sb = get_client()
    result = (
        sb.table("trial_invites")
        .select("claimed")
        .eq("email", email)
        .maybe_single()
        .execute()
    )
    if result.data is None:
        return {"status": "not_found"}
    return {"status": "claimed" if result.data["claimed"] else "unclaimed"}


@router.post("/auth/claim-invite")
async def claim_invite(body: ClaimBody):
    """
    Create a Supabase auth user for an invited email and mark the invite as claimed.
    Frontend signs in immediately after with supabase.auth.signInWithPassword.
    """
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")

    email = body.email.lower()
    sb = get_client()

    # Re-verify invite is still unclaimed (guard against double-submit)
    result = (
        sb.table("trial_invites")
        .select("claimed")
        .eq("email", email)
        .maybe_single()
        .execute()
    )
    if result.data is None:
        raise HTTPException(status_code=403, detail="Email not registered for trial.")
    if result.data["claimed"]:
        raise HTTPException(
            status_code=409,
            detail="Account already activated — please sign in.",
        )

    # Create Supabase auth user via admin API
    try:
        sb.auth.admin.create_user({
            "email": email,
            "password": body.password,
            "email_confirm": True,  # skip email confirmation step
        })
    except Exception as exc:
        err = str(exc).lower()
        if "already registered" in err or "already exists" in err or "user already" in err:
            # Pre-existing auth user — mark invite claimed so they can sign in normally
            sb.table("trial_invites").update({"claimed": True}).eq("email", email).execute()
            raise HTTPException(
                status_code=409,
                detail="An account with this email already exists. Please sign in, or use 'Forgot password' to reset it.",
            )
        logger.exception("Failed to create trial user for %s", email)
        raise HTTPException(status_code=500, detail="Failed to activate account. Please try again.")

    # Mark invite as claimed
    sb.table("trial_invites").update({"claimed": True}).eq("email", email).execute()

    return {"success": True}
