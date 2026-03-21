# Cogito SaaS — Backend

## Overview
FastAPI Python backend for the Cogito Content Studio SaaS.
Deployed to **Railway** at `https://your-backend.up.railway.app`.

## Stack
- **Python 3.11** + **FastAPI** + **Uvicorn**
- **Supabase** (Postgres + Storage + Auth)
- **Stripe** (subscriptions + webhooks)
- **ffmpeg** (system-level, installed via Dockerfile `apt-get install ffmpeg`)

## Project Structure
```
backend/
├── main.py                    # FastAPI app, CORS, lifespan, router includes
├── requirements.txt
├── Dockerfile                 # Railway deployment (python:3.11-slim + apt ffmpeg)
├── .env.example               # Required env vars template
├── routers/
│   ├── auth.py                # JWT validation dependency (get_current_user_id)
│   ├── generate.py            # POST /api/generate — subscription gate + job dispatch
│   ├── jobs.py                # GET/DELETE /api/jobs, GET /api/jobs/{id}
│   ├── presets.py             # CRUD /api/presets — named settings presets
│   ├── preview.py             # POST /api/preview-stage — image staging without render
│   ├── stripe_webhook.py      # POST /stripe/webhook — Stripe event handler
│   ├── trial_auth.py          # POST /api/auth/check-invite + claim-invite (no auth)
│   └── admin.py               # /api/admin/* — invite management, users, email (X-Admin-Key)
├── services/
│   ├── image_pipeline.py      # Unsplash fetch (extracted from unsplash_extract_plus.py)
│   ├── image_grader.py        # Colour grading (extracted from color_grade.py)
│   ├── image_injector.py      # Accent/philosopher image injection
│   ├── video_builder.py       # ffmpeg slideshow renderer; supports drawtext overlay (FONT_MAP, COLOR_MAP, _escape_drawtext, _build_drawtext)
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
| POST | /api/generate | JWT | Create + queue single video job |
| POST | /api/variants | JWT | Create N jobs (one per theme) sharing a single image fetch |
| GET | /api/jobs | JWT | Last 10 jobs for user |
| GET | /api/jobs/{id} | JWT | Job status + output URL |
| DELETE | /api/jobs/{id} | JWT | Cancel/delete job + storage file |
| POST | /api/preview-stage | JWT | Fetch + stage images for preview (no video render) |
| POST | /api/presets | JWT | Save a named settings preset |
| GET | /api/presets | JWT | List user's presets |
| DELETE | /api/presets/{id} | JWT | Delete a preset |
| POST | /api/upload-images | JWT | Upload user images to Supabase Storage |
| POST | /api/prefetch-images | JWT | Pre-fetch Unsplash images to storage |
| POST | /api/jobs/{id}/resign | JWT | Re-generate expired signed URL for completed job |
| GET | /api/usage | JWT | Get current plan, render count, trial expiry |
| POST | /stripe/webhook | Stripe sig | Handle subscription events |
| POST | /api/auth/check-invite | None | Check if email is in trial_invites (not_found/unclaimed/claimed) |
| POST | /api/auth/claim-invite | None | Create Supabase auth user from trial invite + mark claimed |
| POST | /api/admin/invite | X-Admin-Key | Add email to trial_invites |
| DELETE | /api/admin/invite | X-Admin-Key | Remove email from trial_invites |
| GET | /api/admin/users | X-Admin-Key | List invites enriched with subscription + usage data |
| POST | /api/admin/send-invite | X-Admin-Key | Send invite email via Resend |
| POST | /api/admin/adjust-renders | X-Admin-Key | Reset or add to a user's monthly render count |

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
ADMIN_SECRET_KEY          # X-Admin-Key header value for admin endpoints
RESEND_API_KEY            # Resend email API key (for admin invite emails)
RESEND_FROM_EMAIL         # From address (default: noreply@passiveclip.com)
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

## Pipeline Flow

### Single job (POST /api/generate)
```
  → validate JWT + subscription + usage
  → create job row (status='queued') — includes batch_title, color_theme
  → BackgroundTask: run_pipeline()
      1. fetch_images()          — Unsplash API; raises RateLimitError on 403
                                   caught in async loop: update status message + await asyncio.sleep(wait)
                                   then retry — job never terminates on rate limit
      2. download_and_save()     — concurrent downloads via ThreadPoolExecutor(max_workers=8)
                                   uses urls["regular"] (not "full") for speed
                                   on_progress callback updates DB after each image: "Downloading X/Y images…"
                                   _make_download_progress_cb() in job_manager.py creates the sync callback
      2.5 apply_theme_grading()  — colour grade images (no-op for theme='none')
      3. render_slideshow()      — ffmpeg → output.mp4; optional text_overlay burns drawtext caption via -vf chain
      4. upload_output()         — Supabase Storage outputs/{user_id}/{job_id}.mp4
      5. get_signed_url()        — 48hr download URL
      6. update job row          — status='done', output_url=<url>
      7. increment_render_count() — atomic Postgres RPC
      8. cleanup temp dir
```

### Variants (POST /api/variants)
```
  → validate JWT + subscription + usage (checks count + len(themes) vs limit)
  → create N job rows (one per theme, all status='queued')
  → BackgroundTask: run_variants_pipeline()
      1. fetch_images() once → shared temp dir (same RateLimitError retry loop, updates ALL job rows)
      2. download_and_save() → shared images dir
      For each theme (sequential):
        3. apply_theme_grading()   — grade copy of shared images
        4. render_slideshow()      — ffmpeg → variant output.mp4
        5. upload + sign + update job row done + increment_usage
      6. cleanup shared temp dir
