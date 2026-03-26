/**
 * api.ts
 *
 * Typed fetch wrappers for the FastAPI backend.
 *
 * Security considerations:
 * - Every request includes the Supabase JWT in Authorization: Bearer <token>.
 *   The backend validates this on every protected endpoint.
 * - VITE_API_URL must be the Railway backend URL (set at Vercel build time).
 *   It should use HTTPS only — the backend enforces this via Railway's TLS termination.
 * - We never send the Stripe secret key or Supabase service key from the frontend.
 * - Error responses from the backend are sanitised (FastAPI returns HTTP errors with
 *   detail strings, not raw stack traces).
 */

import { getAccessToken } from './supabase'

const API_URL = import.meta.env.VITE_API_URL as string
const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS === 'true'

// Empty string = use relative URLs (Vite proxy in local dev). Must be set in production.
if (import.meta.env.PROD && !API_URL) {
  throw new Error('VITE_API_URL must be set.')
}

// ─── Dev bypass mocks ────────────────────────────────────────────────────────
// Used when VITE_DEV_BYPASS=true so the full UI is explorable without a real
// backend or Supabase project. Remove VITE_DEV_BYPASS before deploying.
const DEV_JOB_ID = 'dev-job-preview'
const DEV_MOCK_JOB: JobStatus = {
  job_id: DEV_JOB_ID,
  status: 'done',
  progress_message: 'Dev bypass — no real job was run.',
  output_url: null,
  error_message: null,
  created_at: new Date().toISOString(),
  completed_at: new Date().toISOString(),
}
// ─────────────────────────────────────────────────────────────────────────────

export interface CustomGradeParams {
  brightness: number
  contrast: number
  saturation: number
  exposure: number
  warmth: number
  tint: number
  hue_shift: number
}

export type OverlayFont =
  | 'garamond' | 'cormorant' | 'playfair' | 'crimson' | 'philosopher' | 'lora'
  | 'outfit' | 'raleway' | 'josefin' | 'inter'
  | 'cinzel' | 'cinzel_deco' | 'uncial'
  | 'jetbrains' | 'space_mono'
export type OverlayColor     = 'white' | 'cream' | 'gold' | 'black' | 'custom'
export type OverlayAlignment = 'left' | 'center' | 'right'
export type OverlayPosition  =
  | 'top-left'    | 'top-center'    | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

export interface TextOverlayConfig {
  enabled: boolean
  text: string
  font: OverlayFont
  color: OverlayColor
  custom_color?: string | null
  background_box: boolean
  alignment: OverlayAlignment
  position: OverlayPosition
  font_size_pct?: number
}

export interface GenerateRequest {
  search_terms: string[]
  resolution?: string
  seconds_per_image?: number
  total_seconds?: number
  fps?: number
  allow_repeats?: boolean
  color_theme?: string
  max_per_query?: number
  batch_title?: string | null
  uploaded_image_paths?: string[]
  preset_name?: string | null
  uploaded_only?: boolean
  accent_folder?: string | null
  image_source?: 'unsplash' | 'pexels' | 'both'
  custom_grade_params?: CustomGradeParams
  philosopher?: string | null
  grade_philosopher?: boolean
  text_overlay?: TextOverlayConfig | null
}

export interface GenerateResponse {
  job_id: string
  status: 'queued'
}

export interface JobStatus {
  job_id: string
  status: string
  progress_message: string | null
  output_url: string | null
  thumbnail_url?: string | null
  error_message: string | null
  batch_title?: string | null
  search_terms?: string[] | null
  resolution?: string | null
  seconds_per_image?: number | null
  total_seconds?: number | null
  fps?: number | null
  allow_repeats?: boolean | null
  color_theme?: string | null
  max_per_query?: number | null
  preset_name?: string | null
  preview_images?: string[] | null
  custom_grade_params?: CustomGradeParams | null
  images_cached?: boolean | null
  created_at: string
  completed_at: string | null
}

export interface UsageInfo {
  plan: string
  status: string | null
  render_count: number
  limit: number | null
  trial_expires_at: string | null
  trial_expired: boolean
}

export interface Preset {
  id: string
  name: string
  settings: Record<string, unknown>
  created_at: string
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken()
  if (!token) throw new Error('Not authenticated.')
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function generateVideo(req: GenerateRequest): Promise<GenerateResponse> {
  if (DEV_BYPASS) return { job_id: DEV_JOB_ID, status: 'queued' }
  const res = await fetch(`${API_URL}/api/generate`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(req),
  })
  return handleResponse<GenerateResponse>(res)
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  if (DEV_BYPASS) return { ...DEV_MOCK_JOB }
  const res = await fetch(`${API_URL}/api/jobs/${jobId}`, {
    headers: await authHeaders(),
  })
  return handleResponse<JobStatus>(res)
}

