"""
storage.py

Supabase Storage helpers for output MP4 files.

Security considerations:
- Files are stored under outputs/{user_id}/{job_id}.mp4 — user_id acts as a namespace
  so users can never access each other's files.
- Signed URLs expire after 48 hours (172800s). After expiry the URL returns 401.
- The service key (used server-side only) is never sent to the frontend.
- Deletion is always scoped to the specific path, preventing accidental mass deletion.
- All functions accept user_id and job_id explicitly — no global state.
"""

import logging
import os
from pathlib import Path

from db.supabase_client import get_client

logger = logging.getLogger(__name__)

BUCKET = "outputs"
SIGNED_URL_EXPIRY = 172_800  # 48 hours


def _storage_path(user_id: str, job_id: str) -> str:
    """Canonical storage path. Scoped by user_id to prevent cross-user access."""
    return f"{user_id}/{job_id}.mp4"


async def upload_output(file_path: str, user_id: str, job_id: str) -> str:
    """
    Upload an MP4 file to Supabase Storage.

    The path is namespaced under the authenticated user's ID so bucket policies
    (RLS on storage.objects) can enforce that users only read their own files.

    Returns the storage path string.
    """
    client = get_client()
    storage_path = _storage_path(user_id, job_id)

    if not Path(file_path).is_file():
        raise FileNotFoundError(f"Output file not found: {file_path}")

    with open(file_path, "rb") as f:
        data = f.read()

    logger.info("Uploading %s bytes to %s/%s", len(data), BUCKET, storage_path)
    client.storage.from_(BUCKET).upload(
        path=storage_path,
        file=data,
        file_options={"content-type": "video/mp4", "upsert": "true"},
    )
    logger.info("Upload complete: %s", storage_path)
    return storage_path


async def get_signed_url(storage_path: str, expiry_seconds: int = SIGNED_URL_EXPIRY) -> str:
    """
    Generate a time-limited signed download URL.

    Default expiry is 48 hours. The caller should store this URL in the jobs
    table so users can retrieve it without an extra round-trip to Storage.
    """
    client = get_client()
    result = client.storage.from_(BUCKET).create_signed_url(storage_path, expiry_seconds)
    url = result.get("signedURL") or result.get("signed_url") or result.get("signedUrl")
    if not url:
        raise RuntimeError(f"Failed to generate signed URL for {storage_path}: {result}")
    logger.info("Signed URL generated (expires in %ds): ...%s", expiry_seconds, storage_path[-20:])
    return url


async def upload_thumbnail(file_path: str, user_id: str, job_id: str) -> str:
    """
    Upload a JPEG thumbnail to Supabase Storage under the outputs bucket.
    Path: {user_id}/{job_id}_thumb.jpg
    Returns the storage path string.
    """
    client = get_client()
    storage_path = f"{user_id}/{job_id}_thumb.jpg"

    if not Path(file_path).is_file():
        raise FileNotFoundError(f"Thumbnail file not found: {file_path}")

    with open(file_path, "rb") as f:
        data = f.read()

    logger.info("Uploading thumbnail %s bytes to %s/%s", len(data), BUCKET, storage_path)
    client.storage.from_(BUCKET).upload(
        path=storage_path,
        file=data,
        file_options={"content-type": "image/jpeg", "upsert": "true"},
    )
    logger.info("Thumbnail upload complete: %s", storage_path)
    return storage_path


async def upload_user_image(data: bytes, user_id: str, filename: str) -> str:
    """
    Upload a user-supplied image to the user-uploads bucket.
    Path: {user_id}/{timestamp_ms}_{safe_filename}
    Returns the storage path string.
    """
    import time
    import re
    client = get_client()
    safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", filename)[:100]
    ts = int(time.time() * 1000)
    storage_path = f"{user_id}/{ts}_{safe_name}"

    logger.info("Uploading user image %s bytes to user-uploads/%s", len(data), storage_path)
    client.storage.from_("user-uploads").upload(
        path=storage_path,
        file=data,
        file_options={"content-type": "image/jpeg", "upsert": "false"},
    )
    logger.info("User image upload complete: %s", storage_path)
    return storage_path


def list_accent_images(folder: str) -> list:
    """
    List all image files inside the accent bucket at prefix /{folder}/.
    Returns a list of full storage paths e.g. ["blue/img001.jpg", ...].
    Filters out folder placeholder entries and non-image files.
    """
    IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
    client = get_client()
    result = client.storage.from_("accent").list(folder)
    logger.info("accent/%s raw listing: %d items", folder, len(result or []))
    for item in (result or []):
        logger.debug("  accent item: name=%r id=%r metadata=%r", item.get("name"), item.get("id"), item.get("metadata"))
    paths = [
        f"{folder}/{item['name']}"
        for item in (result or [])
        if item.get("name")
        and not item["name"].startswith(".")
        and any(item["name"].lower().endswith(ext) for ext in IMAGE_EXTS)
        and item.get("id") is not None  # folder entries have id=None
    ]
    logger.info("Listed %d accent images in accent/%s", len(paths), folder)
    return paths


def download_accent_image(path: str) -> bytes:
    """Download a single file from the accent bucket by its storage path."""
    client = get_client()
    return client.storage.from_("accent").download(path)


