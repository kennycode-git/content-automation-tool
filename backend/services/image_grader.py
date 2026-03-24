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


def grade_brown(img: Image.Image, intensity: float = 0.72) -> Image.Image:
    """Warm/brown push: hue shift toward orange, lift reds, tame blues, mild contrast S-curve."""
    arr = np.array(img.convert("RGB"), dtype=np.uint8)
    hsv = rgb_to_hsv_np(arr)
    h = hsv[:, :, 0].astype(np.int16)
    s = hsv[:, :, 1].astype(np.int16)
    v = hsv[:, :, 2].astype(np.int16)

    h = (h + int(255 * 8 / 360)) % 256
    s = (s * 1.10).clip(0, 255).astype(np.uint8)
    v = v.astype(np.uint8)

    warm = hsv_to_rgb_np(np.stack([h.astype(np.uint8), s, v], axis=2))

    warm2 = warm.copy().astype(np.float32)
    warm2[:, :, 2] = warm2[:, :, 2] * 0.93
    warm2 = warm2.clip(0, 255).astype(np.uint8)

    x = warm2.astype(np.float32) / 255.0
    c = 0.10
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


def grade_red(img: Image.Image, intensity: float = 0.80) -> Image.Image:
    """Crimson grade: lift red, crush green/blue, darken, boost saturation."""
    base = img.convert("RGB")
    arr = np.array(base, dtype=np.float32)
    arr[:, :, 0] = (arr[:, :, 0] * 1.22).clip(0, 255)  # red lift
    arr[:, :, 1] = (arr[:, :, 1] * 0.78).clip(0, 255)  # crush green
    arr[:, :, 2] = (arr[:, :, 2] * 0.68).clip(0, 255)  # crush blue
    graded = Image.fromarray(arr.clip(0, 255).astype(np.uint8), "RGB")
    graded = ImageEnhance.Brightness(graded).enhance(0.88)  # darken
    graded = ImageEnhance.Color(graded).enhance(1.3)         # saturation boost
    return Image.fromarray(blend(np.array(base, dtype=np.uint8), np.array(graded), intensity), "RGB")


def grade_sepia(img: Image.Image, intensity: float = 0.70) -> Image.Image:
    """Sepia tone with reduced intensity so original colours partially show through.

    Pre-darkening at 0.72 keeps the tone warm without crushing the image.
    Blending at 0.70 preserves enough of the original image to avoid a flat
    single-colour look.
    """
    base = img.convert("RGB")
    enhancer = ImageEnhance.Brightness(base)
    darkened = enhancer.enhance(0.72)
    arr = np.array(darkened, dtype=np.float32)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    sr = (r * 0.393 + g * 0.769 + b * 0.189).clip(0, 255)
    sg = (r * 0.349 + g * 0.686 + b * 0.168).clip(0, 255)
    sb = (r * 0.272 + g * 0.534 + b * 0.131).clip(0, 255)
    sepia = np.stack([sr, sg, sb], axis=2).astype(np.uint8)
    orig = np.array(base, dtype=np.uint8)
    out = blend(orig, sepia, intensity)
    return Image.fromarray(out, "RGB")


def grade_custom(img: Image.Image, params: dict) -> Image.Image:
    """
    Apply user-defined parametric colour grade.
    Operations are applied in a fixed order: exposure → warmth → tint →
    brightness → contrast → saturation → hue_shift.
    params keys: brightness, contrast, saturation, exposure, warmth, tint, hue_shift
    """
    base = img.convert("RGB")
    arr = np.array(base, dtype=np.float32)

    # 1. Exposure — global multiplicative level (like a pre-stage darkening)
    exposure = float(params.get("exposure", 1.0))
    if abs(exposure - 1.0) > 0.001:
        arr = (arr * exposure).clip(0, 255)

    # 2. Warmth — push red/blue channels in opposite directions
    warmth = float(params.get("warmth", 0.0))
    if warmth > 0:
        arr[:, :, 0] = (arr[:, :, 0] * (1.0 + warmth * 0.25)).clip(0, 255)  # lift red
        arr[:, :, 1] = (arr[:, :, 1] * (1.0 + warmth * 0.05)).clip(0, 255)  # mild green lift
        arr[:, :, 2] = (arr[:, :, 2] * (1.0 - warmth * 0.25)).clip(0, 255)  # cut blue
    elif warmth < 0:
        cool = -warmth
        arr[:, :, 0] = (arr[:, :, 0] * (1.0 - cool * 0.20)).clip(0, 255)   # cut red
        arr[:, :, 2] = (arr[:, :, 2] * (1.0 + cool * 0.25)).clip(0, 255)   # lift blue

    # 3. Tint — green/magenta axis
    tint = float(params.get("tint", 0.0))
    if tint > 0:
        arr[:, :, 1] = (arr[:, :, 1] * (1.0 - tint * 0.20)).clip(0, 255)        # cut green → magenta
    elif tint < 0:
        arr[:, :, 1] = (arr[:, :, 1] * (1.0 + (-tint) * 0.20)).clip(0, 255)     # lift green

    img_out = Image.fromarray(arr.clip(0, 255).astype(np.uint8), "RGB")

    # 4. Brightness
    brightness = float(params.get("brightness", 1.0))
    if abs(brightness - 1.0) > 0.001:
        img_out = ImageEnhance.Brightness(img_out).enhance(brightness)

    # 5. Contrast
    contrast = float(params.get("contrast", 1.0))
    if abs(contrast - 1.0) > 0.001:
        img_out = ImageEnhance.Contrast(img_out).enhance(contrast)

    # 6. Saturation
    saturation = float(params.get("saturation", 1.0))
    if abs(saturation - 1.0) > 0.001:
        img_out = ImageEnhance.Color(img_out).enhance(saturation)

    # 7. Hue shift
    hue_shift_deg = float(params.get("hue_shift", 0.0))
    if abs(hue_shift_deg) > 0.5:
        shift_255 = int(round(hue_shift_deg / 360.0 * 255))
        arr2 = np.array(img_out, dtype=np.uint8)
        hsv = rgb_to_hsv_np(arr2)
        h = hsv[:, :, 0].astype(np.int16)
        h = ((h + shift_255) % 256).astype(np.uint8)
        img_out = Image.fromarray(
            hsv_to_rgb_np(np.stack([h, hsv[:, :, 1], hsv[:, :, 2]], axis=2)), "RGB"
        )

    return img_out


