# Cogito — Content Automation Tool

A SaaS platform that generates branded video slideshows from curated stock images, driven by search terms and colour themes.

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python 3.11) — Railway |
| Frontend | Vite 6 + React 18 + TypeScript + Tailwind CSS — Vercel |
| Database / Auth / Storage | Supabase (Postgres + Storage + Auth) |
| Payments | Stripe (subscription + webhooks) |
| Video | ffmpeg (via nixpacks.toml on Railway) |

## Features

- **Batch generation** — define multiple `# Title` blocks to generate several videos in one go
- **Colour themes** — Natural, Dark Tones, Amber & Earth, Silver & Slate, Cobalt & Mist, Crimson & Rose, Monochrome
- **Image pipeline** — Unsplash search → download → colour grade → ffmpeg slideshow → Supabase Storage
- **Preview staging** — preview fetched images before committing to a full render
- **Custom presets** — save and reuse video settings per account
- **Job panel** — real-time progress tracking with cancel support
- **Subscription gating** — Creator (30 renders/month) and Pro (unlimited) plans via Stripe

## Project Structure

```
backend/
  main.py
  requirements.txt
  nixpacks.toml
  routers/        auth.py  generate.py  jobs.py  stripe_webhook.py
  services/       image_pipeline.py  image_grader.py  job_manager.py
                  video_builder.py  storage.py
  models/         schemas.py
  db/             supabase_client.py

frontend/src/
  pages/          Dashboard.tsx  Login.tsx  Pricing.tsx  Account.tsx
  components/     BatchEditor.tsx  SettingsPanel.tsx  JobPanel.tsx
                  RecentJobs.tsx  AdvancedModal.tsx  PresetManager.tsx
                  Toast.tsx  PreviewModal.tsx
  lib/            api.ts  supabase.ts
```

## Pipeline Flow

```
POST /api/generate
  → JWT + subscription + usage gate
  → create job row
  → BackgroundTask:
      1. fetch_images()         Unsplash search (colour-biased query + color= param)
      2. download_and_save()    resize + save originals
      3. apply_theme_grading()  colour grade per theme
      4. render_slideshow()     ffmpeg MP4
      5. upload_output()        Supabase Storage  outputs/{user_id}/{job_id}.mp4
      6. get_signed_url()       48-hour signed URL
      7. update job row → done
      8. increment_render_count()
      9. cleanup temp dir
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
```

### Frontend (`.env.local`)

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=http://localhost:8001
```

## Database

The full schema is in `supabase/schema.sql`. Run the following in the Supabase SQL editor:

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS batch_title TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

CREATE TABLE user_presets (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES auth.users NOT NULL,
  name       TEXT NOT NULL CHECK (char_length(name) <= 60),
  settings   JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_presets"
  ON user_presets FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

Also create a private `user-uploads` Supabase Storage bucket with a SELECT policy:

```sql
(storage.foldername(name))[1] = auth.uid()::text
```

## Security

- `user_id` is always sourced from the verified JWT `sub` claim — never from the request body
- All database queries are scoped with `.eq("user_id", user_id)`
- Storage paths are isolated per user: `outputs/{user_id}/{job_id}.mp4`
- `color_theme` is validated against an allowlist in the Pydantic schema

## Deployment

- **Backend** — push to Railway; `nixpacks.toml` handles Python + ffmpeg install
- **Frontend** — push to Vercel; set production environment variables in the dashboard
- Stripe webhook endpoint: `POST /api/stripe/webhook`
