"""
main.py

FastAPI application entry point.

Security considerations:
- CORS is restricted to FRONTEND_URL only (no wildcard in production).
- Trusted host middleware added as defence-in-depth against Host header injection.
- Structured logging ensures errors are captured by Railway without leaking
  internal stack traces to clients (FastAPI returns sanitised HTTP error responses).
- The /health endpoint requires no auth so load balancers can probe it safely.
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from routers import admin, auth, clips, generate, jobs, philosophers, presets, preview, stripe_webhook, trial_auth, tiktok as tiktok_router
from services.scheduler import scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


async def _recover_stuck_jobs() -> None:
    """
    On startup, mark any jobs still in 'running' or 'queued' state as failed.
    These are jobs that were in-flight when the process was killed (OOM, deploy, crash).
    Called once during lifespan startup — safe because no background tasks are running yet.
    """
    try:
        from db.supabase_client import get_client
        client = get_client()
        now = datetime.now(timezone.utc).isoformat()
        for stuck_status in ("running", "queued"):
            result = (
                client.table("jobs")
                .update({
                    "status": "failed",
                    "error_message": "Server restarted mid-job — please try again.",
                    "completed_at": now,
                })
                .eq("status", stuck_status)
                .execute()
            )
            count = len(result.data) if result.data else 0
            if count:
                logger.warning("Recovered %d '%s' job(s) interrupted by previous crash/restart", count, stuck_status)
    except Exception as exc:
        logger.warning("Startup job recovery failed (non-fatal): %s", exc)


def _run_cleanup_sync() -> dict:
    """
    Synchronous cleanup — runs in a thread via asyncio.to_thread.

    1. Delete Storage MP4 + thumbnail for jobs completed >48h ago.
       Nulls output_url/thumbnail_url in DB after deletion.
    2. Hard-delete job rows older than 30 days with status 'failed' or 'deleted'.
    3. Delete user-uploads preview files older than 24h.
    """
    from db.supabase_client import get_client
    client = get_client()
    now = datetime.now(timezone.utc)
    results = {"outputs_cleaned": 0, "rows_pruned": 0, "uploads_cleaned": 0, "errors": 0}

    # ── 1. Expired output files (completed >48h ago, still have a URL) ─────────
    cutoff_48h = (now - timedelta(hours=48)).isoformat()
    try:
        expired = (
            client.table("jobs")
            .select("id, user_id")
            .lt("completed_at", cutoff_48h)
            .not_.is_("output_url", "null")
            .eq("status", "done")
            .limit(100)
            .execute()
        )
        for job in (expired.data or []):
            paths = [f"{job['user_id']}/{job['id']}.mp4",
                     f"{job['user_id']}/{job['id']}_thumb.jpg"]
            try:
                client.storage.from_("outputs").remove(paths)
                client.table("jobs").update({"output_url": None, "thumbnail_url": None}) \
                    .eq("id", job["id"]).execute()
                results["outputs_cleaned"] += 1
            except Exception as e:
                logger.warning("Cleanup: failed to delete output for job %s: %s", job["id"], e)
                results["errors"] += 1
    except Exception as e:
        logger.warning("Cleanup: expired outputs query failed: %s", e)
        results["errors"] += 1

    # ── 2. Prune old failed/deleted job rows (>30 days) ───────────────────────
    cutoff_30d = (now - timedelta(days=30)).isoformat()
    try:
        for old_status in ("failed", "deleted"):
            pruned = (
                client.table("jobs")
                .delete()
                .lt("completed_at", cutoff_30d)
                .eq("status", old_status)
                .execute()
            )
            results["rows_pruned"] += len(pruned.data or [])
    except Exception as e:
        logger.warning("Cleanup: row pruning failed: %s", e)
        results["errors"] += 1

    # ── 3. User-uploads preview files older than 24h ──────────────────────────
    cutoff_24h = (now - timedelta(hours=24)).isoformat()
    try:
        folders = client.storage.from_("user-uploads").list("") or []
        for folder in (folders.data if hasattr(folders, "data") else folders):
            fname = folder.get("name") if isinstance(folder, dict) else getattr(folder, "name", None)
            if not fname:
                continue
            preview_files = client.storage.from_("user-uploads").list(f"{fname}/preview")
            files = preview_files.data if hasattr(preview_files, "data") else (preview_files or [])
            stale = [
                f"{fname}/preview/{f['name'] if isinstance(f, dict) else f.name}"
                for f in files
                if (f.get("created_at") if isinstance(f, dict) else getattr(f, "created_at", None) or "") < cutoff_24h
            ]
            if stale:
                client.storage.from_("user-uploads").remove(stale)
                results["uploads_cleaned"] += len(stale)
    except Exception as e:
        logger.warning("Cleanup: user-uploads cleanup failed: %s", e)
        results["errors"] += 1

    logger.info("Daily cleanup complete: %s", results)
    return results


async def _daily_cleanup_loop() -> None:
    """Runs cleanup once an hour after startup, then every 24 hours."""
    await asyncio.sleep(3600)  # wait 1h after boot before first run
    while True:
        try:
            await asyncio.to_thread(_run_cleanup_sync)
        except Exception as exc:
            logger.warning("Daily cleanup task error: %s", exc)
        await asyncio.sleep(24 * 60 * 60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Validate critical env vars at startup — fail fast rather than at request time.
    required = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SUPABASE_JWT_SECRET",
                "UNSPLASH_ACCESS_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        if os.environ.get("ENABLE_DOCS") == "true":
            logger.warning("Missing env vars (local dev mode — continuing): %s", ", ".join(missing))
        else:
            raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")
    logger.info("Cogito SaaS backend starting up")
    await _recover_stuck_jobs()
    asyncio.create_task(_daily_cleanup_loop())
    if os.environ.get("TIKTOK_CLIENT_KEY"):
        scheduler.start()
        logger.info("TikTok scheduler started")
    yield
    logger.info("Cogito SaaS backend shutting down")


app = FastAPI(
    title="Cogito Content Studio API",
    version="1.0.0",
    # Disable automatic OpenAPI docs in production to reduce attack surface.
    # Set ENABLE_DOCS=true locally for development.
    docs_url="/docs" if os.environ.get("ENABLE_DOCS") == "true" else None,
    redoc_url=None,
    lifespan=lifespan,
)

# CORS — allow all origins locally (ENABLE_DOCS=true), restrict to FRONTEND_URL in production.
# FRONTEND_URL supports comma-separated values, e.g.:
#   https://passiveclip.com,https://dev.passiveclip.com
_frontend_url_raw = os.environ.get("FRONTEND_URL", "http://localhost:5173")
cors_origins = ["*"] if os.environ.get("ENABLE_DOCS") == "true" else [
    u.strip() for u in _frontend_url_raw.split(",") if u.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=cors_origins != ["*"],  # credentials incompatible with wildcard
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Admin-Key"],
)

# Trusted host — reject requests with unexpected Host headers.
allowed_hosts = ["*"] if os.environ.get("ENABLE_DOCS") == "true" else [
    os.environ.get("RAILWAY_PUBLIC_DOMAIN", "localhost"),
    "localhost",
    "127.0.0.1",
]
app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)

# Routers
app.include_router(generate.router, prefix="/api", tags=["generate"])
app.include_router(jobs.router, prefix="/api", tags=["jobs"])
app.include_router(presets.router, prefix="/api", tags=["presets"])
app.include_router(preview.router, prefix="/api", tags=["preview"])
app.include_router(stripe_webhook.router, tags=["stripe"])
app.include_router(trial_auth.router, prefix="/api", tags=["trial-auth"])
app.include_router(clips.router, prefix="/api", tags=["clips"])
app.include_router(admin.router, prefix="/api", tags=["admin"])
app.include_router(philosophers.router, prefix="/api", tags=["philosophers"])


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok"}
