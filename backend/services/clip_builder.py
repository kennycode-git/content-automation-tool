"""
clip_builder.py

Renders an MP4 from a list of trimmed Pexels video clips using a two-pass approach:

  Pass 1 — per-clip normalisation (one ffmpeg process per clip):
    - Trim via -ss/-to input flags
    - Scale + crop to target resolution
    - Apply colour grade (eq/colorchannelmixer filters)
    - Bake fade-in/fade-out for fade_black transition

  Pass 2 — combine:
    - cut / fade_black  → concat demuxer with -c copy  (zero re-encode, minimal memory)
    - crossfade         → chained xfade, two clips at a time

  Optional Pass 3 — drawtext overlay (separate ffmpeg call on the combined file).

This approach avoids loading all clips into memory simultaneously, preventing OOM
on Railway's constrained instances.
"""

import logging
import os
import shutil
import subprocess
import tempfile
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


def _clip_duration(spec: ClipSpec, max_clip_duration: float = 15.0) -> float:
    end = spec.trim_end if spec.trim_end > 0 else float(spec.duration)
    end = min(end, spec.trim_start + max_clip_duration)
    return max(0.1, end - spec.trim_start)


def _run(cmd: List[str], label: str) -> Dict:
    """Run a subprocess, capturing stderr. Returns {"returncode", "stderr"}."""
    logger.debug("ffmpeg [%s]: %s", label, " ".join(cmd))
    proc = subprocess.run(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if proc.returncode != 0:
        logger.error("ffmpeg [%s] rc=%d stderr tail:\n%s",
                     label, proc.returncode, proc.stderr[-1000:])
    return {"returncode": proc.returncode, "stderr": proc.stderr}


def _normalize_clip(
    spec: ClipSpec,
    out_path: str,
    width: int,
    height: int,
    fps: int,
    grade: str,
    transition: str,
    transition_duration: float,
    is_first: bool,
    is_last: bool,
    max_clip_duration: float = 15.0,
) -> Dict:
    """
    Pass 1: encode one clip to the target resolution/codec.

    For fade_black, fades are baked in here so pass 2 can use concat-copy.
    """
    raw_end = spec.trim_end if spec.trim_end > 0 else float(spec.duration)
    end = min(raw_end, spec.trim_start + max_clip_duration)
    dur = _clip_duration(spec, max_clip_duration)

    vf_parts = [
        f"scale={width}:{height}:force_original_aspect_ratio=increase",
        f"crop={width}:{height}",
        "setsar=1",
    ]
    if grade:
        vf_parts.append(grade)

    if transition == "fade_black":
        td = transition_duration
        if not is_first:
            vf_parts.append(f"fade=t=in:st=0:d={td:.3f}:color=black")
        if not is_last:
            fade_out_st = max(0.0, dur - td)
            vf_parts.append(f"fade=t=out:st={fade_out_st:.3f}:d={td:.3f}:color=black")

    vf = ",".join(vf_parts)

    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{spec.trim_start:.3f}",
        "-to", f"{end:.3f}",
        "-i", spec.local_path,
        "-vf", vf,
        "-an",
        "-r", str(fps),
        "-pix_fmt", "yuv420p",
        "-crf", "28",
        "-threads", "1",
        "-preset", "ultrafast",
        "-movflags", "faststart",
        out_path,
    ]
    return _run(cmd, f"normalize clip → {os.path.basename(out_path)}")


def _concat_copy(parts: List[str], output_file: str, tmp_dir: str) -> Dict:
    """Pass 2 (cut / fade_black): concat with demuxer — stream copy, no re-encode."""
    concat_txt = os.path.join(tmp_dir, "concat.txt")
    with open(concat_txt, "w", encoding="utf-8") as f:
        for p in parts:
            # Use absolute paths; escape single quotes in path
            escaped = p.replace("'", "'\\''")
            f.write(f"file '{escaped}'\n")

    cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0",
        "-i", concat_txt,
        "-c", "copy",
        output_file,
    ]
    return _run(cmd, "concat-copy")


def _xfade_pair(
    input_a: str,
    input_b: str,
    output: str,
    duration_a: float,
    transition_duration: float,
    fps: int,
) -> Dict:
    """Pass 2 (crossfade): xfade between two pre-normalised clips."""
    offset = max(0.0, duration_a - transition_duration)
    td = transition_duration
    cmd = [
        "ffmpeg", "-y",
        "-i", input_a,
        "-i", input_b,
        "-filter_complex",
        f"[0:v][1:v]xfade=transition=fade:duration={td:.3f}:offset={offset:.3f}[out]",
        "-map", "[out]",
        "-an",
        "-r", str(fps),
        "-pix_fmt", "yuv420p",
        "-crf", "28",
        "-threads", "1",
        "-preset", "ultrafast",
        "-movflags", "faststart",
        output,
    ]
    return _run(cmd, f"xfade → {os.path.basename(output)}")


