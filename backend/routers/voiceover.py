"""Voiceover metadata endpoints."""

from fastapi import APIRouter, Depends

from routers.auth import get_current_user_id
from services.voiceover import CURATED_ELEVENLABS_VOICES

router = APIRouter()


@router.get("/voiceover/voices")
async def list_voiceover_voices(user_id: str = Depends(get_current_user_id)):
    """Return curated ElevenLabs voices available in v1."""
    return {"voices": CURATED_ELEVENLABS_VOICES}
