"""
layered_builder.py

Builds a layered video:
  background Pexels video(s) + semi-transparent foreground image slideshow,
  with optional text overlay burned on top last.

Pipeline:
  1. Download background video(s) from Pexels
  2. Build background track (loop single / crossfade-concat multiple) to target duration
  3. Build foreground image slideshow at layered speed (via existing render_slideshow)
  4. Composite: bg + fg with configurable opacity → output
  5. Text overlay burned in during compositing via drawtext filter

Grade target:
  - "foreground" : images already graded by job_manager before we're called; bg ungraded
  - "background" : bg gets ffmpeg eq/hue filters; fg images passed in ungraded
  - "both"       : images graded by job_manager; bg also gets ffmpeg filters
"""

import logging
import os
import subprocess
import tempfile
from typing import Any, Dict, List, Optional

import httpx

from services.video_builder import _build_drawtext, render_slideshow  # noqa: PLC0415

logger = logging.getLogger(__name__)

_ALLOWED_PREFIX = "https://videos.pexels.com/"
_FONTS_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "fonts"))

# Approximate grade defaults for named themes (mirrors frontend THEME_GRADE_DEFAULTS)
_THEME_GRADE_DEFAULTS: Dict[str, Dict[str, float]] = {
    "dark":     {"brightness": 0.80, "contrast": 1.20, "saturation": 0.70, "exposure": 0.85, "warmth": 0.00, "tint": 0.00, "hue_shift": 0},
    "sepia":    {"brightness": 0.90, "contrast": 1.10, "saturation": 0.50, "exposure": 0.90, "warmth": 0.60, "tint": 0.10, "hue_shift": 10},
    "warm":     {"brightness": 1.00, "contrast": 1.05, "saturation": 1.10, "exposure": 0.95, "warmth": 0.50, "tint": 0.05, "hue_shift": 5},
    "low_exp":  {"brightness": 0.65, "contrast": 1.30, "saturation": 0.80, "exposure": 0.70, "warmth": 0.00, "tint": 0.00, "hue_shift": 0},
    "grey":     {"brightness": 0.90, "contrast": 1.10, "saturation": 0.15, "exposure": 0.90, "warmth": 0.00, "tint": 0.00, "hue_shift": 0},
    "blue":     {"brightness": 0.85, "contrast": 1.15, "saturation": 0.80, "exposure": 0.85, "warmth": -0.30, "tint": -0.10, "hue_shift": -15},
    "red":      {"brightness": 0.88, "contrast": 1.20, "saturation": 1.30, "exposure": 0.88, "warmth": 0.10, "tint": 0.00, "hue_shift": 0},
    "bw":       {"brightness": 0.90, "contrast": 1.20, "saturation": 0.00, "exposure": 0.90, "warmth": 0.00, "tint": 0.00, "hue_shift": 0},
    "midnight": {"brightness": 0.60, "contrast": 1.30, "saturation": 0.80, "exposure": 0.70, "warmth": -0.40, "tint": -0.15, "hue_shift": -15},
    "dusk":     {"brightness": 0.75, "contrast": 1.20, "saturation": 0.90, "exposure": 0.80, "warmth": 0.20, "tint": 0.05, "hue_shift": 10},
    "mocha":    {"brightness": 0.90, "contrast": 1.15, "saturation": 0.60, "exposure": 0.90, "warmth": 0.40, "tint": 0.10, "hue_shift": 0},
    "noir":     {"brightness": 0.75, "contrast": 1.50, "saturation": 0.15, "exposure": 0.75, "warmth": -0.10, "tint": 0.05, "hue_shift": 0},
}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _run(cmd: List[str], cwd: Optional[str] = None, timeout: int = 300) -> None:
    logger.debug("ffmpeg: %s", " ".join(cmd[:10]))
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd)
    if r.returncode != 0:
        logger.error("ffmpeg stderr: %s", r.stderr[-600:])
        raise RuntimeError(f"ffmpeg failed (code {r.returncode}): {r.stderr[-200:]}")


def _get_duration(path: str) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True, timeout=15,
    )
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 10.0


