/**
 * cleanup-expired-outputs
 *
 * Supabase Edge Function — deletes Storage files for jobs whose output URLs
 * have been available for > 48 hours, then nulls out output_url in the DB.
 *
 * Deploy:
 *   supabase functions deploy cleanup-expired-outputs
 *
 * Schedule via Supabase Dashboard > Edge Functions > Schedule (cron):
 *   0 3 * * *    (runs daily at 03:00 UTC)
 *
 * Or use pg_cron in the SQL editor:
 *   SELECT cron.schedule(
 *     'cleanup-expired-outputs',
 *     '0 3 * * *',
 *     $$SELECT net.http_post(
 *       url := current_setting('app.supabase_functions_url') || '/cleanup-expired-outputs',
 *       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key')),
 *       body := '{}'::jsonb
 *     )$$
 *   );
 *
 * Security considerations:
 * - Uses service_role key (from env) — this function runs server-side only.
 * - Only touches files where completed_at is genuinely > 48h ago.
 * - Processes in batches of 100 to avoid memory issues.
 * - Errors on individual file deletion are logged but don't abort the batch,
 *   so a single bad file doesn't block cleanup of all others.
 * - output_url is nulled in the DB after storage deletion to prevent stale links.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'outputs'
const BATCH_SIZE = 100

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const supabase = createClient(supabaseUrl, serviceKey)

  // Find jobs completed > 48 hours ago that still have an output_url
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const { data: expired, error: fetchError } = await supabase
    .from('jobs')
    .select('id, user_id, output_url')
    .lt('completed_at', cutoff)
    .not('output_url', 'is', null)
    .eq('status', 'done')
    .limit(BATCH_SIZE)

  if (fetchError) {
    console.error('Failed to fetch expired jobs:', fetchError.message)
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 })
  }

  if (!expired || expired.length === 0) {
    console.log('No expired jobs to clean up.')
    return new Response(JSON.stringify({ cleaned: 0 }), { status: 200 })
  }

  console.log(`Found ${expired.length} expired jobs to clean up.`)

  let cleaned = 0
  let failed = 0

  for (const job of expired) {
    const storagePath = `${job.user_id}/${job.id}.mp4`

    try {
      // Delete from Storage
      const { error: storageError } = await supabase.storage
        .from(BUCKET)
        .remove([storagePath])

      if (storageError) {
        // File may already be gone — log and continue
        console.warn(`Storage delete failed for ${storagePath}: ${storageError.message}`)
      }

      // Null out output_url in DB regardless (URL is expired anyway)
      const { error: updateError } = await supabase
        .from('jobs')
        .update({ output_url: null })
        .eq('id', job.id)

      if (updateError) {
        console.error(`DB update failed for job ${job.id}: ${updateError.message}`)
        failed++
        continue
      }

      console.log(`Cleaned: ${storagePath}`)
      cleaned++
    } catch (err) {
      console.error(`Unexpected error for job ${job.id}:`, err)
      failed++
    }
  }

  const summary = { cleaned, failed, total: expired.length }
  console.log('Cleanup complete:', JSON.stringify(summary))
  return new Response(JSON.stringify(summary), { status: 200 })
})
