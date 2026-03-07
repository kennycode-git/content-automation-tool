/**
 * RecentJobs.tsx
 *
 * Lists the last 10 jobs for the current user.
 * Shows metadata (preset / duration + theme), URL expiry warning, and resign button.
 * Refreshes every 30s.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRecentJobs, deleteJob, resignJob } from '../lib/api'
import type { JobStatus } from '../lib/api'
import type { VideoSettings } from './SettingsPanel'

const STATUS_ICON: Record<string, string> = {
  queued: '⏳',
  running: '⚙️',
  done: '✅',
  failed: '❌',
  deleted: '🗑',
}

const THEME_LABEL: Record<string, string> = {
  none: 'Natural', warm: 'Amber', dark: 'Dark', grey: 'Silver',
  blue: 'Cobalt', red: 'Crimson', bw: 'Mono',
}

const THEME_DOT: Record<string, string> = {
  none: 'bg-stone-500', warm: 'bg-amber-500', dark: 'bg-zinc-500',
  grey: 'bg-slate-400', blue: 'bg-blue-500', red: 'bg-red-500', bw: 'bg-stone-200',
}

interface Props {
  onReuse?: (title: string | null, terms: string[], settings: Partial<VideoSettings> | null) => void
}

function extractSettings(job: JobStatus): Partial<VideoSettings> | null {
  const s: Partial<VideoSettings> = {}
  if (job.resolution) s.resolution = job.resolution
  if (job.seconds_per_image != null) s.seconds_per_image = job.seconds_per_image
  if (job.total_seconds != null) s.total_seconds = job.total_seconds
  if (job.fps != null) s.fps = job.fps
  if (job.allow_repeats != null) s.allow_repeats = job.allow_repeats
  if (job.color_theme) s.color_theme = job.color_theme
  if (job.max_per_query != null) s.max_per_query = job.max_per_query
  return Object.keys(s).length > 0 ? s : null
}

/** Returns 'ok' | 'warning' (< 4h left) | 'expired' based on completed_at or a manual resign time */
function expiryStatus(job: JobStatus, resignedAt?: number): 'ok' | 'warning' | 'expired' {
  if (job.status !== 'done' || !job.completed_at || !job.output_url) return 'ok'
  const base = resignedAt ?? new Date(job.completed_at).getTime()
  const expiresAt = base + 48 * 3600 * 1000
  const now = Date.now()
  if (now >= expiresAt) return 'expired'
  if (now >= expiresAt - 4 * 3600 * 1000) return 'warning'
  return 'ok'
}

export default function RecentJobs({ onReuse }: Props) {
  const qc = useQueryClient()
  const [resigning, setResigning] = useState<Record<string, boolean>>({})
  // Track when each job was last re-signed (ms timestamp) so expiry resets correctly
  const [resignedAt, setResignedAt] = useState<Record<string, number>>({})

  const { data: jobs = [], refetch } = useQuery({
    queryKey: ['jobs'],
    queryFn: getRecentJobs,
    refetchInterval: 30_000,
  })

  async function handleDelete(jobId: string) {
    if (!confirm('Delete this job and its video file?')) return
    await deleteJob(jobId)
    refetch()
  }

  async function handleResign(jobId: string) {
    setResigning(prev => ({ ...prev, [jobId]: true }))
    try {
      const { output_url } = await resignJob(jobId)
      // Update the cached job list so the URL is immediately fresh
      qc.setQueryData<JobStatus[]>(['jobs'], prev =>
        (prev ?? []).map(j => j.job_id === jobId ? { ...j, output_url } : j)
      )
      setResignedAt(prev => ({ ...prev, [jobId]: Date.now() }))
    } catch {
      alert('Could not refresh the URL — the video file may have been deleted from storage.')
    } finally {
      setResigning(prev => ({ ...prev, [jobId]: false }))
    }
  }

  if (jobs.length === 0) {
    return <p className="text-xs text-stone-600">No jobs yet.</p>
  }

  return (
    <div className="space-y-2">
      {jobs.map(job => {
        const expiry = expiryStatus(job, resignedAt[job.job_id])
        const meta = job.preset_name ?? (job.total_seconds != null ? `${job.total_seconds}s` : null)

        return (
          <div
            key={job.job_id}
            className="rounded-lg border border-stone-800 bg-stone-900 px-3 py-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                {job.thumbnail_url && (
                  <img src={job.thumbnail_url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
                )}
                <span>{STATUS_ICON[job.status] ?? '?'}</span>
                <div className="min-w-0">
                  <p className="font-mono text-xs text-stone-400 truncate" title={job.batch_title ?? undefined}>
                    {job.batch_title ? job.batch_title : job.job_id.slice(0, 8) + '…'}
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-xs text-stone-600">
                      {new Date(job.created_at).toLocaleString()}
                    </p>
                    {meta && (
                      <span className="text-xs text-stone-700">· {meta}</span>
                    )}
                    {job.color_theme && job.color_theme !== 'none' && (
                      <span
                        className={`inline-block w-2 h-2 rounded-full shrink-0 ${THEME_DOT[job.color_theme] ?? 'bg-stone-500'}`}
                        title={THEME_LABEL[job.color_theme] ?? job.color_theme}
                      />
                    )}
                    {expiry === 'warning' && (
                      <span className="text-xs text-amber-600" title="URL expires in under 4 hours">⚠ expiring</span>
                    )}
                    {expiry === 'expired' && (
                      <span className="text-xs text-red-700" title="Signed URL has expired">✕ expired</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 ml-2">
                {job.output_url && expiry !== 'expired' && (
                  <a
                    href={job.output_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-brand-500 hover:underline"
                  >
                    Download
                  </a>
                )}
                {job.status === 'done' && (expiry === 'expired' || expiry === 'warning') && (
                  <button
                    onClick={() => handleResign(job.job_id)}
                    disabled={resigning[job.job_id]}
                    className="text-xs text-amber-600 hover:text-amber-400 disabled:opacity-50"
                    title="Generate a fresh 48h download link"
                  >
                    {resigning[job.job_id] ? '…' : 'Refresh URL'}
                  </button>
                )}
                {onReuse && job.search_terms && job.search_terms.length > 0 && (
                  <button
                    onClick={() => onReuse(job.batch_title ?? null, job.search_terms!, extractSettings(job))}
                    className="text-xs text-stone-500 hover:text-stone-300"
                    title="Load this job's terms and settings into the editor"
                  >
                    Duplicate
                  </button>
                )}
                <button
                  onClick={() => handleDelete(job.job_id)}
                  className="text-xs text-stone-600 hover:text-red-400"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
