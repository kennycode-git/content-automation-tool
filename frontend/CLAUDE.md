# Cogito SaaS — Frontend

## Overview
Vite + React + TypeScript + Tailwind frontend for PassiveClip (branded as PassiveClip).
Deployed to **Vercel**.

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
    │   ├── Login.tsx          # Invite-only trial login: email → set password or sign in; PasswordField component with eye toggle on all password inputs
    │   ├── Dashboard.tsx      # Main tool: batch editor + settings + job status
    │   ├── Photos.tsx         # Photo extraction tool (Pexels only, module-level cache)
    │   ├── Pricing.tsx        # Plan selection → Stripe Checkout (responsive grid)
    │   ├── Account.tsx        # Plan info, render usage, sign out
    │   └── Admin.tsx          # Admin dashboard: invite management, user list, render adjustment
    └── components/
        ├── AppNavbar.tsx      # Shared navbar: logo, tool tabs, profile dropdown
        ├── BatchEditor.tsx    # # Title-syntax textarea + visual card editor
        ├── SettingsPanel.tsx  # Resolution, timing, collapsed theme dropdown
        ├── AdvancedModal.tsx  # Centered dialog: presets, image source, accent, advanced opts
        ├── InspirationCarousel.tsx  # Horizontal style cards with hover-to-play video previews (11 presets)
        ├── OnboardingTour.tsx # Spotlight-style first-use tour (10 steps + welcome screen + tutorial link)
        ├── PromptModal.tsx    # AI batch prompt template with copy button
        ├── TermBundles.tsx    # Pre-built search term bundles (11 bundles)
        ├── PresetManager.tsx  # Named settings presets CRUD
        ├── JobPanel.tsx       # Live job status with 3s polling + download button
        ├── RecentJobs.tsx     # Last 10 jobs list with colour grade, delete, duplicate
        ├── Toast.tsx          # Auto-dismiss toast notifications
        ├── PreviewModal.tsx   # Staged image preview before generating (wrapping tabs, dark scrollbar)
        ├── ClipPreviewGrid.tsx    # Video clips picker: search results grid, trim controls, selection
        ├── ClipsSettingsPanel.tsx # Settings panel for clips mode (duration, transitions, resolution)
        └── VideoClipSearch.tsx    # Pexels video search input + results for clips mode
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
| /login | Public | Invite-only trial login (email → set password or sign in) |
| /pricing | Public | Plan selection → Stripe |
| /tutorial | Public | Redirect → Loom tutorial video (via vercel.json redirect) |
| /dashboard | Protected | Main video generation tool |
| /photos | Protected | Photo extraction tool (Pexels) |
| /account | Protected | Plan + usage + sign out |
| /admin | Protected | Admin dashboard (invite management, users, render adjustment) |

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

### AppNavbar
Shared across all tool pages (Dashboard + Photos). Contains:
- Logo (logo.png + just text.png)
- Tool tabs: **Video** (`/dashboard`), **Photos** (`/photos`), plus "Overlay Text", "AI Prompting", "Scheduling" (all "Soon" with tooltip on hover)
- Profile dropdown: usage bar, plan name, View account link, Sign out
- Optional `?` button (only on Dashboard) that re-triggers the onboarding tour
- Props: `session`, `activeTool: 'video' | 'photos'`, `onShowTour?: () => void`

### BatchEditor
Dual mode:
- **Visual mode** (default, `classicMode = false`): per-batch cards with add/remove, title input, textarea, image upload
- **Classic text** mode: single `# Title`-delimited textarea

Each `# Title` block becomes a **separate job** when Generate is clicked. classicText is
persisted to `localStorage` (key: `cogito_classic_text`). Emits `onBatchesChange(BatchOutput[])`.

Default content: one card with title "Stoicism" and three starter terms.

