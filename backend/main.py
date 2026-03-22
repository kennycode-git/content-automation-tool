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

import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from routers import admin, auth, generate, jobs, presets, preview, stripe_webhook, trial_auth

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
        from datetime import datetime, timezone
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
frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:5173")
cors_origins = ["*"] if os.environ.get("ENABLE_DOCS") == "true" else [frontend_url]
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
app.include_router(admin.router, prefix="/api", tags=["admin"])


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok"}
