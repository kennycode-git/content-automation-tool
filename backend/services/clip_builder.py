"""
clip_builder.py

Renders an MP4 from a list of trimmed Pexels video clips using ffmpeg filter_complex.
Supports three transitions: cut, fade_black, crossfade.
Colour grading is applied as ffmpeg eq/hue/colorchannelmixer filters per clip.
Text overlay reuses _build_drawtext() from video_builder.py.
"""

import logging
import os
import subprocess
from dataclasses import dataclass
from typing import Dict, List, Optional

from services.video_builder import _build_drawtext, _FONTS_DIR

logger = logging.getLogger(__name__)


@dataclass
class ClipSpec:
    local_path: str
    trim_start: float   # seconds; 0.0 = from beginning
    trim_end: float     # seconds; 0.0 = use full duration
    duration: int       # original clip duration in seconds (from Pexels metadata)


# ffmpeg filter fragments for colour grading, applied per-clip in filter_complex.
# These are approximate visual equivalents of the PIL-based image_grader grades.
CLIP_GRADE_FILTERS: Dict[str, str] = {
    "none":    "",
    "dark":    "eq=brightness=-0.15:contrast=1.2:saturation=0.7",
    "sepia":   "eq=saturation=0.3:contrast=1.1,colorchannelmixer=rr=1.1:rb=0.1:gr=0.05:br=-0.1",
    "warm":    "eq=brightness=0.05:contrast=1.05:saturation=1.3",
    "low_exp": "eq=brightness=-0.25:contrast=1.15:saturation=0.85",
    "grey":    "eq=saturation=0.1:contrast=1.1",
    "blue":    "eq=saturation=1.1,colorchannelmixer=rb=0.1:gb=0.05",
    "red":     "eq=saturation=1.15,colorchannelmixer=rr=1.1:gr=0.0:br=0.0",
    "bw":      "eq=saturation=0",
}


def _clip_duration(spec: ClipSpec) -> float:
    """Return effective duration of a clip after trimming."""
    end = spec.trim_end if spec.trim_end > 0 else float(spec.duration)
    return max(0.1, end - spec.trim_start)


def _build_filter_complex(
    specs: List[ClipSpec],
    width: int,
    height: int,
    transition: str,
    transition_duration: float,
    color_theme: str,
    text_overlay: Optional[dict],
) -> tuple[str, str]:
    """
    Build the ffmpeg -filter_complex string and the final output label.
    Returns (filter_complex_str, output_label).
    """
    grade = CLIP_GRADE_FILTERS.get(color_theme, "")
    grade_suffix = f",{grade}" if grade else ""
    n = len(specs)

    parts: List[str] = []

    # Scale + crop + grade each input
    for i in range(n):
        parts.append(
            f"[{i}:v]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},setsar=1{grade_suffix}[v{i}]"
        )

    # Stitch clips together with chosen transition
    if transition == "cut" or n == 1:
        labels = "".join(f"[v{i}]" for i in range(n))
        parts.append(f"{labels}concat=n={n}:v=1:a=0[concat_out]")
        out_label = "[concat_out]"

    elif transition == "fade_black":
        td = transition_duration
        fade_labels: List[str] = []
        for i, spec in enumerate(specs):
            dur = _clip_duration(spec)
            fade_out_st = max(0.0, dur - td)
            # fade out
            parts.append(
                f"[v{i}]fade=t=out:st={fade_out_st:.3f}:d={td:.3f}:color=black[fo{i}]"
            )
            # fade in (skip for first clip to avoid double-fade at start)
            if i == 0:
                parts.append(f"[fo{i}]copy[fv{i}]")
            else:
                parts.append(
                    f"[fo{i}]fade=t=in:st=0:d={td:.3f}:color=black[fv{i}]"
                )
            fade_labels.append(f"[fv{i}]")
        labels = "".join(fade_labels)
        parts.append(f"{labels}concat=n={n}:v=1:a=0[concat_out]")
        out_label = "[concat_out]"

    elif transition == "crossfade":
        td = transition_duration
        durations = [_clip_duration(s) for s in specs]
        # Chain xfade between consecutive clips
        prev_label = "[v0]"
        cumulative = 0.0
        for i in range(1, n):
            cumulative += durations[i - 1] - td
            next_label = f"[v{i}]"
            xfade_out = f"[xf{i}]" if i < n - 1 else "[concat_out]"
            parts.append(
                f"{prev_label}{next_label}xfade=transition=fade:"
                f"duration={td:.3f}:offset={cumulative:.3f}{xfade_out}"
            )
            prev_label = xfade_out
        out_label = "[concat_out]"

    else:
        # Fallback to cut
        labels = "".join(f"[v{i}]" for i in range(n))
        parts.append(f"{labels}concat=n={n}:v=1:a=0[concat_out]")
        out_label = "[concat_out]"

    # Append drawtext overlay if active
    dt = _build_drawtext(text_overlay, width, height) if text_overlay else None
    if dt:
        final_label = "[final_out]"
        parts.append(f"{out_label}{dt}{final_label}")
        out_label = final_label

    return ";".join(parts), out_label