def grade_mocha(img: Image.Image, intensity: float = 0.85) -> Image.Image:
    """Dark warm brown: brown hue push then heavy darken + contrast boost."""
    browned = grade_brown(img, intensity=1.0)
    arr = np.array(browned, dtype=np.float32)
    arr = (arr * 0.55).clip(0, 255)
    darkened = ImageEnhance.Contrast(Image.fromarray(arr.astype(np.uint8), "RGB")).enhance(1.35)
    orig = np.array(img.convert("RGB"), dtype=np.uint8)
    return Image.fromarray(blend(orig, np.array(darkened), intensity), "RGB")


def grade_noir(img: Image.Image, intensity: float = 1.0) -> Image.Image:
    """Near-monochrome with warm shadow bleed: dark film-noir feel."""
    base = img.convert("RGB")
    bw = ImageOps.grayscale(base)
    bw_rgb = Image.merge("RGB", (bw, bw, bw))
    bw_rgb = ImageEnhance.Brightness(bw_rgb).enhance(0.45)
    bw_rgb = ImageEnhance.Contrast(bw_rgb).enhance(1.5)
    gamma_lut = lambda x: int((x / 255.0) ** 1.4 * 255)
    r, g, b = bw_rgb.split()
    r = r.point(gamma_lut)
    g = g.point(gamma_lut)
    b = b.point(gamma_lut)
    bw_rgb = Image.merge("RGB", (r, g, b))
    # warm tinge: lift red, cut blue (opposite of dark's cool tinge)
    r, g, b = bw_rgb.split()
    r = r.point(lambda x: min(255, int(x * 1.08)))
    b = b.point(lambda x: int(x * 0.88))
    bw_rgb = Image.merge("RGB", (r, g, b))
    if intensity >= 0.999:
        return bw_rgb
    return Image.fromarray(blend(np.array(base), np.array(bw_rgb), intensity), "RGB")


def grade_abyss(img: Image.Image, intensity: float = 1.0) -> Image.Image:
    """Low exposure + deep blue hue shift: dark midnight/ocean teal."""
    base = img.convert("RGB")
    darkened = ImageEnhance.Contrast(ImageEnhance.Brightness(base).enhance(0.38)).enhance(1.4)
    arr = np.array(darkened, dtype=np.uint8)
    hsv = rgb_to_hsv_np(arr)
    h = ((hsv[:, :, 0].astype(np.int16) + int(255 * 150 / 360)) % 256).astype(np.uint8)
    s = (hsv[:, :, 1].astype(np.float32) * 1.15).clip(0, 255).astype(np.uint8)
    graded = hsv_to_rgb_np(np.stack([h, s, hsv[:, :, 2]], axis=2))
    if intensity >= 0.999:
        return Image.fromarray(graded, "RGB")
    return Image.fromarray(blend(np.array(base), graded, intensity), "RGB")


def grade_dusk(img: Image.Image, intensity: float = 0.85) -> Image.Image:
    """Twilight purple: darken, crush green, lift red+blue for violet cast."""
    base = img.convert("RGB")
    arr = (np.array(base, dtype=np.float32) * 0.62).clip(0, 255)
    arr[:, :, 0] = (arr[:, :, 0] * 1.15).clip(0, 255)  # lift red
    arr[:, :, 1] = (arr[:, :, 1] * 0.72).clip(0, 255)  # crush green
    arr[:, :, 2] = (arr[:, :, 2] * 1.25).clip(0, 255)  # lift blue
    graded = ImageEnhance.Contrast(Image.fromarray(arr.astype(np.uint8), "RGB")).enhance(1.3)
    orig = np.array(base, dtype=np.uint8)
    return Image.fromarray(blend(orig, np.array(graded), intensity), "RGB")


def grade_low_exposure(img: Image.Image, intensity: float = 1.0) -> Image.Image:
    """Crush exposure: heavily darken while preserving colour and boosting contrast."""
    base = img.convert("RGB")
    enhancer = ImageEnhance.Brightness(base)
    darkened = enhancer.enhance(0.38)
    enhancer = ImageEnhance.Contrast(darkened)
    contrasted = enhancer.enhance(1.4)
    if intensity >= 0.999:
        return contrasted
    return Image.fromarray(blend(np.array(base), np.array(contrasted), intensity), "RGB")


def apply_theme_grading(images_dir: str, output_dir: str, theme: str, custom_params: dict = None) -> str:
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
            elif theme == "sepia":
                if brown_ratio(img) < 0.12:
                    out = grade_sepia(img)
                else:
                    out = img
            elif theme == "low_exp":
                out = grade_low_exposure(img)
            elif theme == "mocha":
                out = grade_mocha(img)
            elif theme == "noir":
                out = grade_noir(img)
            elif theme == "abyss":
                out = grade_abyss(img)
            elif theme == "dusk":
                out = grade_dusk(img)
            elif theme == "custom":
                out = grade_custom(img, custom_params) if custom_params else img
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
