"""
video_builder.py

Extracted from tiktok-generation/slideshow_from_images.py.
Adds render_slideshow() wrapper that runs ffmpeg and returns structured result.
"""

import glob
import logging
import math
import os
import random
import subprocess
from itertools import cycle
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


# ── Text overlay (drawtext filter) ────────────────────────────────────────────

_FONTS_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "fonts"))

FONT_MAP: Dict[str, str] = {
    # Serif
    "garamond":    os.path.join(_FONTS_DIR, "EBGaramond-Regular.ttf"),
    "cormorant":   os.path.join(_FONTS_DIR, "Cormorant-Regular.ttf"),
    "playfair":    os.path.join(_FONTS_DIR, "PlayfairDisplay-Regular.ttf"),
    "crimson":     os.path.join(_FONTS_DIR, "CrimsonText-Regular.ttf"),
    "philosopher": os.path.join(_FONTS_DIR, "Philosopher-Regular.ttf"),
    "lora":        os.path.join(_FONTS_DIR, "Lora-Regular.ttf"),
    # Sans
    "outfit":      os.path.join(_FONTS_DIR, "Outfit-Regular.ttf"),
    "raleway":     os.path.join(_FONTS_DIR, "Raleway-Regular.ttf"),
    "josefin":     os.path.join(_FONTS_DIR, "JosefinSans-Regular.ttf"),
    "inter":       os.path.join(_FONTS_DIR, "Inter_18pt-Regular.ttf"),
    # Display
    "cinzel":      os.path.join(_FONTS_DIR, "Cinzel-Regular.ttf"),
    "cinzel_deco": os.path.join(_FONTS_DIR, "CinzelDecorative-Regular.ttf"),
    "uncial":      os.path.join(_FONTS_DIR, "UncialAntiqua-Regular.ttf"),
    # Mono
    "jetbrains":   os.path.join(_FONTS_DIR, "JetBrainsMono-Regular.ttf"),
    "space_mono":  os.path.join(_FONTS_DIR, "SpaceMono-Regular.ttf"),
}

COLOR_MAP: Dict[str, str] = {
    "white": "ffffff",
    "cream": "f5f0e8",
    "gold":  "f5e317",
    "black": "000000",
}


def _escape_drawtext(text: str) -> str:
    """Escape special characters for ffmpeg drawtext filter value."""
    # Order matters — backslash must be first; newlines after backslash processing
    return (
        text
        .replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace(":", "\\:")
        .replace("%", "%%")
        .replace("\r\n", "\\n")  # Windows CRLF → ffmpeg newline sequence
        .replace("\n", "\\n")    # Unix LF → ffmpeg newline sequence
    )


def _drawtext_xy(position: str, width: int, height: int) -> tuple[str, str]:
    mx, my = int(width * 0.05), int(height * 0.05)
    vert, horiz = position.split("-", 1)  # e.g. "bottom-center" → ("bottom", "center")
    x = {"left": str(mx), "center": "(w-tw)/2", "right": f"w-tw-{mx}"}[horiz]
    y = {"top": str(my), "middle": "(h-th)/2", "bottom": f"h-th-{my}"}[vert]
    return x, y


def _build_drawtext(overlay: dict, width: int, height: int) -> Optional[str]:
    """
    Build the ffmpeg drawtext filter string from an overlay config dict.
    Returns None if overlay is disabled, text is blank, or font file is missing.
    """
    if not overlay.get("enabled") or not overlay.get("text", "").strip():
        return None

    font_path = FONT_MAP.get(overlay.get("font", "garamond"), FONT_MAP["garamond"])
    if not os.path.exists(font_path):
        logger.warning("Font not found: %s — skipping drawtext overlay", font_path)
        return None

    color_key = overlay.get("color", "white")
    if color_key == "custom":
        hex_color = (overlay.get("custom_color") or "#ffffff").lstrip("#")
    else:
        hex_color = COLOR_MAP.get(color_key, "ffffff")

    fontsize = max(8, int(height * overlay.get("font_size_pct", 0.045)))
    mx, my = int(width * 0.05), int(height * 0.05)
    alignment = overlay.get("alignment", "center")
    x = {"left": str(mx), "center": "(w-tw)/2", "right": f"w-tw-{mx}"}.get(alignment, "(w-tw)/2")
    vert = overlay.get("position", "bottom-center").split("-", 1)[0]
    y = {"top": str(my), "middle": "(h-th)/2", "bottom": f"h-th-{my}"}.get(vert, f"h-th-{my}")

    # Use basename only — render_slideshow sets cwd=_FONTS_DIR so ffmpeg resolves
    # the relative path there. This avoids the Windows drive-letter colon (C:/)
    # that breaks ffmpeg's filter option parser.
    font_path_filter = os.path.basename(font_path)
    parts = [
        f"fontfile={font_path_filter}",
        f"text={_escape_drawtext(overlay['text'])}",
        f"fontcolor={hex_color}ff",
        f"fontsize={fontsize}",
        f"x={x}",
        f"y={y}",
    ]
    if overlay.get("background_box"):
        parts += ["box=1", "boxcolor=000000@0.55", "boxborderw=18"]

    return "drawtext=" + ":".join(parts)


