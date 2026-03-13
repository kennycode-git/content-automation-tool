# PassiveClip — Content Automation Tool

A SaaS platform that generates branded video slideshows from curated stock images, driven by search terms and colour themes.

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python 3.11) — Railway |
| Frontend | Vite 6 + React 18 + TypeScript + Tailwind CSS — Vercel |
| Database / Auth / Storage | Supabase (Postgres + Storage + Auth) |
| Payments | Stripe (subscription + webhooks) |
| Video | ffmpeg (via Dockerfile on Railway) |

## Features

- **Batch generation** — define multiple `# Title` blocks to generate several videos in one go
- **Colour themes** — Natural, Dark Tones, Sepia, Amber, Low Exposure, Silver, Cobalt, Crimson, Monochrome (9 themes)
- **Image pipeline** — Pexels/Unsplash search → download → colour grade → ffmpeg slideshow → Supabase Storage
- **Photos tool** — extract and download Pexels images with colour grading, without rendering a video
- **Inspiration carousel** — 7 style presets with hover-to-play video previews; one click applies theme + term bundle
- **Colour variants** — generate the same content in all 9 themes simultaneously (shared server-side image fetch)
- **Preview staging** — preview and curate fetched images before committing to a full render
- **Custom presets** — save and reuse video settings per account
- **Job panel** — real-time progress tracking with pipeline overlay and cancel support
- **Onboarding tour** — 7-step spotlight tour for new users
- **AI prompt tool** — copy-paste prompt template for generating batch lists with ChatGPT/Claude
- **Subscription gating** — Creator (30 renders/month) and Pro (unlimited) plans via Stripe

## Project Structure

```
backend/
  main.py
  requirements.txt
  Dockerfile
  routers/        auth.py  generate.py  jobs.py  presets.py  stripe_webhook.py  preview.py
  services/       image_pipeline.py  image_grader.py  image_injector.py
                  pexels_pipeline.py  job_manager.py  video_builder.py  storage.py
  models/         schemas.py
  db/             supabase_client.py

frontend/src/
  pages/          Dashboard.tsx  Login.tsx  Photos.tsx  Pricing.tsx  Account.tsx
  components/     AppNavbar.tsx  BatchEditor.tsx  SettingsPanel.tsx
                  InspirationCarousel.tsx  OnboardingTour.tsx  PromptModal.tsx
                  TermBundles.tsx  JobPanel.tsx  RecentJobs.tsx
                  AdvancedModal.tsx  PresetManager.tsx  Toast.tsx  PreviewModal.tsx
  lib/            api.ts  supabase.ts
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /health | None | Health check |
| POST | /api/generate | JWT | Create + queue a single video job |
| POST | /api/variants | JWT | Create N jobs (one per theme), shared image fetch |
| GET | /api/jobs | JWT | List last 10 jobs |
| GET | /api/jobs/{id} | JWT | Job status + output URL |
| DELETE | /api/jobs/{id} | JWT | Cancel/delete job + storage file |
| POST | /api/preview-stage | JWT | Fetch + stage images for preview (no render) |
| POST | /api/presets | JWT | Save a named settings preset |
| GET | /api/presets | JWT | List user's presets |
| DELETE | /api/presets/{id} | JWT | Delete a preset |
| POST | /api/upload-images | JWT | Upload user images to Supabase Storage |
| POST | /api/jobs/{id}/resign | JWT | Re-generate expired signed URL |
| GET | /api/usage | JWT | Current plan, render count, limit, trial status |
| POST | /stripe/webhook | Stripe sig | Handle subscription lifecycle events |

## Pipeline Flow

```
POST /api/generate
  → JWT + subscription + usage gate
  → create job row
  → BackgroundTask:
      1. fetch_images()         Pexels/Unsplash search (colour-biased query)
      2. download_and_save()    concurrent downloads (ThreadPoolExecutor 8 workers)
      3. apply_theme_grading()  colour grade per theme (no-op for 'none')
      4. render_slideshow()     ffmpeg MP4
      5. upload_output()        Supabase Storage  outputs/{user_id}/{job_id}.mp4
      6. get_signed_url()       48-hour signed URL
      7. update job row → done
      8. increment_render_count()
      9. cleanup temp dir

POST /api/variants
  → creates N job rows (one per theme)
  → BackgroundTask:
      1. fetch_images() ONCE (color_theme="none") — shared across all variants
      2. For each theme: apply_theme_grading → render_slideshow → upload → sign URL
```

## Local Development

### Quick start (Windows)

Run `start.bat` from the repo root. It will:
1. Kill any existing processes on ports 8001 and 5175
2. Open a terminal window running the FastAPI backend (port 8001)
3. Open a terminal window running the Vite frontend (port 5175)

### Manual start

**Backend**

```bash
cd backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # then fill in values
uvicorn main:app --reload --port 8001
```

**Frontend**

```bash
cd frontend
npm install
npm run dev -- --port 5175
```

> **Note:** `VITE_DEV_BYPASS=true` in `.env.local` skips auth during local development. Remove before deploying.

## Environment Variables

### Backend (`.env`)

```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
UNSPLASH_ACCESS_KEY=
PEXELS_API_KEY=
FRONTEND_URL=
```

### Frontend (`.env.local`)

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=http://localhost:8001
VITE_STRIPE_CREATOR_LINK=
VITE_STRIPE_PRO_LINK=
VITE_DEV_BYPASS=true   # REMOVE before deploying
```

## Colour Themes

| Value | Label | Search hint | Grade applied |
|-------|-------|-------------|---------------|
| none | Natural | — | None |
| dark | Dark Tones | dark | grade_bw_dark (if brightness > 0.15) |
| sepia | Sepia | sepia/vintage | grade_sepia |
| warm | Amber | amber | grade_brown (if brown_ratio < 0.08) |
| low_exp | Low Exposure | shadows | grade_low_exposure (38% brightness) |
| grey | Silver | silver | grade_grey |
| blue | Cobalt | cobalt | grade_blue |
| red | Crimson | crimson | grade_red |
| bw | Monochrome | monochrome | grade_bw |

## Database

The full schema is in `supabase/schema.sql`. Key tables:

- `jobs` — id, user_id, status, progress_message, config (JSONB), output_url, error_message, batch_title, thumbnail_url, created_at, completed_at
- `subscriptions` — user_id, plan, status
- `usage` — user_id, month, render_count
- `user_presets` — id, user_id, name, settings (JSONB), created_at

Also requires a private `user-uploads` Supabase Storage bucket with a SELECT policy:
```sql
(storage.foldername(name))[1] = auth.uid()::text
```

## Plans

| Plan | Renders/month | Price |
|------|--------------|-------|
| Trial | 25 | Free (time-limited) |
| Creator | 30 | £4.99/month |
| Pro | Unlimited | £9.99/month |

## Security

- `user_id` is always sourced from the verified JWT `sub` claim — never from the request body
- All database queries are scoped with `.eq("user_id", user_id)`
- Storage paths are isolated per user: `outputs/{user_id}/{job_id}.mp4`
- `color_theme` is validated against an allowlist (`ALLOWED_COLOR_THEMES`) in the Pydantic schema
- Only public keys on the frontend (Supabase anon key, Stripe Checkout links)

## Deployment

- **Backend** — push to Railway; `Dockerfile` installs Python 3.11 + ffmpeg via `apt-get`
- **Frontend** — push to Vercel; set production environment variables in the dashboard
- Set `FRONTEND_URL` in Railway to the Vercel deployment URL (for CORS)
- Stripe webhook endpoint: `POST /stripe/webhook`
