"""
clip_job_manager.py

Pipeline orchestration for Video Clips jobs.
Mirrors job_manager.py's pattern but downloads video clips instead of images.

Reuses from job_manager.py:
  - _get_semaphore()       — shared concurrency slot with image jobs
  - create_job()           — inserts job row
  - update_job_status()    — status updates
  - _increment_usage()     — monthly render counter

Reuses from storage.py:
  - upload_output()        — uploads MP4 to Supabase Storage
  - get_signed_url()       — 48h signed download URL
  - upload_thumbnail()     — uploads thumbnail JPEG

Reuses from video_builder.py:
  - extract_thumbnail()    — extracts a frame from the rendered MP4
"""

import asyncio
import logging
import os
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional

import requests

from db.supabase_client import get_client
from services.clip_builder import ClipSpec, render_clips
from services.job_manager import _get_semaphore, update_job_status, _increment_usage
from services.storage import upload_output, upload_thumbnail, get_signed_url
from services.video_builder import extract_thumbnail

logger = logging.getLogger(__name__)

_dl_session = requests.Session()
_dl_session.headers.update({"User-Agent": "Mozilla/5.0 (compatible; CogitoSaaS/1.0)"})


@dataclass
class ClipJobConfig:
    clip_specs: List[Dict]     # [{id, download_url, trim_start, trim_end, duration}]
    resolution: str = "1080x1920"
    fps: int = 30
    color_theme: str = "none"
    transition: str = "cut"
    transition_duration: float = 0.5
    max_clip_duration: int = 10
    batch_title: Optional[str] = None
    text_overlay: Optional[Dict] = None

    def parse_resolution(self):
        w, h = self.resolution.lower().split("x")
        return int(w), int(h)

    def to_dict(self) -> dict:
        return {
            "mode": "clips",
            "clip_count": len(self.clip_specs),
            "resolution": self.resolution,
            "fps": self.fps,
            "color_theme": self.color_theme,
            "transition": self.transition,
            "transition_duration": self.transition_duration,
        }


def _download_clip(download_url: str, dest_path: str) -> bool:
    """Download a single video clip to dest_path. Returns True on success."""
    try:
        with _dl_session.get(download_url, stream=True, timeout=60) as r:
            r.raise_for_status()
            with open(dest_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 256):
                    f.write(chunk)
        return True
    except Exception as e:
        logger.error("Failed to download clip %s: %s", download_url, e)
        return False


async def run_clips_pipeline(job_id: str, user_id: str, config: ClipJobConfig, db) -> None:
    """
    Full clip pipeline executed as a FastAPI BackgroundTask.
    Acquires the shared _pipeline_semaphore to cap concurrent memory usage.

    Steps:
      1. Download clips concurrently (2 workers — clips are 5-30MB each)
      2. render_clips() — ffmpeg filter_complex: trim + concat + grade + drawtext
      3. extract_thumbnail()
      4. upload_output() + get_signed_url()
      5. Mark job done
      6. increment_usage()
    """
    async with _get_semaphore():
        await _run_clips_pipeline_inner(job_id, user_id, config, db)