```

### RateLimitError pattern (critical)
`fetch_page()` raises `RateLimitError(wait)` on 403 + "Rate Limit" response.
Pipeline catches it in `while True` loop:
```python
while True:
    try:
        items = await asyncio.to_thread(fetch_images, ...)
        break
    except RateLimitError as e:
        await update_job_status(job_id, "running", f"Unsplash rate limit — retrying in {e.wait}s…")
        await asyncio.sleep(e.wait)
```
Never uses blocking `time.sleep` in the async pipeline — uses `await asyncio.sleep`.

## Deployment (Railway)
```bash
# Dockerfile handles Python 3.11 + ffmpeg installation automatically
git push railway main
```

## Colour Themes (9 total)
| Value    | Display Name  | Search hint  | Unsplash color= | Grade fn           | Condition                  |
|----------|---------------|--------------|-----------------|-------------------|----------------------------|
| none     | Natural       | —            | —               | none              | —                          |
| dark     | Dark Tones    | dark         | black           | grade_bw_dark     | brightness > 0.15 (too bright) |
| sepia    | Sepia         | sepia        | orange          | grade_sepia       | brown_ratio < 0.10         |
| warm     | Amber         | amber        | orange          | grade_brown       | brown_ratio < 0.08         |
| grey     | Silver        | silver       | —               | grade_grey        | always                     |
| blue     | Cobalt        | cobalt       | blue            | grade_blue        | always                     |
| red      | Crimson       | crimson      | red             | grade_red         | always                     |
| bw       | Monochrome    | monochrome   | black_and_white | grade_bw          | always                     |
| low_exp  | Low Exposure  | shadows      | black           | grade_low_exposure| always                     |

All 9 values listed in `ALLOWED_COLOR_THEMES` in `models/schemas.py`.

## Text Overlay (drawtext)
Configured via `TextOverlayConfig` in `GenerateRequest.text_overlay` (optional, null = no overlay).
Stored in `jobs.config` JSONB as a dict. Passed to `render_slideshow(text_overlay=...)`.

Key points:
- `_build_drawtext()` returns None if overlay disabled, text blank, or font file missing (job still completes)
- Newlines escaped as `\\n` (two backslashes + n) so AVOption layer strips one, leaving `\n` for drawtext
- Font resolved from `FONT_MAP` (15 keys). Font file basename used as `fontfile=` so ffmpeg resolves it relative to `cwd=_FONTS_DIR` (avoids Windows drive-letter colon in filter string)
- `alignment` field controls `x` position (left/center/right margins); `position` field controls `y` (top/middle/bottom)
- `color` can be `white/cream/gold/black` (from `COLOR_MAP`) or `custom` with a hex value
- Font files live in `backend/fonts/` and must be downloaded manually (not committed)

## Database Schema
See `../supabase/schema.sql` for full schema with RLS policies.

## Trial Auth Flow
Closed-beta invite system — no public sign-up.
1. Admin adds email to `trial_invites` table (via Supabase dashboard or `POST /api/admin/invite`)
2. Admin sends invite link manually or via `POST /api/admin/send-invite` (Resend)
3. User visits `/login`, enters email → `check-invite` returns unclaimed
4. User sets password → `claim-invite` creates Supabase auth user + marks invite claimed
5. Frontend auto signs in via `supabase.auth.signInWithPassword`
- `claimed=true` prevents re-activation; user uses "Forgot password?" to reset

## Admin Panel
- All endpoints secured by `X-Admin-Key: <ADMIN_SECRET_KEY>` header
- `GET /api/admin/users` — enriched view: invite status + plan + render count + last job
- `POST /api/admin/adjust-renders` — `action='reset'` (restore full allowance) or `action='add'` (credit extra renders)
- Email sending uses Resend API (`httpx` async client)

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
- [x] Pre-deploy UX improvements:
  - [x] colour_theme (9 themes): biases Unsplash query + applies grading in pipeline
  - [x] Themes: none, dark, sepia, warm, grey, blue, red, bw, low_exp
  - [x] image_grader.py wired into pipeline as Step 2.5 (apply_theme_grading)
  - [x] batch_title stored in jobs table, returned in all job responses
  - [x] asyncio.to_thread: all blocking pipeline steps run in thread pool
  - [x] Concurrent image downloads (ThreadPoolExecutor max_workers=8)
  - [x] RateLimitError: non-blocking async retry with user-visible status message
  - [x] POST /api/variants: single image fetch shared across N theme renders
  - [x] Reuse/Duplicate feature: list_jobs selects config; search_terms in response
  - [x] Preview staging: POST /api/preview-stage
  - [x] User image uploads: POST /api/upload-images (user-uploads bucket)
  - [x] Presets CRUD: POST/GET/DELETE /api/presets
  - [x] URL re-signing: POST /api/jobs/{id}/resign
  - [x] Trial auth: POST /api/auth/check-invite + claim-invite
  - [x] Admin endpoints: invite CRUD, enriched user list, send invite email, adjust renders
  - [x] email-validator added to requirements.txt for pydantic EmailStr
  - [x] httpx added to requirements.txt for Resend async calls
- [x] Local dev running (backend :8001 healthy, frontend :5175 live)
- [x] Phase 6: Railway deployed (auto-deploys on push to main)
  - [x] Set env vars in Railway dashboard
  - [ ] Register Stripe webhook endpoint → copy secret to STRIPE_WEBHOOK_SECRET
  - [ ] Set ADMIN_SECRET_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL in Railway
