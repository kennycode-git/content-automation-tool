"""
image_grader.py

Extracted from filters/color_grade.py.
All status output uses logging.
"""

import logging
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageOps

logger = logging.getLogger(__name__)


def blend(a: np.ndarray, b: np.ndarray, t: float) -> np.ndarray:
    return (a * (1.0 - t) + b * t).clip(0, 255).astype(np.uint8)


def rgb_to_hsv_np(rgb: np.ndarray) -> np.ndarray:
    return np.array(Image.fromarray(rgb, "RGB").convert("HSV"))


def hsv_to_rgb_np(hsv: np.ndarray) -> np.ndarray:
    return np.array(Image.fromarray(hsv, "HSV").convert("RGB"))


def grade_brown(img: Image.Image, intensity: float = 0.6) -> Image.Image:
    """Warm/brown push: hue shift toward orange, lift reds, tame blues, mild contrast S-curve."""
    arr = np.array(img.convert("RGB"), dtype=np.uint8)
    hsv = rgb_to_hsv_np(arr)
    h = hsv[:, :, 0].astype(np.int16)
    s = hsv[:, :, 1].astype(np.int16)
    v = hsv[:, :, 2].astype(np.int16)

    h = (h + int(255 * 5 / 360)) % 256
    s = (s * 1.06).clip(0, 255).astype(np.uint8)
    v = v.astype(np.uint8)

    warm = hsv_to_rgb_np(np.stack([h.astype(np.uint8), s, v], axis=2))

    warm2 = warm.copy().astype(np.float32)
    warm2[:, :, 2] = warm2[:, :, 2] * 0.96
    warm2 = warm2.clip(0, 255).astype(np.uint8)

    x = warm2.astype(np.float32) / 255.0
    c = 0.08
    s_curve = (x - c * x * (1 - x)) * 255.0
    s_curve = s_curve.clip(0, 255).astype(np.uint8)

    out = blend(arr, s_curve, intensity)
    return Image.fromarray(out, mode="RGB")


def grade_bw(img: Image.Image, intensity: float = 1.0) -> Image.Image:
    base = img.convert("RGB")
    bw = ImageOps.grayscale(base)
    bw = ImageOps.autocontrast(bw, cutoff=1)
    bw_rgb = Image.merge("RGB", (bw, bw, bw))
    if intensity >= 0.999:
        return bw_rgb
    return Image.fromarray(blend(np.array(base), np.array(bw_rgb), intensity), "RGB")


def grade_bw_dark(img: Image.Image, intensity: float = 1.0) -> Image.Image:
    """Black & white with aggressive darkening for text readability."""
    base = img.convert("RGB")
    bw = ImageOps.grayscale(base)
    bw_rgb = Image.merge("RGB", (bw, bw, bw))

    enhancer = ImageEnhance.Brightness(bw_rgb)
    bw_rgb = enhancer.enhance(0.45)

    enhancer = ImageEnhance.Contrast(bw_rgb)
    bw_rgb = enhancer.enhance(1.6)

    gamma_lut = lambda x: int((x / 255.0) ** 1.5 * 255)
    r, g, b = bw_rgb.split()
    r = r.point(gamma_lut)
    g = g.point(gamma_lut)
    b = b.point(gamma_lut)
    bw_rgb = Image.merge("RGB", (r, g, b))

    r, g, b = bw_rgb.split()
    r = r.point(lambda x: int(x * 0.95))
    b = b.point(lambda x: min(255, int(x * 1.05)))
    bw_rgb = Image.merge("RGB", (r, g, b))

    if intensity >= 0.999:
        return bw_rgb
    return Image.fromarray(blend(np.array(base), np.array(bw_rgb), intensity), "RGB")


def brightness_ratio(img: Image.Image) -> float:
    """Average brightness (V channel in HSV) on 0-1 scale."""
    hsv = np.array(img.convert("HSV"), dtype=np.float32)
    return float(hsv[:, :, 2].mean() / 255.0)


def brown_ratio(img: Image.Image) -> float:
    """Estimate brown-dominance in HSV (orange/brown band, medium saturation/value)."""
    arr = np.array(img.convert("RGB"))
    hsv = rgb_to_hsv_np(arr)
    h = hsv[:, :, 0].astype(np.int16)
    s = hsv[:, :, 1].astype(np.int16)
    v = hsv[:, :, 2].astype(np.int16)
    low = int(255 * 10 / 360)
    high = int(255 * 40 / 360)
    mask = (h >= low) & (h <= high) & (s >= 40) & (v >= 30)
    return float(mask.sum()) / float(mask.size)


def grade_grey(img: Image.Image, intensity: float = 0.8) -> Image.Image:
    """Desaturate + silver-cool tint."""
    base = img.convert("RGB")
    enhancer = ImageEnhance.Color(base)
    desaturated = enhancer.enhance(0.2)
    arr = np.array(desaturated, dtype=np.float32)
    arr[:, :, 0] = (arr[:, :, 0] * 0.95).clip(0, 255)
    arr[:, :, 2] = (arr[:, :, 2] * 1.05).clip(0, 255)
    graded = Image.fromarray(arr.astype(np.uint8), "RGB")
    if intensity >= 0.999:
        return graded
    return Image.fromarray(blend(np.array(base), np.array(graded), intensity), "RGB")


