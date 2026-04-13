-- Email-level opt-outs for release broadcasts sent to invited users who have not signed up yet.

create table if not exists public.email_update_suppressions (
    email text primary key,
    unsubscribed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_email_update_suppressions_unsubscribed_at
    on public.email_update_suppressions (unsubscribed_at desc);

drop trigger if exists trg_email_update_suppressions_updated_at on public.email_update_suppressions;
create trigger trg_email_update_suppressions_updated_at
before update on public.email_update_suppressions
for each row
execute function public.set_updated_at();

alter table public.email_update_suppressions enable row level security;

-- No client policies: release unsubscribe writes go through the backend service role.
