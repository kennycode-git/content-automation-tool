# Cogito SaaS — Deployment Guide

Both repos are git-initialised and build-verified. Follow these steps in order.

---

## Step 1 — Supabase project

1. Go to [supabase.com](https://supabase.com) → New project
2. Note your **Project ref** (e.g. `abcdefghijkl`) — needed later
3. In **SQL Editor**, paste and run the full contents of `supabase_schema.sql`
4. In **Storage** → New bucket → name: `outputs`, set to **Private**
5. In Storage → `outputs` bucket → Policies → New policy → For operation **SELECT**:
   ```
   (storage.foldername(name))[1] = auth.uid()::text
   ```
6. From **Settings → API** copy:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_KEY` (never expose this publicly)
   - `JWT Secret` → `SUPABASE_JWT_SECRET`

---

## Step 2 — Unsplash API key

1. Go to [unsplash.com/developers](https://unsplash.com/developers) → New application
2. Copy **Access Key** → `UNSPLASH_ACCESS_KEY`
   - Free tier: 50 requests/hour (enough for development)
   - Production: apply for production access (5000 requests/hour)

---

## Step 3 — Stripe setup

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com) → Products → Add product
2. Create two products:
   - **Creator** — £5/month recurring → note the Price ID
   - **Pro** — £12/month recurring → note the Price ID
3. For each, set metadata on the **Price**: `plan = creator` / `plan = pro`
4. Go to **Payment Links** → create one per product
   - Each link → Advanced → add metadata: `user_id` (leave value blank — will be filled by Stripe's client_reference_id, or use Checkout Sessions instead for server-side user_id injection — see note below)
   - Copy link URLs → `VITE_STRIPE_CREATOR_LINK`, `VITE_STRIPE_PRO_LINK`
5. Copy **Secret key** → `STRIPE_SECRET_KEY`

> **Note on user_id in Stripe:** For the webhook to correctly link a Stripe payment to a
> Supabase user, `checkout.session.completed` must include `metadata.user_id`. Payment Links
> don't support dynamic metadata. For production, replace Pricing page links with a
> server-side `POST /api/create-checkout-session` endpoint that creates a Stripe Checkout
> Session with `metadata: { user_id, plan }` injected from the JWT. This is a Phase 7 task.
> For MVP testing, manually upsert a subscription row in Supabase after a test payment.

---

## Step 4 — Deploy backend to Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Log in
railway login

# From the backend directory
cd C:\Documents\Cogito\saas\backend

# Create new Railway project
railway init

# Set environment variables (one at a time, or use Railway dashboard)
railway variables set SUPABASE_URL=https://your-project.supabase.co
railway variables set SUPABASE_SERVICE_KEY=eyJ...
railway variables set SUPABASE_JWT_SECRET=your-jwt-secret
railway variables set UNSPLASH_ACCESS_KEY=your-key
railway variables set STRIPE_SECRET_KEY=sk_live_...
railway variables set STRIPE_WEBHOOK_SECRET=whsec_...   # set after step 5
railway variables set FRONTEND_URL=https://your-app.vercel.app  # set after step 6
railway variables set PYTHONUNBUFFERED=1

# Deploy
railway up

# Note the public domain Railway assigns (e.g. cogito-backend-production.up.railway.app)
# → RAILWAY_PUBLIC_DOMAIN and VITE_API_URL
railway variables set RAILWAY_PUBLIC_DOMAIN=cogito-backend-production.up.railway.app
```

Railway reads `nixpacks.toml` automatically — ffmpeg is installed as part of the build.
Check the deploy log for `Cogito SaaS backend starting up` to confirm startup succeeded.

---

## Step 5 — Register Stripe webhook

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. Endpoint URL: `https://<your-railway-domain>/stripe/webhook`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy **Signing secret** → go back to Railway dashboard and set:
   `STRIPE_WEBHOOK_SECRET=whsec_...`
5. Railway will auto-redeploy with the new variable.

---

## Step 6 — Deploy frontend to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# From the frontend directory
cd C:\Documents\Cogito\saas\frontend

# Deploy (follow prompts — link to existing or create new project)
vercel

# Set environment variables in Vercel dashboard (or CLI):
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY
vercel env add VITE_API_URL          # https://<your-railway-domain>
vercel env add VITE_STRIPE_CREATOR_LINK
vercel env add VITE_STRIPE_PRO_LINK

# Production deploy
vercel --prod
```

Note your Vercel URL (e.g. `https://cogito.vercel.app`), then update Railway:
```bash
railway variables set FRONTEND_URL=https://cogito.vercel.app
```

---

## Step 7 — Update vercel.json CSP with real domains

Once you have real domains, update `frontend/vercel.json` — replace the wildcards in
`connect-src` with your actual Railway and Supabase domains:

```json
"connect-src 'self' https://your-project.supabase.co https://cogito-backend.up.railway.app wss://your-project.supabase.co"
```

Commit and `vercel --prod` again.

---

## Step 8 — Deploy Supabase Edge Function (nightly cleanup)

```bash
# Install Supabase CLI
npm install -g supabase

# From the saas root
cd C:\Documents\Cogito\saas

# Link to your project
supabase link --project-ref <your-project-ref>

# Deploy the function
supabase functions deploy cleanup-expired-outputs

# Schedule it (in Supabase SQL editor):
```
```sql
SELECT cron.schedule(
  'cleanup-expired-outputs',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<your-project>.supabase.co/functions/v1/cleanup-expired-outputs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  )
  $$
);
```

---

## Step 9 — End-to-end verification

1. Open `https://cogito.vercel.app/login`
2. Sign up with a test email (Supabase sends magic link)
3. Manually insert a test subscription in Supabase SQL editor:
   ```sql
   INSERT INTO subscriptions (user_id, status, plan)
   VALUES ('<your-user-uuid>', 'active', 'pro');
   ```
4. Go to Dashboard → enter search terms → Generate video
5. Watch job panel poll every 3s
6. Download button appears when done → confirm MP4 plays
7. Check Railway logs for pipeline steps
8. Check Supabase Storage → `outputs/<user-id>/` → file present
9. After 48h → cleanup function removes file, `output_url` nulled in DB

---

## Environment variable checklist

### Backend (Railway)
| Variable | Source |
|---|---|
| `SUPABASE_URL` | Supabase Settings → API |
| `SUPABASE_SERVICE_KEY` | Supabase Settings → API (service_role) |
| `SUPABASE_JWT_SECRET` | Supabase Settings → API |
| `UNSPLASH_ACCESS_KEY` | Unsplash developer dashboard |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Webhooks |
| `FRONTEND_URL` | Your Vercel deployment URL |
| `RAILWAY_PUBLIC_DOMAIN` | Auto-assigned by Railway |
| `PYTHONUNBUFFERED` | `1` |

### Frontend (Vercel)
| Variable | Source |
|---|---|
| `VITE_SUPABASE_URL` | Supabase Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase Settings → API (anon public) |
| `VITE_API_URL` | Railway deployment URL |
| `VITE_STRIPE_CREATOR_LINK` | Stripe Payment Link (Creator) |
| `VITE_STRIPE_PRO_LINK` | Stripe Payment Link (Pro) |