USER_UPLOADS_BUCKET = "user-uploads"
PREVIEW_SIGNED_URL_EXPIRY = 14_400  # 4 hours


async def get_user_uploads_signed_url(storage_path: str, expiry_seconds: int = PREVIEW_SIGNED_URL_EXPIRY) -> str:
    """
    Generate a time-limited signed URL for a file in the user-uploads bucket.
    Used to serve preview images to the frontend modal.
    Default expiry is 4 hours.
    """
    client = get_client()
    result = client.storage.from_(USER_UPLOADS_BUCKET).create_signed_url(storage_path, expiry_seconds)
    url = result.get("signedURL") or result.get("signed_url") or result.get("signedUrl")
    if not url:
        raise RuntimeError(f"Failed to generate signed URL for user-uploads/{storage_path}: {result}")
    logger.info("Preview signed URL generated (expires in %ds): ...%s", expiry_seconds, storage_path[-30:])
    return url


async def delete_file(storage_path: str) -> None:
    """
    Delete a file from Supabase Storage.

    Called when a job is cancelled/deleted, or by the nightly cleanup Edge Function
    for files whose signed URLs have expired.
    """
    client = get_client()
    logger.info("Deleting storage file: %s", storage_path)
    client.storage.from_(BUCKET).remove([storage_path])
    logger.info("Deleted: %s", storage_path)


# ─── Raw image cache (for post-render re-grading) ────────────────────────────
# Raw (ungraded) images are stored at outputs/raw/{user_id}/{job_id}/{filename}
# after pipeline completion, enabling fast re-grading without re-fetching.

def _raw_prefix(user_id: str, job_id: str) -> str:
    return f"raw/{user_id}/{job_id}"


def list_raw_image_paths(user_id: str, job_id: str) -> list:
    """List all cached raw image paths for a job. Returns full storage paths."""
    IMAGE_EXTS = {".jpg", ".jpeg", ".png"}
    prefix = _raw_prefix(user_id, job_id)
    client = get_client()
    result = client.storage.from_(BUCKET).list(prefix)
    return [
        f"{prefix}/{item['name']}"
        for item in (result or [])
        if item.get("name")
        and not item["name"].startswith(".")
        and any(item["name"].lower().endswith(ext) for ext in IMAGE_EXTS)
        and item.get("id") is not None
    ]


def upload_raw_images(images_dir: str, user_id: str, job_id: str) -> int:
    """
    Upload all JPEG images from images_dir to the raw cache in Supabase Storage.
    Uses a thread pool for concurrent uploads. Returns count of uploaded files.
    Called via asyncio.to_thread from the pipeline.
    """
    import concurrent.futures

    IMAGE_EXTS = {".jpg", ".jpeg", ".png"}
    prefix = _raw_prefix(user_id, job_id)
    client = get_client()

    files = [
        f for f in os.listdir(images_dir)
        if any(f.lower().endswith(ext) for ext in IMAGE_EXTS)
    ]
    if not files:
        logger.warning("upload_raw_images: no image files found in %s", images_dir)
        return 0

    def _upload_one(fname: str) -> bool:
        fpath = os.path.join(images_dir, fname)
        storage_path = f"{prefix}/{fname}"
        with open(fpath, "rb") as f:
            data = f.read()
        client.storage.from_(BUCKET).upload(
            path=storage_path,
            file=data,
            file_options={"content-type": "image/jpeg", "upsert": "true"},
        )
        return True

    uploaded = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(_upload_one, fname): fname for fname in files}
        for fut in concurrent.futures.as_completed(futures):
            try:
                fut.result()
                uploaded += 1
            except Exception as exc:
                logger.warning("Failed to upload raw image %s: %s", futures[fut], exc)

    logger.info("Uploaded %d/%d raw images for job %s", uploaded, len(files), job_id)
    return uploaded


def download_raw_images_to_dir(user_id: str, job_id: str, dest_dir: str) -> int:
    """
    Download all cached raw images for a job to dest_dir.
    Uses a thread pool for concurrent downloads. Returns count of downloaded files.
    Called via asyncio.to_thread from the regrade pipeline.
    """
    import concurrent.futures

    os.makedirs(dest_dir, exist_ok=True)
    paths = list_raw_image_paths(user_id, job_id)
    if not paths:
        return 0
    client = get_client()

    def _download_one(storage_path: str) -> bool:
        fname = os.path.basename(storage_path)
        data = client.storage.from_(BUCKET).download(storage_path)
        with open(os.path.join(dest_dir, fname), "wb") as f:
            f.write(data)
        return True

    downloaded = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_download_one, p): p for p in paths}
        for fut in concurrent.futures.as_completed(futures):
            try:
                fut.result()
                downloaded += 1
            except Exception as exc:
                logger.warning("Failed to download raw image %s: %s", futures[fut], exc)

    logger.info("Downloaded %d/%d raw images for job %s", downloaded, len(paths), job_id)
    return downloaded


def delete_raw_images(user_id: str, job_id: str) -> None:
    """Delete all cached raw images for a job from Supabase Storage."""
    paths = list_raw_image_paths(user_id, job_id)
    if not paths:
        logger.debug("delete_raw_images: no cached images found for job %s", job_id)
        return
    client = get_client()
    client.storage.from_(BUCKET).remove(paths)
    logger.info("Deleted %d raw images for job %s", len(paths), job_id)
