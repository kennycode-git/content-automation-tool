# Release Broadcasts

Admin-only release update emails are sent through FastAPI with Resend. Supabase Auth remains the identity source; broadcast state and preferences live in companion `public` tables.

## Files

- `supabase/migrations/20260411_release_broadcasts.sql` creates preferences, releases, jobs, recipient logs, RLS policies, and default preference triggers.
- `backend/templates/release_update_email.html` is the broadly compatible HTML email template.
- `backend/services/release_email.py` reads release markdown, renders HTML/text, handles unsubscribe tokens, queries recipients, and sends/logs broadcasts.
- `backend/routers/release_admin.py` exposes admin preview, approval, broadcast, status, and unsubscribe endpoints.
- `releases/v0.3.3.md` is a sample release markdown file.

## Migration

Run the migration against the Supabase project:

```bash
supabase db push
```

Or paste `supabase/migrations/20260411_release_broadcasts.sql` into the Supabase SQL editor and run it once.

## Environment

- `ADMIN_SECRET_KEY`: required for `X-Admin-Key` protected admin routes.
- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_KEY`: service role key for server-side reads/writes and `auth.users` reads.
- `RESEND_API_KEY`: Resend API key.
- `RELEASE_RESEND_FROM_EMAIL`: optional release-specific sender. Falls back to `RESEND_FROM_EMAIL`, then `no-reply@passiveclip.com`.
- `PUBLIC_API_URL`: recommended base URL for unsubscribe links, e.g. `https://api.passiveclip.com`.
- `PUBLIC_APP_URL`: fallback CTA/base URL, e.g. `https://passiveclip.com`.
- `RELEASE_EMAIL_SECRET`: recommended HMAC secret for unsubscribe tokens. Falls back to `ADMIN_SECRET_KEY`.
- `RELEASE_EMAIL_USE_LLM`: optional `true` to enable LLM summarisation during preview generation.
- `OPENAI_API_KEY`: required only if LLM summarisation is enabled.
- `RELEASE_EMAIL_LLM_MODEL`: optional; defaults to `gpt-4o-mini`.
- `RELEASE_EMAIL_BATCH_PAUSE_SECONDS`: optional pause between send batches, default `0.25`.

## API

All admin routes require `X-Admin-Key: <ADMIN_SECRET_KEY>`.

### Generate Preview

`POST /api/admin/releases/generate-preview`

```json
{
  "version": "v0.3.3",
  "markdown_path": "/releases/v0.3.3.md",
  "title": "PassiveClip v0.3.3",
  "changelog_url": "https://passiveclip.com/updates",
  "use_llm_summary": false
}
```

### Send Preview

`POST /api/admin/releases/send-preview`

```json
{
  "release_id": "00000000-0000-0000-0000-000000000000",
  "preview_email": "you@example.com"
}
```

### Approve And Send

`POST /api/admin/releases/approve-and-send`

```json
{
  "release_id": "00000000-0000-0000-0000-000000000000",
  "batch_size": 50
}
```

### Get Release Status

`GET /api/admin/releases/{release_id}`

Returns the release record, broadcast jobs, and recipient delivery counts.

## Retry Safety

- `release_broadcast_recipients` has `unique (release_id, email)`, so the same release cannot be sent twice to the same email.
- The background sender checks existing recipient rows and skips rows already marked `sent`.
- Failed rows remain logged as `failed`; a future retry path can safely pick up only failed/pending rows without resending successful emails.
- Preview sends create broadcast job rows with `preview_sent` but do not count as broadcast recipients.

## Sample HTML Shape

The generated email uses a centered white card on a warm neutral background, a black PassiveClip header, orange accent bar, headline, intro paragraph, bordered summary box, orange CTA button, and unsubscribe footer.