def _download_bg_videos(urls: List[str], tmp_dir: str) -> List[str]:
    paths: List[str] = []
    for i, url in enumerate(urls):
        if not url.startswith(_ALLOWED_PREFIX):
            raise ValueError(f"Invalid background video URL: {url!r}")
        logger.info("Downloading background video %d/%d", i + 1, len(urls))
        path = os.path.join(tmp_dir, f"bg_{i:03d}.mp4")
        with httpx.stream("GET", url, timeout=120.0, follow_redirects=True) as resp:
            resp.raise_for_status()
            with open(path, "wb") as f:
                for chunk in resp.iter_bytes(chunk_size=65536):
                    f.write(chunk)
        paths.append(path)
    return paths


def _build_bg_track(
    bg_paths: List[str],
    output: str,
    width: int,
    height: int,
    fps: int,
    total_seconds: float,
    crossfade_dur: float,
) -> None:
    """Loop single video or crossfade-concat multiple, trim/pad to total_seconds."""
    scale = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1,fps={fps}"

    if len(bg_paths) == 1:
        _run([
            "ffmpeg", "-y", "-stream_loop", "-1", "-i", bg_paths[0],
            "-vf", scale, "-t", str(total_seconds), "-an", output,
        ])
        return

    # Multiple videos: scale each, chain xfade transitions, then loop if still short
    durations = [_get_duration(p) for p in bg_paths]
    inputs: List[str] = []
    for p in bg_paths:
        inputs += ["-i", p]

    filter_parts: List[str] = []
    for i in range(len(bg_paths)):
        filter_parts.append(f"[{i}:v]{scale}[v{i}]")

    # Chain xfades: v0 × v1 → m1, m1 × v2 → m2 …
    chain = "[v0]"
    offset = 0.0
    for i in range(1, len(bg_paths)):
        offset += durations[i - 1] - crossfade_dur
        out = f"[m{i}]" if i < len(bg_paths) - 1 else "[bgchain]"
        filter_parts.append(
            f"{chain}[v{i}]xfade=transition=fade:duration={crossfade_dur:.2f}:offset={offset:.3f}{out}"
        )
        chain = f"[m{i}]"

    combined_dur = sum(durations) - crossfade_dur * (len(bg_paths) - 1)
    filter_str = ";".join(filter_parts)

    if combined_dur >= total_seconds:
        _run(["ffmpeg", "-y"] + inputs + [
            "-filter_complex", filter_str, "-map", "[bgchain]",
            "-t", str(total_seconds), "-an", output,
        ])
    else:
        # Not enough footage — build combined then loop it
        combined = output + "_combined.mp4"
        _run(["ffmpeg", "-y"] + inputs + [
            "-filter_complex", filter_str, "-map", "[bgchain]", "-an", combined,
        ])
        _run([
            "ffmpeg", "-y", "-stream_loop", "-1", "-i", combined,
            "-t", str(total_seconds), "-c", "copy", output,
        ])
        os.remove(combined)


def _grade_vf(params: Dict[str, float]) -> str:
    """Approximate colour grade as an ffmpeg video filter string for background video."""
    b = params.get("brightness", 1.0) * params.get("exposure", 1.0)
    c = params.get("contrast", 1.0)
    s = params.get("saturation", 1.0)
    h = params.get("hue_shift", 0.0)
    warmth = params.get("warmth", 0.0)

    # ffmpeg eq: brightness offset (-1..1, 0=neutral), contrast multiplier, saturation 0..3
    parts = [f"eq=brightness={b - 1:.3f}:contrast={c:.3f}:saturation={s:.3f}"]
    if abs(h) > 0.5:
        parts.append(f"hue=h={h:.1f}")
    if warmth > 0.02:
        parts.append(f"colorbalance=rs={warmth * 0.3:.3f}:gs={warmth * 0.1:.3f}:bs={-warmth * 0.3:.3f}")
    elif warmth < -0.02:
        parts.append(f"colorbalance=rs={warmth * 0.2:.3f}:gs=0:bs={-warmth * 0.2:.3f}")
    return ",".join(parts)


def _resolve_bg_grade(color_theme: str, custom_grade_params: Optional[Dict]) -> Optional[Dict]:
    """Return grade params dict for background, or None if no grade needed."""
    if color_theme == "none":
        return None
    if color_theme == "custom" and custom_grade_params:
        return custom_grade_params
    return _THEME_GRADE_DEFAULTS.get(color_theme)


# ── Main compositing step ───────────────────────────────────────────────────────