export async function getRecentJobs(): Promise<JobStatus[]> {
  if (DEV_BYPASS) return [{ ...DEV_MOCK_JOB }]
  const res = await fetch(`${API_URL}/api/jobs`, {
    headers: await authHeaders(),
  })
  return handleResponse<JobStatus[]>(res)
}

export async function deleteJob(jobId: string): Promise<void> {
  if (DEV_BYPASS) return
  const res = await fetch(`${API_URL}/api/jobs/${jobId}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  })
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
}

export async function resignJob(jobId: string): Promise<{ output_url: string }> {
  const res = await fetch(`${API_URL}/api/jobs/${jobId}/resign`, {
    method: 'POST',
    headers: await authHeaders(),
  })
  return handleResponse<{ output_url: string }>(res)
}

export interface RegradeRequest {
  color_theme: string
  seconds_per_image?: number
  total_seconds?: number
  selected_paths?: string[]
}

export async function regradeJob(jobId: string, req: RegradeRequest): Promise<GenerateResponse> {
  const res = await fetch(`${API_URL}/api/jobs/${jobId}/regrade`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(req),
  })
  return handleResponse<GenerateResponse>(res)
}

export async function getRawImages(jobId: string): Promise<PreviewBatchResult> {
  const res = await fetch(`${API_URL}/api/jobs/${jobId}/raw-images`, {
    headers: await authHeaders(),
  })
  return handleResponse<PreviewBatchResult>(res)
}

export async function deleteJobImages(jobId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/jobs/${jobId}/images`, {
    method: 'DELETE',
    headers: await authHeaders(),
  })
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
}

// ─── Presets ─────────────────────────────────────────────────────────────────

export async function listPresets(): Promise<Preset[]> {
  if (DEV_BYPASS) return []
  const res = await fetch(`${API_URL}/api/presets`, { headers: await authHeaders() })
  return handleResponse<Preset[]>(res)
}

export async function createPreset(name: string, settings: Record<string, unknown>): Promise<Preset> {
  const res = await fetch(`${API_URL}/api/presets`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ name, settings }),
  })
  return handleResponse<Preset>(res)
}

export async function deletePreset(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/presets/${id}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  })
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
}

// ─── Preview staging ─────────────────────────────────────────────────────────

export interface PreviewBatchRequest {
  search_terms: string[]
  batch_title?: string | null
  uploaded_image_paths?: string[]
  color_theme?: string
  custom_grade_params?: Record<string, number>
}

export interface PreviewStageRequest {
  batches: PreviewBatchRequest[]
  resolution?: string
  seconds_per_image?: number
  total_seconds?: number
  max_per_query?: number
  color_theme?: string
  image_source?: string
}

export interface PreviewImageItem {
  storage_path: string
  signed_url: string
}

export interface PreviewBatchResult {
  batch_title: string | null
  search_terms: string[]
  images: PreviewImageItem[]
}

export interface PreviewStageResponse {
  batches: PreviewBatchResult[]
  pexels_fallback?: boolean
}

export async function stagePreview(req: PreviewStageRequest, signal?: AbortSignal): Promise<PreviewStageResponse> {
  if (DEV_BYPASS) {
    return {
      batches: req.batches.map(b => ({
        batch_title: b.batch_title ?? null,
        search_terms: b.search_terms,
        images: [],
      })),
    }
  }
  const res = await fetch(`${API_URL}/api/preview-stage`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(req),
    signal,
  })
  return handleResponse<PreviewStageResponse>(res)
}

// ─── Variants ─────────────────────────────────────────────────────────────────

export interface VariantsRequest {
  search_terms: string[]
  resolution?: string
  seconds_per_image?: number
  total_seconds?: number
  fps?: number
  allow_repeats?: boolean
  max_per_query?: number
  batch_title?: string | null
  themes: string[]
}

export async function generateVariants(req: VariantsRequest): Promise<{ job_ids: string[] }> {
  if (DEV_BYPASS) return { job_ids: req.themes.map(() => crypto.randomUUID()) }
  const res = await fetch(`${API_URL}/api/variants`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(req),
  })
  return handleResponse<{ job_ids: string[] }>(res)
}

// ─── Preview find more ────────────────────────────────────────────────────────

export interface FindMoreRequest {
  search_terms: string[]
  count: number
  resolution?: string
  color_theme?: string
  image_source?: string
  exclude_photo_ids?: string[]
  existing_count?: number
}

export interface FindMoreResponse {
  images: PreviewImageItem[]
}

export async function findMoreImages(req: FindMoreRequest): Promise<FindMoreResponse> {
  if (DEV_BYPASS) return { images: [] }
  const res = await fetch(`${API_URL}/api/preview-find-more`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(req),
  })
  return handleResponse<FindMoreResponse>(res)
}

