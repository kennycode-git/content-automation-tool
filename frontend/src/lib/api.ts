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
  created_at: string
  completed_at: string | null
}

export interface Preset {
  id: string
  name: string
  settings: Record<string, unknown>
  created_at: string
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken()
  console.log("TOKEN BEING SENT:", token ? token.substring(0, 50) : "NULL")
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
}

export interface PreviewStageRequest {
  batches: PreviewBatchRequest[]
  resolution?: string
  seconds_per_image?: number
  total_seconds?: number
  max_per_query?: number
  color_theme?: string
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

// ─── Image upload + prefetch ──────────────────────────────────────────────────

export interface PrefetchRequest {
  search_terms: string[]
  resolution?: string
  seconds_per_image?: number
  total_seconds?: number
  max_per_query?: number
}

export async function prefetchImages(req: PrefetchRequest): Promise<{ paths: string[] }> {
  if (DEV_BYPASS) return { paths: [] }
  const res = await fetch(`${API_URL}/api/prefetch-images`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(req),
  })
  return handleResponse<{ paths: string[] }>(res)
}

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
