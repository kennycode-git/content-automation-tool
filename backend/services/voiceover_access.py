"""Subscription checks for paid voiceover features."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

PAID_VOICEOVER_PLANS = {"creator", "pro"}


def is_paid_voiceover_account(db: Any, user_id: str) -> bool:
    """Return true only for active paid plans, independent of global trial mode."""
    result = (
        db.table("subscriptions")
        .select("status, plan")
        .eq("user_id", user_id)
        .execute()
    )
    sub = result.data[0] if result.data else None
    if not sub:
        return False
    return sub.get("status") == "active" and sub.get("plan") in PAID_VOICEOVER_PLANS


def require_paid_voiceover(db: Any, user_id: str, ai_voiceover: dict | None) -> None:
    """Block ElevenLabs voiceover unless the current user has an active paid plan."""
    if not ai_voiceover or not ai_voiceover.get("enabled"):
        return
    if is_paid_voiceover_account(db, user_id):
        return
    raise HTTPException(
        status_code=403,
        detail={
            "code": "voiceover_upgrade_required",
            "message": "AI voiceover is available on paid plans. Upgrade to enable ElevenLabs narration.",
        },
    )
