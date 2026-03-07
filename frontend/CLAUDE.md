# Cogito SaaS — Frontend

## Overview
Vite + React + TypeScript + Tailwind frontend for the Cogito Content Studio SaaS.
Deployed to **Vercel** at `https://your-app.vercel.app`.

## Stack
- **Vite 6** + **React 18** + **TypeScript**
- **Tailwind CSS** (dark academia palette: stone + brand amber)
- **React Query v5** (`@tanstack/react-query`) — server state + polling
- **React Router** — client-side routing
- **Supabase JS SDK** — auth + database reads

## Project Structure
```
frontend/
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
├── .env.example
└── src/
    ├── main.tsx               # Entry point, QueryClientProvider
    ├── index.css              # Tailwind directives + base styles
    ├── App.tsx                # Router, auth state, ProtectedRoute
    ├── lib/
    │   ├── supabase.ts        # Supabase client (anon key), getAccessToken()
    │   └── api.ts             # Typed fetch wrappers for FastAPI backend
    ├── pages/
    │   ├── Login.tsx          # Email/password + magic link auth
    │   ├── Dashboard.tsx      # Main tool: batch editor + settings + job status
    │   ├── Pricing.tsx        # Plan selection → Stripe Checkout
    │   └── Account.tsx        # Plan info, render usage, sign out
    └── components/
        ├── BatchEditor.tsx    # NEXT-syntax textarea + visual card editor
        ├── SettingsPanel.tsx  # Resolution, timing, filter toggles
        ├── JobPanel.tsx       # Live job status with 3s polling + download button
        └── RecentJobs.tsx     # Last 10 jobs list with delete
```

## Running Locally
```bash
cd C:\Documents\Cogito\saas\frontend
npm install
npm run dev -- --port 5175
# http://localhost:5175
```

### Dev Bypass (no Supabase needed)
`.env.local` has `VITE_DEV_BYPASS=true` — this injects a fake session so you can
browse the full UI without a real Supabase project. An amber banner appears at the
top of the Dashboard to remind you. **Remove before deploying to production.**

`.env.local` is pre-configured for local dev:
```
VITE_SUPABASE_URL=https://placeholder.supabase.co  ← replace when Supabase project created
VITE_SUPABASE_ANON_KEY=placeholder-anon-key        ← replace when Supabase project created
VITE_API_URL=http://localhost:8001                  ← backend port (8000 is occupied)
VITE_DEV_BYPASS=true                               ← REMOVE before deploy
```

## Routes
| Path | Auth | Description |
|------|------|-------------|
| /login | Public | Sign in / magic link |
| /pricing | Public | Plan selection → Stripe |
| /dashboard | Protected | Main generation tool |
| /account | Protected | Plan + usage + sign out |

## Required Environment Variables
```
VITE_SUPABASE_URL          # Public — safe to expose
VITE_SUPABASE_ANON_KEY     # Public anon key — NEVER service_role key
VITE_API_URL               # Railway backend URL (local: http://localhost:8001)
VITE_STRIPE_CREATOR_LINK   # Stripe Checkout link (Creator plan)
VITE_STRIPE_PRO_LINK       # Stripe Checkout link (Pro plan)
VITE_DEV_BYPASS            # Local dev only — set to "true" to skip auth. REMOVE before deploy.
```

## Security Architecture
- **Auth tokens**: Supabase SDK stores JWT in localStorage (standard pattern).
  `getAccessToken()` in supabase.ts retrieves it for API calls.
- **No secrets on frontend**: Only public keys (anon key, Stripe Checkout links).
  Service_role key and Stripe secret key are backend-only.
- **API calls**: Every backend request includes `Authorization: Bearer <JWT>`.
  Backend validates the JWT on every endpoint.
- **Supabase direct reads** (Account page): RLS policies on `subscriptions` and `usage`
  tables ensure users can only read their own rows.
- **CSP**: Set via `vercel.json` headers (not inline) — to be configured at deployment.
- **output_url**: Displayed as-is from job row — backend issues 48h signed URLs at
  job completion. Frontend never constructs Storage URLs directly.

## Key Components