Each visual card has a **Style** button (`data-tour="batch-style-btn"` on first card) opening `BatchStylePopover`:
- Colour theme override (global or any of the 9 themes, Custom with grade sliders + live video preview)
- Accent images override (Global / None / Blue / Red / Gold)
- Philosopher placeholder (coming soon, disabled)
- **Text overlay**: toggle, textarea (200 char), live `OverlayPreview` (200x113px 9:16 thumbnail), font picker (15 fonts / 4 groups), colour (White / Cream / Yellow / Black / Custom hex), background box, 3x3 position grid, alignment (L/C/R controls `textAlign` only -- position grid controls placement), font size slider (1-12%, step 0.2%), overlay style presets (save/load/delete via `cogito_overlay_presets` in localStorage, stores all settings except text and enabled state)

### InspirationCarousel
Horizontal scrollable strip of **11 style presets**: Buddhism, Dark Academia, Stoic Philosophy, Gothic, The Abyss, Eastern Philosophy, Existentialism, Psychology, Surrealism, Shadow, Nature as Philosophy. Each card:
- Displays a video preview (`/theme-previews/{preset.id}.mp4`) paused at a random frame
- Plays on hover; falls back to a gradient overlay if the video fails to load
- "Use this style →" overlay on hover; click applies theme + term bundle to Dashboard
- Dismiss button collapses the carousel (replaced by a "Style templates" restore button)
- Each preset has `bundleLabel` that must exactly match a `label` in `BUNDLES` — mismatch = no terms loaded

### TermBundles
Collapsible panel of **11 pre-built search term bundles** (exported as `BUNDLES`):
Buddhism, Stoic Philosophy, Dark Academia, Eastern Philosophy, Shadow, Existentialism,
Psychology, Nature as Philosophy, The Abyss, Gothic, Surrealism.
Multi-select checkboxes → "Load N batches" appends to either classic text or visual cards depending on current mode.

Also imported by `InspirationCarousel` to resolve bundle terms when a preset is applied.

### SettingsPanel
Sliders for resolution, seconds_per_image (0.05–1.0s), total_seconds (5–60s).
Collapsed custom dropdown for color_theme (9 themes, eye icon trigger, click-away close).
- **Built-in presets**: Fast (0.08s·10s), Standard (0.13s·11s), Cinematic (0.21s·12s) — highlighted when active
- **Live estimate**: `~N images needed · Xs each · Xs total` updates as sliders change
- **Theme preview popup**: hover the eye icon to see a video preview of the theme
- **DEFAULT_SETTINGS** (in Dashboard.tsx): `seconds_per_image=0.13`, `total_seconds=11`, `fps=30`, `allow_repeats=true`, `color_theme='none'`, `max_per_query=3`
- Advanced options (max_per_query, allow_repeats, image source, accent) moved to AdvancedModal

### AdvancedModal
- Custom presets panel (PresetManager)
- Extractor model: Auto (recommended) | Unsplash | Pexels (dropdown)
- Accent images picker: None / Blue / Red / Gold (with video preview on hover)
- Max images per query slider (1--30)
- Select philosopher (coming soon, disabled section with tooltip)
- Note: "Allow image repeats" and "Use uploaded images only" checkboxes have been removed

### Colour Themes (9)
| Value | Label | Dot colour |
|-------|-------|------------|
| none | Natural | bg-stone-400 |
| dark | Dark Tones | bg-stone-900 ring-1 ring-stone-600 |
| sepia | Sepia | bg-amber-800 |
| warm | Amber | bg-amber-500 |
| low_exp | Low Exposure | bg-stone-950 ring-1 ring-stone-700 |
| grey | Silver | bg-slate-400 |
| blue | Cobalt | bg-blue-500 |
| red | Crimson | bg-red-500 |
| bw | Monochrome | bg-white ring-1 ring-stone-500 |

`THEME_DOT` and `THEME_LABEL` are defined in `SettingsPanel.tsx` (as `THEME_DOT`) and also
duplicated in `RecentJobs.tsx` and `InspirationCarousel.tsx` for standalone use.

