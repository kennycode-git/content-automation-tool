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

const COLOR_THEMES = [
  { value: 'none',    label: 'Natural' },
  { value: 'dark',    label: 'Dark Tones' },
  { value: 'sepia',   label: 'Sepia' },
  { value: 'warm',    label: 'Amber' },
  { value: 'low_exp', label: 'Low Exposure' },
  { value: 'grey',    label: 'Silver' },
  { value: 'blue',    label: 'Cobalt' },
  { value: 'red',     label: 'Crimson' },
  { value: 'bw',      label: 'Monochrome' },
]

const STATUS_ICON: Record<string, string> = {
  queued: '⏳',
  running: '⚙️',
  done: '✅',
  failed: '❌',
  deleted: '🗑',
}

const THEME_LABEL: Record<string, string> = {
  none: 'Natural', warm: 'Amber', dark: 'Dark Tones', grey: 'Silver',
  blue: 'Cobalt', red: 'Crimson', bw: 'Mono', sepia: 'Sepia', low_exp: 'Low Exposure',
}

const THEME_DOT: Record<string, string> = {
  none:    'bg-stone-400',
  warm:    'bg-amber-500',
  dark:    'bg-stone-900 ring-1 ring-stone-600',
  grey:    'bg-slate-400',
  blue:    'bg-blue-500',
  red:     'bg-red-500',
  bw:      'bg-white ring-1 ring-stone-500',
  sepia:   'bg-amber-800',
  low_exp: 'bg-stone-950 ring-1 ring-stone-700',
}

interface Props {
  onReuse?: (title: string | null, terms: string[], settings: Partial<VideoSettings> | null) => void
  onEditImages?: (terms: string[], batchTitle: string | null) => void
  onColourGrade?: (terms: string[], batchTitle: string | null, settings: Partial<VideoSettings> | null, theme: string) => void
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

export default function RecentJobs({ onReuse, onEditImages, onColourGrade }: Props) {
  const qc = useQueryClient()
  const [resigning, setResigning] = useState<Record<string, boolean>>({})
  // Track when each job was last re-signed (ms timestamp) so expiry resets correctly
  const [resignedAt, setResignedAt] = useState<Record<string, number>>({})
  const [gradingJob, setGradingJob] = useState<string | null>(null)

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
            className="rounded-lg border border-stone-800 bg-stone-900 px-3 py-2.5"
          >
            {/* Info row */}
            <div className="flex items-center gap-2 min-w-0">
              {job.thumbnail_url
                ? <img src={job.thumbnail_url} alt="" className="w-9 h-9 rounded object-cover shrink-0" />
                : null
              }
              <span className="shrink-0 text-sm leading-none">{STATUS_ICON[job.status] ?? '?'}</span>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-stone-300 truncate" title={job.batch_title ?? undefined}>
                  {job.batch_title ? job.batch_title : job.job_id.slice(0, 8) + '…'}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs text-stone-600 shrink-0">
                    {new Date(job.created_at).toLocaleString()}
                  </span>
                  {meta && <span className="text-xs text-stone-700 shrink-0">· {meta}</span>}
                  {job.color_theme && job.color_theme !== 'none' && (
                    <span
                      className={`inline-block w-2 h-2 rounded-full shrink-0 ${THEME_DOT[job.color_theme] ?? 'bg-stone-500'}`}
                      title={THEME_LABEL[job.color_theme] ?? job.color_theme}
                    />
                  )}
                  {expiry === 'warning' && (
                    <span className="text-xs text-amber-600 shrink-0">⚠ expiring</span>
                  )}
                  {expiry === 'expired' && (
                    <span className="text-xs text-red-700 shrink-0">✕ expired</span>
                  )}
                </div>
              </div>
            </div>

            {/* Actions row */}
            <div className="flex items-center gap-3 mt-2 pl-0 flex-wrap">
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
              {onEditImages && job.status === 'done' && job.search_terms && job.search_terms.length > 0 && (
                <button
                  onClick={() => onEditImages(job.search_terms!, job.batch_title ?? null)}
                  className="text-xs text-stone-500 hover:text-stone-300 transition"
                  title="Re-fetch images and edit before re-rendering"
                >
                  Edit images
                </button>
              )}
              {onColourGrade && job.search_terms && job.search_terms.length > 0 && (
                <button
                  onClick={() => setGradingJob(gradingJob === job.job_id ? null : job.job_id)}
                  className={`text-xs transition ${gradingJob === job.job_id ? 'text-brand-400' : 'text-stone-500 hover:text-stone-300'}`}
                  title="Re-generate with a different colour grade"
                >
                  Colour grade
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

            {/* Colour grade theme picker */}
            {gradingJob === job.job_id && onColourGrade && (
              <div className="mt-2 pt-2 border-t border-stone-800">
                <p className="text-[10px] text-stone-600 mb-1.5">Pick a colour grade to regenerate:</p>
                <div className="flex flex-wrap gap-1.5">
                  {COLOR_THEMES.map(t => (
                    <button
                      key={t.value}
                      onClick={() => {
                        onColourGrade(job.search_terms!, job.batch_title ?? null, extractSettings(job), t.value)
                        setGradingJob(null)
                      }}
                      className="flex items-center gap-1 rounded-full border border-stone-700 bg-stone-800 px-2 py-0.5 text-xs text-stone-300 hover:border-brand-500 hover:text-brand-400 transition"
                    >
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${THEME_DOT[t.value] ?? 'bg-stone-500'}`} />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