def render_clips(
    clip_specs: List[ClipSpec],
    output_file: str,
    width: int,
    height: int,
    fps: int,
    transition: str,
    transition_duration: float,
    color_theme: str,
    text_overlay: Optional[dict] = None,
) -> Dict:
    """
    Render an MP4 from a list of trimmed video clips.

    Each clip is trimmed via -ss/-to input flags (fast seek before decode),
    scaled/cropped to target resolution, colour-graded, and stitched together
    with the chosen transition. Text overlay is applied to the final output.

    Returns {"returncode": int, "log": List[str]}.
    """
    if not clip_specs:
        raise RuntimeError("No clips provided to render_clips.")

    logger.info(
        "render_clips: %d clips, %dx%d, fps=%d, transition=%s, theme=%s",
        len(clip_specs), width, height, fps, transition, color_theme,
    )

    filter_complex, out_label = _build_filter_complex(
        clip_specs, width, height, transition, transition_duration, color_theme, text_overlay
    )

    cmd = ["ffmpeg", "-y"]

    # One input per clip with seek flags
    for spec in clip_specs:
        end = spec.trim_end if spec.trim_end > 0 else float(spec.duration)
        cmd += ["-ss", f"{spec.trim_start:.3f}", "-to", f"{end:.3f}", "-i", spec.local_path]

    cmd += [
        "-filter_complex", filter_complex,
        "-map", out_label,
        "-an",                    # strip audio (consistent with image slideshow pipeline)
        "-r", str(fps),
        "-pix_fmt", "yuv420p",
        "-threads", "2",
        "-preset", "ultrafast",
        "-movflags", "faststart",
        output_file,
    ]

    log_lines: List[str] = ["[ffmpeg-clips] " + " ".join(cmd)]
    logger.info("Running ffmpeg for clips (%d inputs)...", len(clip_specs))

    # Use _FONTS_DIR as cwd when drawtext is active so ffmpeg resolves font basenames
    use_fonts_cwd = (
        bool(text_overlay and text_overlay.get("enabled") and text_overlay.get("text", "").strip())
        and os.path.isdir(_FONTS_DIR)
    )
    popen_cwd = _FONTS_DIR if use_fonts_cwd else None

    env = {**os.environ, "PYTHONUNBUFFERED": "1"}
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        cwd=popen_cwd,
        shell=False,
    )
    try:
        for line in proc.stdout:
            stripped = line.rstrip()
            log_lines.append(stripped)
            logger.debug("ffmpeg: %s", stripped)
    finally:
        rc = proc.wait()

    if rc == 0:
        logger.info("render_clips done: %s", output_file)
    else:
        logger.error("render_clips failed with code %d", rc)

    return {"returncode": rc, "log": log_lines}