### JobPanel
- Polls `/api/jobs/{id}` every 3s via React Query `refetchInterval`
- Stops polling when status is `done` or `failed`
- Step-based determinate progress bar: Queued=5% → Loading uploaded=10% → Fetching/API limit=20% → Downloading=40% → Applying=60% → Rendering=75% → Uploading=90% → Done=100%
- Magnifying glass icon (hover) shows `ProgressOverlay` with pipeline steps + pulsing active step
- `ProgressOverlay` is sticky: outer wrapper div covers the gap with `pt-2`, mouse events on wrapper so mouse can travel from button to overlay without dismissing. 200ms hide timeout cancelled on overlay enter.
- Hovering "Searching for photos" or "Collecting photos" step rows (active or done) shows an inline detail sub-panel:
  - Terms count, target image count (terms × max_per_query), source (Pexels/Unsplash)
  - Live download count "X/Y photos downloaded" or "X photos collected" when done
  - Source persisted in `sourceRef` so it still shows after message changes to "Applying…"
  - Fallback: shows target count if poll missed the download phase entirely
- `imageCountRef` tracks `{ done, total }` parsed from `"Downloading X/Y images…"` messages
- `sourceRef` persists source once seen in any progress message
- `JobStatusResponse` backend schema now includes `search_terms` and `max_per_query` (was missing from single-job endpoint)
- Metadata strip: color theme badge, resolution, duration, preset name
- Download uses fetch-blob so the file saves with the batch title as filename
- `submittingRef` (useRef) guards against double-submit on mobile (touch fires both touchend + click before React re-render disables button)

### RecentJobs
- Polls last 10 jobs every 30s
- Per-job actions: Download, Refresh URL (if expired/warning), Edit images, Colour grade, Duplicate, Delete
- Colour grade: expands inline theme picker → calls `onColourGrade` → spawns new job with selected theme
- URL expiry: warns at < 4h remaining; shows "Refresh URL" button to call `/resign`
- Shows theme dot indicator, preset/duration metadata

### PreviewModal
- Full-screen modal for reviewing staged images before rendering
- Batch tabs (when >1 batch) use horizontal scroll with dark thin scrollbar (`.scrollbar-dark` CSS class)
- Controls bar outside scroll area
- Multi-select with checkmarks, Select all / Deselect all
- Drag-and-drop + file picker to add images; images upload immediately in background
- Removes failed uploads from the confirmed batch

### Photos page (/photos)
- Pexels-only image extraction
- Module-level `_cache` object preserves state (search text, images, saved paths, etc.) across page navigation within the same session
- Settings: search terms (one per line), images per batch slider (5–100), resolution, colour theme
- Results grid: aspect ratio matches selected resolution, hover to save or remove
- Lightbox: click to enlarge, prev/next navigation, save from lightbox
- Download all: uses File System Access API if available (`showDirectoryPicker`), falls back to anchor downloads
- TermBundles panel for quick-start term loading

### OnboardingTour
- 10-step spotlight-style tour + welcome screen (step -1, first visit only)
- Shown once per browser (`localStorage` key: `cogito_tour_seen`); re-triggerable via `?` button
- Exported `TOUR_STORAGE_KEY` constant used by Dashboard to check/set tour state
- Spotlight uses CSS `box-shadow` spread to dim everything except the target element
- Tracks target element via `requestAnimationFrame` loop (handles scroll/resize)
- **Scrolls target into view** (`scrollIntoView({ behavior: 'smooth', block: 'center' })`) on each step
- Welcome screen (step -1) has "Watch tutorial (5 min)" button linking to `passiveclip.com/tutorial`
- Steps: batch editor → classic text mode → video settings → colour themes → per-batch style → text overlays → advanced settings → colour variants → preview → generate
- Keyboard nav: Arrow keys, Enter (next), Escape (close)

### PromptModal
- Displays a copy-paste AI prompt template for generating batch lists
- Highlights `{PLACEHOLDER}` tokens in brand amber
- `fromTour` prop: when true and text has been copied, shows "Return to tutorial →" button

### Video Clips Mode
Dashboard has a mode toggle: **Photos** (default) vs **Clips**. In Clips mode:
- `<VideoClipSearch>` — Pexels video search input
- `<ClipPreviewGrid>` — results grid with trim controls (in/out points), clip selection, multi-select
- `<ClipsSettingsPanel>` — resolution, transition type, clip duration settings
- Generate calls `POST /api/clips/generate` → `clip_job_manager.py` → `clip_builder.py`
- Two-pass render to prevent OOM: normalize clips one at a time → concat-copy to combine
- Clips jobs tracked separately from image jobs; use same JobPanel polling pattern

