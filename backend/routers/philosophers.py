"""
philosophers.py

User-defined philosopher image management.
Each user can create custom philosopher entries and upload images for them.
Images stored in user-uploads bucket at {user_id}/philosophers/{key}/.

Requires DB table:
  CREATE TABLE user_philosophers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    key TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, key)
  );
"""

import logging
import re
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from db.supabase_client import get_client
from models.schemas import UserPhilosopherCreate, UserPhilosopherResponse
from routers.auth import get_current_user_id
from services.storage import (
    delete_user_philosopher_folder,
    list_user_philosopher_images,
    upload_user_philosopher_image,
)

logger = logging.getLogger(__name__)
router = APIRouter()

_MAX_IMAGES = 10


def _name_to_key(name: str) -> str:
    key = name.lower().strip()
    key = re.sub(r"['\-\u2013\u2014]", "", key)
    key = re.sub(r"[^a-z0-9]+", "_", key)
    return key.strip("_") or "philosopher"


@router.get("/philosophers", response_model=List[UserPhilosopherResponse])
async def list_philosophers(user_id: str = Depends(get_current_user_id)):
    client = get_client()
    result = client.table("user_philosophers").select("*").eq("user_id", user_id).order("created_at").execute()
    out = []
    for row in (result.data or []):
        images = list_user_philosopher_images(user_id, row["key"])
        out.append(UserPhilosopherResponse(
            key=row["key"],
            name=row["name"],
            image_count=len(images),
            created_at=row["created_at"],
        ))
    return out


@router.post("/philosophers", response_model=UserPhilosopherResponse)
async def create_philosopher(body: UserPhilosopherCreate, user_id: str = Depends(get_current_user_id)):
    key = _name_to_key(body.name)
    client = get_client()
    try:
        result = client.table("user_philosophers").insert({
            "user_id": user_id,
            "name": body.name.strip(),
            "key": key,
        }).execute()
    except Exception as e:
        if "unique" in str(e).lower() or "duplicate" in str(e).lower():
            raise HTTPException(status_code=409, detail="A philosopher with this name already exists.")
        raise HTTPException(status_code=500, detail="Could not create philosopher.")
    row = result.data[0]
    return UserPhilosopherResponse(key=row["key"], name=row["name"], image_count=0, created_at=row["created_at"])


@router.delete("/philosophers/{key}", status_code=204)
async def delete_philosopher(key: str, user_id: str = Depends(get_current_user_id)):
    client = get_client()
    result = client.table("user_philosophers").select("id").eq("user_id", user_id).eq("key", key).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Philosopher not found.")
    try:
        delete_user_philosopher_folder(user_id, key)
    except Exception as e:
        logger.warning("Could not delete storage for %s/%s: %s", user_id, key, e)
    client.table("user_philosophers").delete().eq("user_id", user_id).eq("key", key).execute()


@router.post("/philosophers/{key}/images")
async def upload_philosopher_images(
    key: str,
    files: List[UploadFile] = File(...),
    user_id: str = Depends(get_current_user_id),
):
    client = get_client()
    result = client.table("user_philosophers").select("id").eq("user_id", user_id).eq("key", key).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Philosopher not found.")

    existing = list_user_philosopher_images(user_id, key)
    slots = _MAX_IMAGES - len(existing)
    if slots <= 0:
        raise HTTPException(status_code=400, detail=f"Maximum {_MAX_IMAGES} images per philosopher reached.")

    uploaded = 0
    for f in files[:slots]:
        if not f.content_type or not f.content_type.startswith("image/"):
            continue
        data = await f.read()
        if len(data) > 10 * 1024 * 1024:
            continue
        try:
            upload_user_philosopher_image(user_id, key, f.filename or f"img{uploaded + 1}.jpg", data)
            uploaded += 1
        except Exception as e:
            logger.warning("Failed to upload philosopher image: %s", e)
    return {"uploaded": uploaded}
