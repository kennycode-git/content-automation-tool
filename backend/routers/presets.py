"""
presets.py

GET    /api/presets       — list user's saved presets
POST   /api/presets       — save a new preset
DELETE /api/presets/{id}  — delete a preset

Security:
- All queries scoped to verified JWT user_id — users cannot read/delete each other's presets.
- Preset name capped at 60 chars in DB CHECK constraint; validated here too.
- settings stored as JSONB — validated as dict by Pydantic.
"""

import logging
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db.supabase_client import get_client
from routers.auth import get_current_user_id

logger = logging.getLogger(__name__)
router = APIRouter()


class PresetCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    settings: Dict[str, Any]


class PresetResponse(BaseModel):
    id: str
    name: str
    settings: Dict[str, Any]
    created_at: str


@router.get("/presets", response_model=List[PresetResponse])
async def list_presets(user_id: str = Depends(get_current_user_id)):
    db = get_client()
    result = (
        db.table("user_presets")
        .select("id, name, settings, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=False)
        .execute()
    )
    return [
        PresetResponse(
            id=p["id"],
            name=p["name"],
            settings=p["settings"],
            created_at=p["created_at"],
        )
        for p in (result.data or [])
    ]


@router.post("/presets", response_model=PresetResponse, status_code=201)
async def create_preset(
    body: PresetCreate,
    user_id: str = Depends(get_current_user_id),
):
    db = get_client()
    result = (
        db.table("user_presets")
        .insert({"user_id": user_id, "name": body.name, "settings": body.settings})
        .execute()
    )
    p = result.data[0]
    logger.info("Preset '%s' created for user %s", body.name, user_id)
    return PresetResponse(id=p["id"], name=p["name"], settings=p["settings"], created_at=p["created_at"])


@router.delete("/presets/{preset_id}", status_code=204)
async def delete_preset(
    preset_id: str,
    user_id: str = Depends(get_current_user_id),
):
    db = get_client()
    result = (
        db.table("user_presets")
        .delete()
        .eq("id", preset_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Preset not found.")
    logger.info("Preset %s deleted by user %s", preset_id, user_id)