// ─── Image upload ─────────────────────────────────────────────────────────────

export async function uploadImages(files: File[]): Promise<{ paths: string[] }> {
  const token = await getAccessToken()
  if (!token) throw new Error('Not authenticated.')
  const form = new FormData()
  for (const f of files) form.append('files', f)
  const res = await fetch(`${API_URL}/api/upload-images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  return handleResponse<{ paths: string[] }>(res)
}

// ─── Usage ────────────────────────────────────────────────────────────────────

export async function getUsage(): Promise<UsageInfo> {
  if (DEV_BYPASS) return { plan: 'trial', status: 'active', render_count: 3, limit: 100, trial_expires_at: null, trial_expired: false }
  const res = await fetch(`${API_URL}/api/usage`, { headers: await authHeaders() })
  return handleResponse<UsageInfo>(res)
}

// ─── TikTok ───────────────────────────────────────────────────────────────────

export interface TikTokAccount {
  id: string
  tiktok_user_id: string
  display_name: string | null
  avatar_url: string | null
  created_at: string
}

export interface ScheduledPost {
  id: string
  job_id: string
  batch_title: string | null
  tiktok_account_id: string | null
  tiktok_display_name: string | null
  caption: string
  hashtags: string[]
  privacy_level: string
  scheduled_at: string
  draft_mode: boolean
  status: 'pending' | 'posting' | 'posted' | 'failed' | 'cancelled'
  tiktok_publish_id: string | null
  error_message: string | null
  created_at: string
}

export interface SchedulePostRequest {
  job_id: string
  tiktok_account_id: string
  caption?: string
  hashtags?: string[]
  privacy_level?: string
  scheduled_at: string
  draft_mode?: boolean
}

export async function getTikTokAuthUrl(): Promise<{ url: string }> {
  const res = await fetch(`${API_URL}/api/tiktok/auth-url`, { headers: await authHeaders() })
  return handleResponse<{ url: string }>(res)
}

export async function exchangeTikTokCode(code: string, state: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/tiktok/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, state }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
}

export async function getTikTokAccounts(): Promise<TikTokAccount[]> {
  if (DEV_BYPASS) return []
  const res = await fetch(`${API_URL}/api/tiktok/accounts`, { headers: await authHeaders() })
  return handleResponse<TikTokAccount[]>(res)
}

export async function disconnectTikTok(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/tiktok/accounts/${id}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  })
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
}

export async function schedulePost(req: SchedulePostRequest): Promise<{ id: string }> {
  const res = await fetch(`${API_URL}/api/tiktok/schedule`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(req),
  })
  return handleResponse<{ id: string }>(res)
}

export async function getScheduledPosts(): Promise<ScheduledPost[]> {
  if (DEV_BYPASS) return []
  const res = await fetch(`${API_URL}/api/tiktok/scheduled`, { headers: await authHeaders() })
  return handleResponse<ScheduledPost[]>(res)
}

export async function cancelScheduledPost(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/tiktok/scheduled/${id}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  })
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
}

// ─── Video Clips ──────────────────────────────────────────────────────────────

export interface ClipSearchResult {
  id: string
  duration: number
  thumbnail: string
  preview_url: string
  download_url: string
  width: number
  height: number
}

export interface SelectedClip {
  id: string
  download_url: string
  preview_url: string
  thumbnail: string
  duration: number
  trim_start: number
  trim_end: number   // 0 = use full clip duration
}

export interface ClipGenerateRequest {
  clips: Array<{
    id: string
    download_url: string
    trim_start: number
    trim_end: number
    duration: number
  }>
  resolution?: string
  fps?: number
  color_theme?: string
  transition?: 'cut' | 'fade_black' | 'crossfade'
  transition_duration?: number
  max_clip_duration?: number
  batch_title?: string | null
  text_overlay?: TextOverlayConfig | null
}

export async function fetchVideoClips(
  terms: string[],
  perTerm: number,
  colorTheme: string,
  signal?: AbortSignal,
): Promise<{ clips: ClipSearchResult[] }> {
  if (DEV_BYPASS) return { clips: [] }
  const params = new URLSearchParams({
    terms: terms.join(','),
    per_term: String(perTerm),
    color_theme: colorTheme,
  })
  const res = await fetch(`${API_URL}/api/clips/search?${params}`, {
    headers: await authHeaders(),
    signal,
  })
  return handleResponse<{ clips: ClipSearchResult[] }>(res)
}

export async function generateFromClips(req: ClipGenerateRequest): Promise<GenerateResponse> {
  if (DEV_BYPASS) return { job_id: crypto.randomUUID(), status: 'queued' }
  const res = await fetch(`${API_URL}/api/clips/generate`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(req),
  })
  return handleResponse<GenerateResponse>(res)
}