def _composite(
    bg_path: str,
    fg_path: str,
    output_file: str,
    opacity: float,
    width: int,
    height: int,
    fps: int,
    total_seconds: float,
    bg_grade_params: Optional[Dict],
    text_overlay: Optional[Dict],
) -> None:
    """Overlay fg on bg with opacity, apply background grade, burn text overlay."""
    alpha = max(0.0, min(1.0, opacity))
    parts: List[str] = []

    if bg_grade_params:
        gf = _grade_vf(bg_grade_params)
        parts.append(f"[0:v]{gf}[bg]")
    else:
        parts.append("[0:v]copy[bg]")

    parts.append(f"[1:v]format=rgba,colorchannelmixer=aa={alpha:.3f}[fg]")

    has_text = (text_overlay and text_overlay.get("enabled")
                and text_overlay.get("text", "").strip())

    if has_text:
        parts.append("[bg][fg]overlay=0:0:shortest=1[comp]")
        dt = _build_drawtext(text_overlay, width, height)
        if dt:
            parts.append(f"[comp]{dt}[out]")
            map_label = "[out]"
        else:
            map_label = "[comp]"
    else:
        parts.append("[bg][fg]overlay=0:0:shortest=1[out]")
        map_label = "[out]"

    _run(
        [
            "ffmpeg", "-y",
            "-i", bg_path,
            "-i", fg_path,
            "-filter_complex", ";".join(parts),
            "-map", map_label,
            "-t", str(total_seconds),
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-pix_fmt", "yuv420p", "-an",
            output_file,
        ],
        cwd=_FONTS_DIR if has_text else None,
    )


# ── Public entry point ─────────────────────────────────────────────────────────

def render_layered_sync(
    *,
    input_folder: str,
    output_file: str,
    bg_urls: List[str],
    opacity: float,
    fg_speed: float,
    color_theme: str,
    custom_grade_params: Optional[Dict],
    grade_target: str,          # "foreground" | "background" | "both"
    crossfade_dur: float,
    width: int,
    height: int,
    fps: int,
    total_seconds: float,
    allow_repeats: bool,
    text_overlay: Optional[Dict],
) -> Dict[str, Any]:
    """
    Full layered render. Runs synchronously — call via asyncio.to_thread in job_manager.
    Returns {"returncode": int, "log": list[str]}.
    """
    log: List[str] = []

    with tempfile.TemporaryDirectory() as tmp:
        try:
            # 1. Download background video(s)
            log.append(f"Downloading {len(bg_urls)} background video(s)…")
            bg_paths = _download_bg_videos(bg_urls, tmp)

            # 2. Build background track
            bg_track = os.path.join(tmp, "bg_track.mp4")
            log.append("Building background track…")
            _build_bg_track(bg_paths, bg_track, width, height, fps, total_seconds, crossfade_dur)

            # 3. Build foreground slideshow (images already graded by job_manager if needed)
            fg_slideshow = os.path.join(tmp, "fg_slideshow.mp4")
            log.append(f"Building foreground slideshow ({fg_speed}s/image)…")
            result = render_slideshow(
                input_folder=input_folder,
                output_file=fg_slideshow,
                width=width,
                height=height,
                seconds_per_image=fg_speed,
                fps=fps,
                total_seconds=total_seconds,
                allow_repeats=allow_repeats,
                shuffle=True,
                text_overlay=None,  # text overlay applied in composite step
            )
            if result["returncode"] != 0:
                raise RuntimeError(f"Foreground slideshow failed: {result['log'][-3:]}")

            # 4. Resolve background grade params
            bg_grade: Optional[Dict] = None
            if grade_target in ("background", "both"):
                bg_grade = _resolve_bg_grade(color_theme, custom_grade_params)

            # 5. Composite
            log.append(f"Compositing (fg opacity {opacity:.0%}, grade_target={grade_target})…")
            _composite(
                bg_path=bg_track,
                fg_path=fg_slideshow,
                output_file=output_file,
                opacity=opacity,
                width=width,
                height=height,
                fps=fps,
                total_seconds=total_seconds,
                bg_grade_params=bg_grade,
                text_overlay=text_overlay,
            )
            log.append("Layered render complete.")
            return {"returncode": 0, "log": log}

        except Exception as exc:
            logger.exception("Layered render failed")
            log.append(f"Layered render failed: {exc}")
            return {"returncode": 1, "log": log}