### BatchEditor
Dual mode:
- **Classic text** (default): single textarea with NEXT syntax, familiar from studio.py
- **Visual cards**: per-batch cards with add/remove. Converts from classic text via "Parse" button.

Each `NEXT - Title` block becomes a **separate job** when Generate is clicked. classicText is
persisted to `localStorage` (key: `cogito_classic_text`) so it survives page refresh.
Emits `onBatchesChange(BatchOutput[])` — Dashboard submits one job per batch.

### JobPanel
- Polls `/api/jobs/{id}` every 3s via React Query `refetchInterval`
- Stops polling when status is `done` or `failed`
- Step-based determinate progress bar (5→20→40→60→75→90→100%) keyed on `progress_message`
- Shows `batch_title` (or `title` prop) as job identifier
- Download button uses `batch_title` as filename

### SettingsPanel
Sliders + dropdowns for: resolution, seconds_per_image (0.05–1.0), total_seconds (5–60),
max_per_query (1–30), color_theme (7 options), allow_repeats.
- **Presets**: Fast (0.1s·15s), Standard (0.2s·30s), Cinematic (0.5s·60s) — active preset highlighted.
- **Live estimate**: `~N images needed · Xs each · Xs total` updates as sliders change.
- **InfoIcon**: CSS group-hover tooltip (not HTML title attr) renders reliably cross-browser.
- Hint on seconds_per_image: "0.08–0.20s recommended for optimal viewer engagement".
Default: 0.5s per image, 5s total (testing defaults — change before production).

## Deployment (Vercel)
```bash
# Standard Vite React deploy
vercel --prod
# Set env vars in Vercel dashboard under Project > Settings > Environment Variables
```

## Development Status
- [x] Phase 4: React frontend scaffold
  - [x] Auth (Login page)
  - [x] Dashboard (BatchEditor + SettingsPanel + JobPanel + RecentJobs)
  - [x] Pricing page
  - [x] Account page
  - [x] api.ts (typed fetch wrappers)
  - [x] supabase.ts (client + token helper)
  - [x] vite-env.d.ts (import.meta.env TypeScript declarations)
- [x] vercel.json (CSP headers, SPA rewrites, HSTS, cache headers)
- [x] postcss.config.js (autoprefixer)
- [x] .gitignore
- [x] Dev bypass mode (VITE_DEV_BYPASS=true) — full UI accessible without Supabase
- [x] Pre-Phase-4 UX improvements (before deploy):
  - [x] colour_theme dropdown (7 themes) replaces prefer_brown checkbox
  - [x] Each NEXT block → separate job on submit (one job per batch)
  - [x] classicText persisted to localStorage (key: cogito_classic_text)
  - [x] batch_title shown in RecentJobs + JobPanel; used as download filename
  - [x] Step-based determinate progress bar in JobPanel
  - [x] Default settings: 0.5s per image, 5s total (testing — change before prod)
- [x] UX enhancements (post-phase-4):
  - [x] CSS tooltip InfoIcon (replaces broken HTML title attr)
  - [x] SettingsPanel presets: Fast / Standard / Cinematic
  - [x] Live image count estimate in SettingsPanel
  - [x] Clear button in BatchEditor
  - [x] Reuse button in RecentJobs (loads search_terms back into editor)
  - [x] Toast notifications on job complete (auto-dismiss 5s)
  - [x] Ctrl/Cmd+Enter keyboard shortcut to Generate
  - [x] Browser tab title shows pending job count: "(N) Cogito Content Studio"
  - [x] Friendlier Unsplash rate-limit error messages in JobPanel
- [x] asyncio.to_thread fix: pipeline steps (fetch/download/grade/render) no longer block event loop
- [x] Local dev running: http://localhost:5175
- [ ] Phase 6: Vercel deployment
  - [ ] Remove VITE_DEV_BYPASS from .env.local / Vercel env vars
  - [ ] Replace placeholder Supabase URL + anon key with real project values
  - [ ] `npm run build` to verify no TS errors before deploying
  - [ ] Set all env vars in Vercel dashboard
  - [ ] Update vercel.json CSP connect-src with real Railway URL
  - [ ] Update vercel.json CSP with real Supabase project domain
- [ ] E2E test: login → generate → poll → download
