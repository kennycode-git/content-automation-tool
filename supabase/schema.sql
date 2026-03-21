-- ─────────────────────────────────────────────────────────────────────────────
-- Cogito SaaS — Supabase Postgres schema
-- Run this in the Supabase SQL editor to set up the database.
-- ─────────────────────────────────────────────────────────────────────────────

-- Subscriptions: one row per user, updated by Stripe webhook.
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id              UUID REFERENCES auth.users PRIMARY KEY,
  stripe_customer_id   TEXT,
  stripe_subscription_id TEXT,
  status               TEXT NOT NULL DEFAULT 'inactive', -- active | cancelled | past_due
  plan                 TEXT NOT NULL DEFAULT 'creator',  -- creator | pro | trial
  trial_expires_at     TIMESTAMPTZ,                      -- set when plan='trial' (NOW() + 21 days)
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: users can read their own row; service_role (backend) can write.
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_subscription"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);
-- Writes go through service_role key (backend only) — no client INSERT/UPDATE policy needed.

-- Jobs: one row per video generation request.
CREATE TABLE IF NOT EXISTS jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users,
  status           TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | failed | deleted
  progress_message TEXT,
  config           JSONB NOT NULL DEFAULT '{}',
  output_url       TEXT,         -- 48hr signed URL; nulled after expiry cleanup
  error_message    TEXT,
  batch_title      TEXT,         -- human-readable job name from NEXT - <title> syntax
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS jobs_user_id_created_at ON jobs (user_id, created_at DESC);

-- RLS: users can read/delete their own jobs; service_role writes.
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_jobs"
  ON jobs FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "users_delete_own_jobs"
  ON jobs FOR DELETE
  USING (auth.uid() = user_id);

-- Usage: tracks renders per user per calendar month.
CREATE TABLE IF NOT EXISTS usage (
  user_id      UUID NOT NULL REFERENCES auth.users,
  month        TEXT NOT NULL,   -- "2026-03"
  render_count INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);

-- RLS: users read own; service_role writes.
ALTER TABLE usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read_own_usage"
  ON usage FOR SELECT
  USING (auth.uid() = user_id);

-- Atomic usage increment RPC (avoids race conditions under concurrent requests).
CREATE OR REPLACE FUNCTION increment_render_count(p_user_id UUID, p_month TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO usage (user_id, month, render_count)
  VALUES (p_user_id, p_month, 1)
  ON CONFLICT (user_id, month)
  DO UPDATE SET render_count = usage.render_count + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase Storage
-- Create a private bucket called 'outputs' in the Supabase dashboard.
-- Add the following RLS policy so users can read only their own files:
-- ─────────────────────────────────────────────────────────────────────────────
-- (Run in Storage > Policies, not SQL editor)
--
-- Policy name: users_read_own_output
-- Bucket:      outputs
-- Operation:   SELECT
-- Expression:  (storage.foldername(name))[1] = auth.uid()::text
--
-- The backend uses service_role key to INSERT files — no INSERT policy needed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- Auto-provision trial subscription on new user sign-up.
-- Fires for every auth method (email/password, magic link, OAuth).
-- ON CONFLICT DO NOTHING ensures Stripe-provisioned rows are never overwritten.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_trial_subscription()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, status, plan, trial_expires_at)
  VALUES (NEW.id, 'active', 'trial', NOW() + INTERVAL '21 days')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_trial_subscription();

-- ─────────────────────────────────────────────────────────────────────────────
-- ─────────────────────────────────────────────────────────────────────────────
-- Trial invites: closed-beta access list.
-- Admin adds email rows manually via Supabase dashboard.
-- Backend marks claimed=true when user activates their account.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trial_invites (
  email       TEXT PRIMARY KEY,
  claimed     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: no user-facing policies — accessed only by service_role (backend).
ALTER TABLE trial_invites ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- Nightly cleanup: find jobs with expired output URLs (>48h) for Edge Function processing.
-- The Edge Function or pg_cron job should:
--   SELECT id, output_url, user_id FROM jobs
--   WHERE completed_at < NOW() - INTERVAL '48 hours'
--     AND output_url IS NOT NULL
--     AND status = 'done';
-- Then for each row: delete from Storage, set output_url = NULL.

-- ─────────────────────────────────────────────────────────────────────────────
-- TikTok integration tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tiktok_accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  tiktok_user_id   TEXT NOT NULL,
  display_name     TEXT,
  avatar_url       TEXT,
  access_token     TEXT NOT NULL,
  refresh_token    TEXT,
  token_expires_at TIMESTAMPTZ,
  scope            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, tiktok_user_id)
);
ALTER TABLE tiktok_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_manage_own_tiktok_accounts"
  ON tiktok_accounts FOR ALL USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  job_id            UUID NOT NULL REFERENCES jobs ON DELETE CASCADE,
  tiktok_account_id UUID REFERENCES tiktok_accounts ON DELETE SET NULL,
  caption           TEXT DEFAULT '',
  hashtags          TEXT[] DEFAULT '{}',
  privacy_level     TEXT NOT NULL DEFAULT 'PUBLIC_TO_EVERYONE',
  scheduled_at      TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','posting','posted','failed','cancelled')),
  draft_mode        BOOLEAN NOT NULL DEFAULT false,
  tiktok_publish_id TEXT,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE scheduled_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_manage_own_scheduled_posts"
  ON scheduled_posts FOR ALL USING (auth.uid() = user_id);
