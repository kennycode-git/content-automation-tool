"""
image_injector.py

Extracted from inject_accent_images.py.
All status output uses logging.
"""

import glob
import logging
import os
import random
from pathlib import Path
from typing import List

from PIL import Image

logger = logging.getLogger(__name__)


def list_images(folder: str) -> List[str]:
    """Find all image files in folder."""
    if not os.path.exists(folder):
        return []
    exts = ("*.jpg", "*.jpeg", "*.png", "*.webp")
    files: List[str] = []
    for ext in exts:
        files.extend(glob.glob(os.path.join(folder, ext)))
    return files


def resize_cover(img: Image.Image, tw: int, th: int) -> Image.Image:
    """Resize image to cover target dimensions (crop to fit)."""
    ow, oh = img.size
    r = max(tw / ow, th / oh)
    nw, nh = int(ow * r), int(oh * r)
    img = img.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - tw) // 2
    top = (nh - th) // 2
    return img.crop((left, top, left + tw, top + th))


def inject_images(
    source_folder: str,
    dest_folder: str,
    count: int,
    target_w: int = 1080,
    target_h: int = 1920,
    prefix: str = "accent",
) -> int:
    """
    Inject random images from source_folder into dest_folder.

    Images are resized to target dimensions and prefixed with `prefix_NNN_`.
    Returns the count of images successfully injected.
    """
    logger.info("inject: source=%s dest=%s count=%d prefix=%s", source_folder, dest_folder, count, prefix)

    if not os.path.exists(source_folder):
        logger.error("Source folder not found: %s", source_folder)
        return 0

    if not os.path.exists(dest_folder):
        logger.error("Destination folder not found: %s", dest_folder)
        return 0

    available = list_images(source_folder)
    if not available:
        logger.warning("No images found in %s", source_folder)
        return 0

    logger.info("Found %d images in source folder", len(available))

    to_inject = random.sample(available, min(count, len(available)))
    if len(to_inject) < count:
        logger.warning("Only %d images available, requested %d", len(to_inject), count)

    injected = 0
    for idx, src_path in enumerate(to_inject, 1):
        try:
            img = Image.open(src_path).convert("RGB")
            img = resize_cover(img, target_w, target_h)

            src_name = Path(src_path).stem
            filename = f"{prefix}_{idx:03d}_{src_name}.jpg"
            dest_path = os.path.join(dest_folder, filename)

            img.save(dest_path, "JPEG", quality=92, optimize=True)
            logger.info("%d/%d saved %s", idx, len(to_inject), filename)
            injected += 1
        except Exception as e:
            logger.error("%d/%d error processing %s: %s", idx, len(to_inject), Path(src_path).name, e)

    logger.info("Done. Injected %d %s images.", injected, prefix)
    return injected