def list_images(folder: str) -> List[str]:
    exts = ("*.jpg", "*.jpeg", "*.png", "*.webp", "*.bmp")
    files: List[str] = []
    for pat in exts:
        files.extend(glob.glob(os.path.join(folder, pat)))
    return sorted(files)


def pick_images_for_duration(
    folder: str,
    seconds_per_image: float,
    total_seconds: float,
    allow_repeats: bool = True,
    shuffle: bool = False,
) -> List[str]:
    files = list_images(folder)
    if shuffle:
        random.shuffle(files)
    if not files:
        raise RuntimeError(f"No images found in {folder}")

    needed = int(math.ceil(total_seconds / float(seconds_per_image)))
    if needed <= 0:
        raise ValueError("Computed needed frame count <= 0. Check seconds_per_image / total_seconds.")

    if len(files) >= needed or not allow_repeats:
        if len(files) < needed and not allow_repeats:
            raise RuntimeError(f"Need {needed} images but only {len(files)} found (repeats disabled).")
        return files[:needed]

    picks: List[str] = []
    cyc = cycle(files)
    prev = None
    while len(picks) < needed:
        candidate = next(cyc)
        if prev is not None and os.path.basename(candidate) == os.path.basename(prev):
            candidate = next(cyc)
        picks.append(candidate)
        prev = candidate
    return picks


def write_concat_file(images: List[str], concat_path: str, seconds_per_image: float) -> None:
    """Write an ffmpeg concat demuxer file with explicit duration per image."""
    with open(concat_path, "w", encoding="utf-8") as f:
        for img in images:
            path = img.replace(chr(92), "/")
            f.write(f"file '{path}'\n")
            f.write(f"duration {seconds_per_image:.6f}\n")
        # Repeat last entry without duration (avoids last-frame drop quirk)
        f.write(f"file '{images[-1].replace(chr(92), '/')}'\n")


def build_ffmpeg_command(
    images: List[str],
    out_file: str,
    width: int,
    height: int,
    seconds_per_image: float,
    fps: int,
    text_overlay: Optional[dict] = None,
) -> List[str]:
    """
    Build an ffmpeg command using the concat demuxer with explicit duration entries.
    Processes images sequentially — O(1) memory regardless of image count.
    Appends a drawtext filter when text_overlay is provided and valid.
    """
    if not images:
        raise RuntimeError("No images provided to ffmpeg.")

    concat_path = out_file.replace(".mp4", "_concat.txt")
    write_concat_file(images, concat_path, seconds_per_image)

    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height},setsar=1"
    )
    if text_overlay:
        dt = _build_drawtext(text_overlay, width, height)
        if dt:
            vf += f",{dt}"

    return [
        "ffmpeg", "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", concat_path,
        "-vf", vf,
        "-r", str(fps),
        "-pix_fmt", "yuv420p",
        "-threads", "2",
        "-preset", "ultrafast",
        "-movflags", "faststart",
        out_file,
    ]


def extract_thumbnail(video_path: str, output_path: str, total_seconds: float) -> bool:
    """
    Extract a single frame from the video at 30% of total duration as a JPEG thumbnail.
    Returns True on success, False on failure.
    """
    seek = max(0.0, total_seconds * 0.3)
    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{seek:.3f}",
        "-i", video_path,
        "-vframes", "1",
        "-q:v", "3",
        output_path,
    ]
    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )
    if result.returncode == 0:
        logger.info("Thumbnail extracted: %s", output_path)
    else:
        logger.warning("extract_thumbnail failed (rc=%d): %s", result.returncode, result.stdout[-500:])
    return result.returncode == 0


def render_slideshow(
    input_folder: str,
    output_file: str,
    width: int = 1080,
    height: int = 1920,
    seconds_per_image: float = 0.13,
    fps: int = 30,
    total_seconds: float = 11.0,
    allow_repeats: bool = True,
    shuffle: bool = True,
    text_overlay: Optional[dict] = None,
) -> Dict:
    """
    Full pipeline: pick images → build ffmpeg command → run ffmpeg.

    Returns {"returncode": int, "log": List[str]}.
    """
    logger.info(
        "render_slideshow: input=%s output=%s %dx%d fps=%d spi=%.3f total=%.1fs",
        input_folder, output_file, width, height, fps, seconds_per_image, total_seconds,
    )

    Path(output_file).parent.mkdir(parents=True, exist_ok=True)

    images = pick_images_for_duration(
        folder=input_folder,
        seconds_per_image=seconds_per_image,
        total_seconds=total_seconds,
        allow_repeats=allow_repeats,
        shuffle=shuffle,
    )

    unique_count = len({os.path.basename(p) for p in images})
    logger.info("Using %d images (unique sources: %d)", len(images), unique_count)

    cmd = build_ffmpeg_command(
        images=images,
        out_file=output_file,
        width=width,
        height=height,
        seconds_per_image=seconds_per_image,
        fps=fps,
        text_overlay=text_overlay,
    )

    log_lines: List[str] = []
    log_lines.append("[ffmpeg] " + " ".join(cmd))
    logger.info("Running ffmpeg (%d images)...", len(images))

    # Set cwd to the fonts directory when drawtext is active so ffmpeg can resolve
    # the relative fontfile basename without a Windows drive-letter colon in the path.
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
        logger.info("render_slideshow done: %s", output_file)
    else:
        logger.error("ffmpeg failed with code %d", rc)

    return {"returncode": rc, "log": log_lines}