## Dashboard Layout (Dashboard.tsx)
- `<AppNavbar>` — shared navbar
- `<InspirationCarousel>` — collapsible style templates strip
- **STEP 1** — Search terms: `<TermBundles>` + `<BatchEditor>`
- **STEP 2** — Video settings: `<SettingsPanel>`
- **STEP 3** — Generate row:
  - ⚙ button → opens `<AdvancedModal>`
  - 🎨 button → toggles inline variants panel
  - Generate button (left split) + ▾ dropdown (right split, "Generate directly" | "Preview images first →")
- Right column: staging preview card, active `<JobPanel>` instances, `<RecentJobs>`
- Modals: `<AdvancedModal>`, `<PreviewModal>`, `<OnboardingTour>`, `<PromptModal>`
- `<ToastStack>` — fixed bottom-right

### imageSource logic
`imageSource` state: `'auto' | 'unsplash' | 'pexels' | 'both'`
`resolvedSource = imageSource === 'auto' ? 'pexels' : imageSource`
All API calls use `resolvedSource` so 'auto' resolves to Pexels before sending.

## Deployment (Vercel)
```bash
vercel --prod
# Set env vars in Vercel dashboard under Project > Settings > Environment Variables
```

## Development Status
- [x] Auth (Login page)
- [x] Dashboard (BatchEditor + SettingsPanel + JobPanel + RecentJobs)
- [x] Photos page (/photos route)
- [x] Pricing page
- [x] Account page
- [x] api.ts (typed fetch wrappers)
- [x] supabase.ts (client + token helper)
- [x] AppNavbar (shared, tool tabs, profile dropdown)
- [x] InspirationCarousel (7 presets, hover-to-play, gradient fallback)
- [x] OnboardingTour (7-step spotlight, keyboard nav)
- [x] PromptModal (AI batch prompt with copy)
- [x] TermBundles (7 bundles, exported as BUNDLES)
- [x] 9 colour themes: none, dark, sepia, warm, grey, blue, red, bw, low_exp
- [x] Colour Variants panel (generate all 9 themes as separate jobs)
- [x] Preview staging ("Preview images first →" calls POST /api/preview-stage)
- [x] PreviewModal (multi-select, drag-drop upload, batch tabs, controls bar outside scroll)
- [x] AdvancedModal (presets, image source, accent, philosopher coming-soon section)
- [x] RecentJobs colour grade feature
- [x] JobPanel magnifying glass progress overlay
- [x] URL expiry warning + Refresh URL button
- [x] Dev bypass mode (VITE_DEV_BYPASS=true)
- [x] Ctrl/Cmd+Enter keyboard shortcut to Generate
- [x] Invite-only trial login flow (email → check-invite → set password or sign in)
- [x] Password recovery flow (forgot password → reset email → new-password step)
- [x] Admin page (/admin) — invite management, user list, render adjustment
- [x] OnboardingTour: 10 steps, welcome screen with tutorial link, scrolls to target on each step
- [x] PreviewModal batch tabs: dark thin scrollbar, horizontal scroll
- [x] Pricing page: responsive grid (3-col on sm+, no overflow)
- [x] Video Clips mode: Pexels video search, trim, transitions, two-pass render
- [x] InspirationCarousel: 11 presets (added Buddhism, The Abyss, Gothic, Surrealism)
- [x] TermBundles: 11 bundles (added Buddhism, The Abyss, Gothic, Surrealism)
- [x] Tutorial video: passiveclip.com/tutorial redirect, thumbnail in invite email, link in onboarding
- [x] Phase 6: Vercel deployed (auto-deploys on push to main)
  - [x] Env vars set in Vercel dashboard
  - [ ] Update vercel.json CSP connect-src with real Railway URL
  - [ ] Update vercel.json CSP with real Supabase project domain
- [ ] E2E test: login → generate → poll → download
