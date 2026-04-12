-- Release announcement email broadcast system.
-- Keeps auth.users as the identity source and stores broadcast state in public tables.

-- 1. user email preferences
create table if not exists public.email_update_preferences (
    user_id uuid primary key references auth.users(id) on delete cascade,
    subscribed_to_product_updates boolean not null default true,
    unsubscribed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_email_update_preferences_subscribed
    on public.email_update_preferences (subscribed_to_product_updates);

-- 2. release announcements
create table if not exists public.release_announcements (
    id uuid primary key default gen_random_uuid(),
    version text not null unique,
    title text not null,
    markdown_path text not null,
    markdown_content text,
    summary_text text,
    email_subject text,
    email_html text,
    email_text text,
    changelog_url text,
    status text not null default 'draft'
        check (status in ('draft', 'preview_generated', 'approved', 'sending', 'sent', 'failed')),
    created_by uuid references auth.users(id) on delete set null,
    approved_by uuid references auth.users(id) on delete set null,
    approved_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_release_announcements_status
    on public.release_announcements (status);

create index if not exists idx_release_announcements_created_at
    on public.release_announcements (created_at desc);

-- 3. broadcast jobs
create table if not exists public.release_broadcast_jobs (
    id uuid primary key default gen_random_uuid(),
    release_id uuid not null references public.release_announcements(id) on delete cascade,
    triggered_by uuid references auth.users(id) on delete set null,
    resend_batch_id text,
    status text not null default 'pending'
        check (status in ('pending', 'preview_sent', 'queued', 'sending', 'completed', 'partially_failed', 'failed')),
    preview_recipient_email text,
    total_recipients integer not null default 0,
    sent_count integer not null default 0,
    failed_count integer not null default 0,
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_release_broadcast_jobs_release_id
    on public.release_broadcast_jobs (release_id);

create index if not exists idx_release_broadcast_jobs_status
    on public.release_broadcast_jobs (status);

-- 4. per-recipient log table
create table if not exists public.release_broadcast_recipients (
    id uuid primary key default gen_random_uuid(),
    broadcast_job_id uuid not null references public.release_broadcast_jobs(id) on delete cascade,
    release_id uuid not null references public.release_announcements(id) on delete cascade,
    user_id uuid references auth.users(id) on delete set null,
    email text not null,
    resend_email_id text,
    send_status text not null default 'pending'
        check (send_status in ('pending', 'sent', 'failed', 'skipped')),
    error_message text,
    sent_at timestamptz,
    created_at timestamptz not null default now(),
    unique (release_id, email)
);

create index if not exists idx_release_broadcast_recipients_broadcast_job_id
    on public.release_broadcast_recipients (broadcast_job_id);

create index if not exists idx_release_broadcast_recipients_release_id
    on public.release_broadcast_recipients (release_id);

create index if not exists idx_release_broadcast_recipients_send_status
    on public.release_broadcast_recipients (send_status);

-- 5. updated_at helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_email_update_preferences_updated_at on public.email_update_preferences;
create trigger trg_email_update_preferences_updated_at
before update on public.email_update_preferences
for each row
execute function public.set_updated_at();

drop trigger if exists trg_release_announcements_updated_at on public.release_announcements;
create trigger trg_release_announcements_updated_at
before update on public.release_announcements
for each row
execute function public.set_updated_at();

drop trigger if exists trg_release_broadcast_jobs_updated_at on public.release_broadcast_jobs;
create trigger trg_release_broadcast_jobs_updated_at
before update on public.release_broadcast_jobs
for each row
execute function public.set_updated_at();

-- 6. auto-create default preferences row for each new auth user
create or replace function public.handle_new_user_email_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.email_update_preferences (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created_email_preferences on auth.users;
create trigger on_auth_user_created_email_preferences
after insert on auth.users
for each row
execute function public.handle_new_user_email_preferences();

-- Backfill existing users as subscribed unless they later opt out.
insert into public.email_update_preferences (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- 7. optional: enable RLS
alter table public.email_update_preferences enable row level security;
alter table public.release_announcements enable row level security;
alter table public.release_broadcast_jobs enable row level security;
alter table public.release_broadcast_recipients enable row level security;

-- 8. users can view and update only their own email preferences
drop policy if exists "users can view own email update preferences" on public.email_update_preferences;
create policy "users can view own email update preferences"
on public.email_update_preferences
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "users can update own email update preferences" on public.email_update_preferences;
create policy "users can update own email update preferences"
on public.email_update_preferences
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- 9. service-role-only style tables: no broad client access policies created here