def grade_blue(img: Image.Image, intensity: float = 0.6) -> Image.Image:
    """HSV hue shift toward blue-cyan, slight saturation boost."""
    base = img.convert("RGB")
    arr = np.array(base, dtype=np.uint8)
    hsv = rgb_to_hsv_np(arr)
    h = hsv[:, :, 0].astype(np.int16)
    s = hsv[:, :, 1].astype(np.int16)
    v = hsv[:, :, 2].astype(np.int16)
    # +150° in 0-360 → +~106 in 0-255
    h = ((h + int(255 * 150 / 360)) % 256).astype(np.uint8)
    s = (s * 1.05).clip(0, 255).astype(np.uint8)
    graded = hsv_to_rgb_np(np.stack([h, s, v.astype(np.uint8)], axis=2))
    return Image.fromarray(blend(arr, graded, intensity), "RGB")


def grade_red(img: Image.Image, intensity: float = 0.6) -> Image.Image:
    """HSV hue shift toward red, lift red channel."""
    base = img.convert("RGB")
    arr = np.array(base, dtype=np.uint8)
    hsv = rgb_to_hsv_np(arr)
    h = hsv[:, :, 0].astype(np.int16)
    s = hsv[:, :, 1].astype(np.int16)
    v = hsv[:, :, 2].astype(np.int16)
    # +10° toward red
    h = ((h + int(255 * 10 / 360)) % 256).astype(np.uint8)
    graded_arr = hsv_to_rgb_np(np.stack([h, s.astype(np.uint8), v.astype(np.uint8)], axis=2)).astype(np.float32)
    graded_arr[:, :, 0] = (graded_arr[:, :, 0] * 1.06).clip(0, 255)
    graded = graded_arr.clip(0, 255).astype(np.uint8)
    return Image.fromarray(blend(arr, graded, intensity), "RGB")


def apply_theme_grading(images_dir: str, output_dir: str, theme: str) -> str:
    """
    Apply per-theme colour grading to all images in images_dir, saving to output_dir.
    Returns output_dir if grading was applied, or images_dir for theme='none' (no-op).
    """
    if theme == "none":
        return images_dir

    Path(output_dir).mkdir(parents=True, exist_ok=True)

    for p in sorted(Path(images_dir).glob("*")):
        if not p.is_file():
            continue
        try:
            img = Image.open(p).convert("RGB")
            out: Image.Image

            if theme == "warm":
                if brown_ratio(img) < 0.08:
                    out = grade_brown(img)
                else:
                    out = img
            elif theme == "dark":
                if brightness_ratio(img) > 0.15:
                    out = grade_bw_dark(img)
                else:
                    out = img
            elif theme == "grey":
                out = grade_grey(img)
            elif theme == "blue":
                out = grade_blue(img)
            elif theme == "red":
                out = grade_red(img)
            elif theme == "bw":
                out = grade_bw(img)
            else:
                out = img

            out.save(Path(output_dir) / p.name, "JPEG", quality=92, optimize=True)
            logger.debug("Graded %s (theme=%s)", p.name, theme)
        except Exception as e:
            logger.warning("skip %s: %s", p.name, e)

    logger.info("apply_theme_grading: theme=%s, dir=%s → %s", theme, images_dir, output_dir)
    return output_dir


def process_folder(
    input_dir: str,
    output_dir: str,
    mode: str,
    intensity: float,
    filter_non_brown: bool,
    brown_thresh: float,
    brightness_thresh: float = 0.0,
) -> dict:
    """Process images in a folder. Returns {"kept": int, "graded": int, "copied": int, "total": int}."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    kept = graded = copied = total = 0
    conditional = brightness_thresh > 0 and mode == "bw_dark"

    for p in sorted(Path(input_dir).glob("*")):
        if not p.is_file():
            continue
        try:
            total += 1
            img = Image.open(p).convert("RGB")
            if filter_non_brown and brown_ratio(img) < brown_thresh:
                continue

            if conditional:
                br = brightness_ratio(img)
                if br <= brightness_thresh:
                    img.save(Path(output_dir) / p.name, "JPEG", quality=92, optimize=True)
                    logger.info("%s: dark enough (%.3f <= %.3f) -> copied", p.name, br, brightness_thresh)
                    copied += 1
                    kept += 1
                    continue
                else:
                    out = grade_bw_dark(img, intensity=intensity)
                    logger.info("%s: too bright (%.3f > %.3f) -> graded bw_dark", p.name, br, brightness_thresh)
                    graded += 1
            elif mode == "brown":
                out = grade_brown(img, intensity=intensity)
            elif mode == "bw":
                out = grade_bw(img, intensity=intensity)
            elif mode == "bw_dark":
                out = grade_bw_dark(img, intensity=intensity)
            else:
                out = img

            out.save(Path(output_dir) / p.name, "JPEG", quality=92, optimize=True)
            kept += 1
        except Exception as e:
            logger.warning("skip %s: %s", p.name, e)

    if conditional:
        logger.info("Auto-darken: %d graded, %d copied as-is, %d/%d total -> %s", graded, copied, kept, total, output_dir)
    else:
        logger.info("Processed %d/%d images -> %s", kept, total, output_dir)

    return {"kept": kept, "graded": graded, "copied": copied, "total": total}