async def _run_clips_pipeline_inner(job_id: str, user_id: str, config: ClipJobConfig, db) -> None:
    width, height = config.parse_resolution()
    tmp_root = tempfile.mkdtemp(prefix=f"clips_{job_id}_")
    clips_dir = os.path.join(tmp_root, "clips")
    os.makedirs(clips_dir, exist_ok=True)
    output_file = os.path.join(tmp_root, "output.mp4")

    try:
        # --- Step 1: Download clips ---
        n = len(config.clip_specs)
        await update_job_status(job_id, user_id, "running", db,
                                progress_message=f"Downloading {n} clip{'s' if n != 1 else ''}…")

        # Build (idx, spec) list for download
        download_tasks = [
            (i, spec) for i, spec in enumerate(config.clip_specs)
        ]

        local_paths: Dict[int, Optional[str]] = {}

        def _dl_task(idx_spec):
            idx, spec = idx_spec
            dest = os.path.join(clips_dir, f"clip_{idx:03d}.mp4")
            ok = _download_clip(spec["download_url"], dest)
            return idx, dest if ok else None

        downloaded = 0
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = {pool.submit(_dl_task, t): t for t in download_tasks}
            for future in as_completed(futures):
                idx, path = future.result()
                local_paths[idx] = path
                if path:
                    downloaded += 1
                    try:
                        get_client().table("jobs").update({
                            "progress_message": f"Downloading clips {downloaded}/{n}…"
                        }).eq("id", job_id).eq("user_id", user_id).neq("status", "deleted").execute()
                    except Exception:
                        pass

        # Build ClipSpec list in original order, skipping failed downloads
        clip_specs_for_render: List[ClipSpec] = []
        failed_downloads = 0
        for i, spec in enumerate(config.clip_specs):
            path = local_paths.get(i)
            if path and os.path.exists(path):
                clip_specs_for_render.append(ClipSpec(
                    local_path=path,
                    trim_start=float(spec.get("trim_start", 0.0)),
                    trim_end=float(spec.get("trim_end", 0.0)),
                    duration=int(spec.get("duration", 10)),
                ))
            else:
                failed_downloads += 1

        if not clip_specs_for_render:
            raise RuntimeError("All clip downloads failed — no clips available to render.")

        if failed_downloads > 0:
            logger.warning("Job %s: %d/%d clips failed to download", job_id, failed_downloads, n)
            await update_job_status(job_id, user_id, "running", db,
                                    progress_message=f"Downloaded {len(clip_specs_for_render)}/{n} clips ({failed_downloads} failed) — rendering…")

        logger.info("Downloaded %d/%d clips for job %s", len(clip_specs_for_render), n, job_id)

        # Validate clip durations against transition duration (crossfade only)
        if config.transition == "crossfade" and len(clip_specs_for_render) > 1:
            from services.clip_builder import _clip_duration
            mcd = float(config.max_clip_duration)
            td = config.transition_duration
            short_clips = [
                i for i, spec in enumerate(clip_specs_for_render)
                if _clip_duration(spec, mcd) < td
            ]
            if short_clips:
                raise RuntimeError(
                    f"Crossfade transition ({td}s) exceeds the duration of clip(s) "
                    f"{[i+1 for i in short_clips]}. Reduce transition duration or increase clip length."
                )

        # --- Step 2: Render ---
        await update_job_status(job_id, user_id, "running", db, progress_message="Rendering video…")
        result = await asyncio.to_thread(
            render_clips,
            clip_specs=clip_specs_for_render,
            output_file=output_file,
            width=width,
            height=height,
            fps=config.fps,
            transition=config.transition,
            transition_duration=config.transition_duration,
            color_theme=config.color_theme,
            text_overlay=config.text_overlay,
            max_clip_duration=config.max_clip_duration,
        )
        if result["returncode"] != 0:
            logger.error("ffmpeg failed (rc=%d). Last 20 lines:\n%s",
                         result["returncode"], "\n".join(result["log"][-20:]))
            raise RuntimeError(f"ffmpeg failed (rc={result['returncode']}). Check server logs.")

        # --- Step 3: Thumbnail ---
        thumb_url = None
        thumb_file = os.path.join(tmp_root, "thumb.jpg")
        try:
            # Use 30% into the video for the thumbnail
            total_secs = sum(
                (s.trim_end if s.trim_end > 0 else float(s.duration)) - s.trim_start
                for s in clip_specs_for_render
            )
            thumb_ok = await asyncio.to_thread(extract_thumbnail, output_file, thumb_file, total_secs)
            if thumb_ok:
                thumb_path = await upload_thumbnail(thumb_file, user_id, job_id)
                thumb_url = await get_signed_url(thumb_path, expiry_seconds=172800)
        except Exception as e:
            logger.warning("Thumbnail failed (non-fatal): %s", e)

        # --- Step 4: Upload ---
        await update_job_status(job_id, user_id, "running", db, progress_message="Uploading output…")
        storage_path = await upload_output(output_file, user_id, job_id)
        signed_url = await get_signed_url(storage_path)

        # --- Step 5: Mark done ---
        await update_job_status(
            job_id, user_id, "done", db,
            output_url=signed_url,
            thumbnail_url=thumb_url,
            progress_message="Done",
            completed_at=datetime.now(timezone.utc).isoformat(),
        )

        # --- Step 6: Increment usage ---
        await _increment_usage(user_id, db)
        logger.info("Clips pipeline complete for job %s", job_id)

    except Exception as exc:
        logger.exception("Clips pipeline failed for job %s: %s", job_id, exc)
        await update_job_status(
            job_id, user_id, "failed", db,
            error_message=str(exc),
            completed_at=datetime.now(timezone.utc).isoformat(),
        )

    finally:
        try:
            shutil.rmtree(tmp_root, ignore_errors=True)
            logger.debug("Cleaned up clips temp dir: %s", tmp_root)
        except Exception:
            pass
