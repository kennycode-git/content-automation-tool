"""ElevenLabs voiceover generation and video muxing."""

from __future__ import annotations

import logging
import os
import subprocess
from typing import Any

import requests

from services.video_builder import _FONTS_DIR, _build_drawtext

logger = logging.getLogger(__name__)

CURATED_ELEVENLABS_VOICES: list[dict[str, str]] = [
    {"id": "21m00Tcm4TlvDq8ikWAM", "label": "Rachel", "tone": "calm, clear narration"},
    {"id": "AZnzlk1XvdvUeBnXmlld", "label": "Domi", "tone": "confident and warm"},
    {"id": "EXAVITQu4vr4xnSDxMaL", "label": "Bella", "tone": "soft, intimate storytelling"},
    {"id": "ErXwobaYiN019PkySvjV", "label": "Antoni", "tone": "steady documentary voice"},
    {"id": "MF3mGyEYCl7XYWbV9V6O", "label": "Elli", "tone": "bright, thoughtful delivery"},
    {"id": "TxGEqnHWrfWFTfGW9XjX", "label": "Josh", "tone": "deep reflective narration"},
    {"id": "VR6AewLTigWG4xSOukaG", "label": "Arnold", "tone": "cinematic and grounded"},
    {"id": "pNInz6obpgDQGcFmaJgB", "label": "Adam", "tone": "low, authoritative voice"},
    {"id": "yoZ06aMxZJJ28mfd3POQ", "label": "Sam", "tone": "natural conversational read"},
    {"id": "29vD33N1CtxCmqQRPOHJ", "label": "Drew", "tone": "measured, dramatic cadence"},
    {"id": "ThT5KcBeYPX3keUQqHPh", "label": "Dorothy", "tone": "warm, poetic tone"},
    {"id": "CYw3kZ02Hs0563khs1Fj", "label": "Dave", "tone": "mature reflective voice"},
]

CURATED_VOICE_IDS = {voice["id"] for voice in CURATED_ELEVENLABS_VOICES}


def build_voiceover_script(ai_voiceover: dict[str, Any], *, batch_title: str | None, search_terms: list[str]) -> str:
    """Resolve the final narration text from explicit copy or a conservative fallback."""
    explicit = (ai_voiceover.get("script_text") or "").strip()
    if explicit:
        return explicit[:2000]

    title = (batch_title or "This short reflection").strip()
    terms = ", ".join(t.strip() for t in search_terms[:3] if t.strip())
    if terms:
        return f"{title}. A visual meditation on {terms}."
    return title


def validate_voiceover_config(ai_voiceover: dict[str, Any]) -> None:
    """Keep v1 limited to curated voices unless explicitly enabled server-side."""
    if not ai_voiceover.get("enabled"):
        return
    voice_id = (ai_voiceover.get("voice_id") or "").strip()
    if not voice_id:
        raise RuntimeError("Choose a narration voice before generating.")
    allow_custom = os.environ.get("ELEVENLABS_ALLOW_CUSTOM_VOICE_IDS") == "true"
    if not allow_custom and voice_id not in CURATED_VOICE_IDS:
        raise RuntimeError("This voice is not in the curated voice list yet.")


def generate_elevenlabs_audio(ai_voiceover: dict[str, Any], script: str, audio_path: str) -> None:
    """Generate MP3 narration from ElevenLabs."""
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise RuntimeError("ElevenLabs API key is not configured.")

    validate_voiceover_config(ai_voiceover)
    voice_id = ai_voiceover["voice_id"].strip()
    model_id = ai_voiceover.get("model_id") or "eleven_multilingual_v2"
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    payload = {
        "text": script,
        "model_id": model_id,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.2,
            "use_speaker_boost": True,
        },
    }
    headers = {
        "xi-api-key": api_key,
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
    }
    with requests.post(url, json=payload, headers=headers, timeout=120, stream=True) as response:
        response.raise_for_status()
        with open(audio_path, "wb") as fh:
            for chunk in response.iter_content(chunk_size=1024 * 128):
                if chunk:
                    fh.write(chunk)


def _probe_duration(media_path: str) -> float:
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        media_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed for generated voiceover: {result.stderr[-500:]}")
    return max(0.1, float(result.stdout.strip()))


def _voiceover_caption_overlay(script: str, ai_voiceover: dict[str, Any]) -> dict[str, Any]:
    style = ai_voiceover.get("caption_style") or "bold_center"
    base = {
        "enabled": True,
        "text": script,
        "color": "white",
        "custom_color": None,
        "background_box": True,
        "outline": True,
        "position": "middle-center",
        "alignment": "center",
        "margin_pct": 0.08,
    }
    styles = {
        "bold_center": {"font": "outfit", "font_size_pct": 0.052},
        "serif_quote": {"font": "cormorant", "font_size_pct": 0.047, "color": "cream"},
        "cinematic_low": {"font": "cinzel", "font_size_pct": 0.04, "position": "bottom-center"},
        "mono_focus": {"font": "space_mono", "font_size_pct": 0.035},
        "warm_block": {"font": "josefin", "font_size_pct": 0.05, "color": "gold"},
    }
    return {**base, **styles.get(style, styles["bold_center"])}


def mux_voiceover(
    *,
    input_video: str,
    audio_file: str,
    output_video: str,
    width: int,
    height: int,
    fps: int,
    ai_voiceover: dict[str, Any],
    script: str,
) -> dict[str, Any]:
    """Loop/trim the video to narration length, attach audio, and optionally burn captions."""
    duration = _probe_duration(audio_file)
    vf = None
    if ai_voiceover.get("subtitles_enabled", True) and ai_voiceover.get("subtitle_format", "burned") == "burned":
        overlay = _voiceover_caption_overlay(script, ai_voiceover)
        vf = _build_drawtext(overlay, width, height)

    cmd = [
        "ffmpeg", "-y",
        "-stream_loop", "-1",
        "-i", input_video,
        "-i", audio_file,
        "-t", f"{duration:.3f}",
        "-map", "0:v:0",
        "-map", "1:a:0",
    ]
    if vf:
        cmd += ["-vf", vf]
    cmd += [
        "-r", str(fps),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        "-shortest",
        output_video,
    ]

    logger.info("Muxing ElevenLabs voiceover into %s", output_video)
    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=max(90, int(duration * 8)),
        cwd=_FONTS_DIR if vf and os.path.isdir(_FONTS_DIR) else None,
    )
    log = result.stdout.splitlines()
    if result.returncode != 0:
        logger.error("Voiceover mux failed. Last 40 lines:\n%s", "\n".join(log[-40:]))
    return {"returncode": result.returncode, "log": log, "duration": duration}


def apply_ai_voiceover(
    *,
    input_video: str,
    output_video: str,
    audio_file: str,
    width: int,
    height: int,
    fps: int,
    ai_voiceover: dict[str, Any],
    batch_title: str | None,
    search_terms: list[str],
) -> float:
    """Generate narration audio and return the final video duration."""
    script = build_voiceover_script(ai_voiceover, batch_title=batch_title, search_terms=search_terms)
    generate_elevenlabs_audio(ai_voiceover, script, audio_file)
    result = mux_voiceover(
        input_video=input_video,
        audio_file=audio_file,
        output_video=output_video,
        width=width,
        height=height,
        fps=fps,
        ai_voiceover=ai_voiceover,
        script=script,
    )
    if result["returncode"] != 0:
        raise RuntimeError("Voiceover mux failed. Check server logs.")
    return float(result["duration"])
