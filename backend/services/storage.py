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
    List all file names inside the accent bucket at prefix /{folder}/.
    Returns a list of full storage paths e.g. ["blue/img001.jpg", ...].
    """
    client = get_client()
    result = client.storage.from_("accent").list(folder)
    paths = [f"{folder}/{item['name']}" for item in (result or []) if item.get("name")]
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