def _apply_drawtext(
    input_file: str,
    output_file: str,
    text_overlay: dict,
    width: int,
    height: int,
) -> Dict:
    """Pass 3 (optional): burn in drawtext overlay on the combined file."""
    dt = _build_drawtext(text_overlay, width, height)
    if not dt:
        shutil.copy2(input_file, output_file)
        return {"returncode": 0, "stderr": ""}

    # _build_drawtext returns ",drawtext=..." — strip leading comma for -vf
    vf = dt.lstrip(",")

    use_fonts_cwd = os.path.isdir(_FONTS_DIR)
    cmd = [
        "ffmpeg", "-y",
        "-i", input_file,
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-pix_fmt", "yuv420p",
        "-threads", "1",
        "-movflags", "faststart",
        output_file,
    ]
    return _run(cmd, "drawtext")  # cwd handled below


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
    max_clip_duration: int = 10,
) -> Dict:
    """
    Render an MP4 from trimmed video clips using a memory-efficient two-pass approach.

    Returns {"returncode": int, "log": List[str]}.
    """
    if not clip_specs:
        raise RuntimeError("No clips provided to render_clips.")

    logger.info(
        "render_clips: %d clips, %dx%d, fps=%d, transition=%s, theme=%s",
        len(clip_specs), width, height, fps, transition, color_theme,
    )

    grade = CLIP_GRADE_FILTERS.get(color_theme, "")
    n = len(clip_specs)
    mcd = float(max_clip_duration)
    durations = [_clip_duration(s, mcd) for s in clip_specs]
    log_lines: List[str] = []

    tmp_dir = tempfile.mkdtemp(prefix="clipbuild_")
    try:
        # ── Pass 1: normalise each clip individually ──────────────────────────
        part_paths: List[str] = []
        for i, spec in enumerate(clip_specs):
            out = os.path.join(tmp_dir, f"part_{i:03d}.mp4")
            result = _normalize_clip(
                spec, out, width, height, fps, grade,
                transition, transition_duration,
                is_first=(i == 0), is_last=(i == n - 1),
                max_clip_duration=mcd,
            )
            log_lines.append(f"[normalize clip {i}] rc={result['returncode']}")
            if result["returncode"] != 0:
                return {"returncode": result["returncode"], "log": log_lines}
            part_paths.append(out)

        # ── Pass 2: combine ───────────────────────────────────────────────────
        combined = os.path.join(tmp_dir, "combined.mp4")

        if transition in ("cut", "fade_black") or n == 1:
            result = _concat_copy(part_paths, combined, tmp_dir)
            log_lines.append(f"[concat-copy] rc={result['returncode']}")
            if result["returncode"] != 0:
                return {"returncode": result["returncode"], "log": log_lines}

        elif transition == "crossfade":
            # Chain xfade two clips at a time
            current = part_paths[0]
            current_dur = durations[0]
            for i in range(1, n):
                xf_out = os.path.join(tmp_dir, f"xf_{i:03d}.mp4")
                result = _xfade_pair(current, part_paths[i], xf_out,
                                     current_dur, transition_duration, fps)
                log_lines.append(f"[xfade {i}] rc={result['returncode']}")
                if result["returncode"] != 0:
                    return {"returncode": result["returncode"], "log": log_lines}
                current = xf_out
                current_dur = current_dur + durations[i] - transition_duration
            combined = current

        else:
            # Unknown transition — fall back to cut
            result = _concat_copy(part_paths, combined, tmp_dir)
            log_lines.append(f"[concat-copy fallback] rc={result['returncode']}")
            if result["returncode"] != 0:
                return {"returncode": result["returncode"], "log": log_lines}

        # ── Pass 3 (optional): drawtext overlay ───────────────────────────────
        has_overlay = (
            text_overlay
            and text_overlay.get("enabled")
            and text_overlay.get("text", "").strip()
        )
        if has_overlay:
            overlay_out = os.path.join(tmp_dir, "overlay_out.mp4")
            dt = _build_drawtext(text_overlay, width, height)
            if dt:
                vf = dt.lstrip(",")
                use_fonts_cwd = os.path.isdir(_FONTS_DIR)
                cmd = [
                    "ffmpeg", "-y",
                    "-i", combined,
                    "-vf", vf,
                    "-c:v", "libx264",
                    "-preset", "ultrafast",
                    "-pix_fmt", "yuv420p",
                    "-threads", "1",
                    "-movflags", "faststart",
                    overlay_out,
                ]
                result = _run(cmd, "drawtext")
                log_lines.append(f"[drawtext] rc={result['returncode']}")
                if result["returncode"] == 0:
                    combined = overlay_out
                else:
                    logger.warning("Drawtext pass failed — using video without overlay")

        # Move combined to the expected output path
        shutil.copy2(combined, output_file)
        logger.info("render_clips done: %s", output_file)
        return {"returncode": 0, "log": log_lines}

    except Exception as exc:
        logger.exception("render_clips raised: %s", exc)
        return {"returncode": -1, "log": log_lines + [str(exc)]}

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
