/**
 * supabase.ts
 *
 * Supabase client for the frontend (uses anon key).
 *
 * Security considerations:
 * - VITE_SUPABASE_ANON_KEY is the public anon key — it is safe to embed in frontend
 *   code because Row Level Security (RLS) policies on the database enforce access control.
 * - The service_role key MUST NEVER appear in frontend code or env vars prefixed VITE_.
 * - Supabase Auth handles token refresh automatically; we never store tokens in localStorage
 *   manually (Supabase SDK stores them, which is the standard pattern).
 * - All authenticated API calls include the JWT in the Authorization header via api.ts.
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — auth will not work.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

/** Returns the current session JWT, or null if not logged in. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}
