# Cogito SaaS — Backend

## Overview
FastAPI Python backend for the Cogito Content Studio SaaS.
Deployed to **Railway** at `https://your-backend.up.railway.app`.

## Stack
- **Python 3.11** + **FastAPI** + **Uvicorn**
- **Supabase** (Postgres + Storage + Auth)
- **Stripe** (subscriptions + webhooks)
- **ffmpeg** (system-level, installed via nixpacks.toml)

## Project Structure
```
backend/
├── main.py                    # FastAPI app, CORS, lifespan, router includes
├── requirements.txt
├── nixpacks.toml              # Railway deployment (installs ffmpeg + python311)
├── .env.example               # Required env vars template
├── routers/
│   ├── auth.py                # JWT validation dependency (get_current_user_id)
│   ├── generate.py            # POST /api/generate — subscription gate + job dispatch
│   ├── jobs.py                # GET/DELETE /api/jobs, GET /api/jobs/{id}
│   └── stripe_webhook.py      # POST /stripe/webhook — Stripe event handler
├── services/
│   ├── image_pipeline.py      # Unsplash fetch (extracted from unsplash_extract_plus.py)
│   ├── image_grader.py        # Colour grading (extracted from color_grade.py)
│   ├── image_injector.py      # Accent/philosopher image injection
│   ├── video_builder.py       # ffmpeg slideshow renderer (extracted from slideshow_from_images.py)
│   ├── job_manager.py         # Async job lifecycle + pipeline orchestration
│   └── storage.py             # Supabase Storage upload/signed URL/delete
├── models/
│   └── schemas.py             # Pydantic v2 request/response models
└── db/
    └── supabase_client.py     # Supabase client singleton (service_role key)
```

## Running Locally
```bash
cd C:\Documents\Cogito\saas\backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
# Copy .env.example → .env and fill in keys
ENABLE_DOCS=true .venv/Scripts/uvicorn main:app --reload --port 8001
# Swagger UI: http://localhost:8001/docs
# Health:     http://localhost:8001/health
```

> **Port 8001** — port 8000 is occupied by another local service on this machine.
> Frontend `.env.local` already points `VITE_API_URL` at port 8001.

## Key API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /health | None | Health check |
| POST | /api/generate | JWT | Create + queue video job |
| GET | /api/jobs | JWT | Last 10 jobs for user |
| GET | /api/jobs/{id} | JWT | Job status + output URL |
| DELETE | /api/jobs/{id} | JWT | Cancel/delete job + storage file |
| POST | /stripe/webhook | Stripe sig | Handle subscription events |

## Required Environment Variables
```
SUPABASE_URL
SUPABASE_SERVICE_KEY      # service_role key — server-side only
SUPABASE_JWT_SECRET       # from Supabase dashboard > Settings > API
UNSPLASH_ACCESS_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
FRONTEND_URL              # CORS allow-origin (Vercel URL)
RAILWAY_PUBLIC_DOMAIN     # TrustedHost middleware
```

## Security Architecture
- **Auth**: Every protected route validates a Supabase JWT (HS256, SUPABASE_JWT_SECRET).
  user_id extracted from `sub` claim server-side — never from request body.
- **Data isolation**: All DB queries include `.eq("user_id", user_id)` — users cannot
  access other users' jobs or files.
- **Storage isolation**: Files stored at `outputs/{user_id}/{job_id}.mp4`.
  Supabase Storage RLS policy: `(storage.foldername(name))[1] = auth.uid()::text`.
- **Subscription gate**: `/api/generate` checks `subscriptions.status = 'active'` before
  creating any job.
- **Usage rate limit**: Monthly `render_count` checked against plan limits (creator=30, pro=unlimited).
  Incremented via atomic Postgres RPC `increment_render_count`.
- **Stripe webhook**: `stripe.Webhook.construct_event()` verifies signature on every request.
  Rejected immediately (400) if signature invalid.
- **Input validation**: Pydantic v2 schemas bound all numeric fields and constrain
  resolution to allowlist. search_terms max 20 entries × 200 chars.
- **Temp files**: Each job writes to an OS temp dir scoped to job_id. Always cleaned up
  in finally block even on failure.
- **No secrets in code**: All keys from environment. App refuses to start if any missing.
- **Docs disabled in production**: `/docs` only enabled when `ENABLE_DOCS=true`.

## Pipeline Flow (per job)
```
POST /api/generate
  → validate JWT + subscription + usage
  → create job row (status='queued') — includes batch_title, color_theme
  → BackgroundTask: run_pipeline()
      1. fetch_images()          — Unsplash API (color_theme biases queries + color= param)
      2. download_and_save()     — resize + save to OS temp dir (no filter logic)
      2.5 apply_theme_grading()  — colour grade images (no-op for theme='none')
      3. render_slideshow()      — ffmpeg → output.mp4 (uses graded dir if grading applied)
      4. upload_output()         — Supabase Storage
      5. get_signed_url()        — 48hr download URL
      6. update job row          — status='done', output_url=<url>
      7. increment_render_count() — atomic Postgres RPC
      8. cleanup temp dir
```

## Deployment (Railway)
```bash
# nixpacks.toml handles ffmpeg installation automatically
git push railway main
```

## Database Schema
See `../supabase_schema.sql` for full schema with RLS policies.

## What Is NOT In This Backend
- Long-form pipeline (WhisperX, audio stitching, Pexels, draft video) — dropped for MVP
- Accent/philosopher image injection — can be added as Pro feature post-MVP

## Local Verification
```bash
# Before deploying, run this to confirm service modules + ffmpeg work:
cd C:\Documents\Cogito\saas\backend
python test_local.py
# Requires: UNSPLASH_ACCESS_KEY in .env, ffmpeg on PATH, venv activated
```

## Development Status
- [x] Phase 1: Service modules (image_pipeline, image_grader, image_injector, video_builder)
- [x] Phase 2: FastAPI backend (main, routers, schemas, DB client)
- [x] Phase 3: Stripe webhook + subscription gate
- [x] Phase 5: Nightly cleanup Edge Function (`../supabase/functions/cleanup-expired-outputs/`)
- [x] Pre-Phase-4 UX improvements (before deploy):
  - [x] colour_theme replaces prefer_brown (7 themes, biases search + applies grading)
  - [x] image_grader.py wired into pipeline as Step 2.5 (apply_theme_grading)
  - [x] batch_title stored in jobs table, returned in all job responses
  - [x] jobs table: `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS batch_title TEXT;` — run in Supabase SQL editor
- [x] asyncio.to_thread: fetch_images, download_and_save, apply_theme_grading, render_slideshow
      all run in thread pool — event loop no longer blocked during pipeline (fixes stuck status polls)
- [x] Reuse feature: list_jobs now selects config; search_terms exposed in JobListItem response
- [x] Local dev stack running and tested (backend :8001 healthy, frontend :5175 live)
- [ ] Phase 6: Railway deployment
  - [ ] Set env vars in Railway dashboard
  - [ ] `git push railway main`
  - [ ] Register Stripe webhook endpoint → copy secret to STRIPE_WEBHOOK_SECRET
