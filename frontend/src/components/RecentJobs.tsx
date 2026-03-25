/**
 * RecentJobs.tsx
 *
 * Lists the last 10 jobs for the current user.
 * Shows metadata (preset / duration + theme), URL expiry warning, and resign button.
 * Refreshes every 30s.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRecentJobs, deleteJob, resignJob, regradeJob, deleteJobImages } from '../lib/api'
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
  { value: 'mocha',   label: 'Mocha' },
  { value: 'noir',    label: 'Noir' },
  { value: 'abyss',   label: 'Abyss' },
  { value: 'dusk',    label: 'Dusk' },
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
  mocha: 'Mocha', noir: 'Noir', abyss: 'Abyss', dusk: 'Dusk',
  custom: 'Custom',
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
  mocha:   'bg-amber-950',
  noir:    'bg-stone-900 ring-1 ring-amber-900',
  abyss:   'bg-blue-950 ring-1 ring-cyan-900',
  dusk:    'bg-purple-900 ring-1 ring-purple-700',
  custom:  'bg-fuchsia-500',
}

interface Props {
  onReuse?: (title: string | null, terms: string[], settings: Partial<VideoSettings> | null) => void
  onEditImages?: (terms: string[], batchTitle: string | null) => void
  onColourGrade?: (terms: string[], batchTitle: string | null, settings: Partial<VideoSettings> | null, theme: string) => void
  onRegrade?: (newJobId: string, title: string | null) => void
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

export default function RecentJobs({ onReuse, onEditImages, onColourGrade, onRegrade }: Props) {
  const qc = useQueryClient()
  const [resigning, setResigning] = useState<Record<string, boolean>>({})
  // Track when each job was last re-signed (ms timestamp) so expiry resets correctly
  const [resignedAt, setResignedAt] = useState<Record<string, number>>({})
  const [gradingJob, setGradingJob] = useState<string | null>(null)
  const [regradeJob_, setRegradeJob] = useState<string | null>(null)
  const [regradeTheme, setRegradeTheme] = useState('none')
  const [regraduSpi, setRegraduSpi] = useState<number | null>(null)
  const [regrading, setRegrading] = useState<Record<string, boolean>>({})
  const [deletingImages, setDeletingImages] = useState<Record<string, boolean>>({})

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
      alert('Could not refresh the URL. The video file may have been deleted from storage.')
    } finally {
      setResigning(prev => ({ ...prev, [jobId]: false }))
    }
  }

  async function handleRegrade(jobId: string, secondsPerImage: number | null) {
    setRegrading(prev => ({ ...prev, [jobId]: true }))
    try {
      const res = await regradeJob(jobId, {
        color_theme: regradeTheme,
        ...(secondsPerImage != null ? { seconds_per_image: secondsPerImage } : {}),
      })
      const newTitle = jobs.find(j => j.job_id === jobId)?.batch_title
        ? `${jobs.find(j => j.job_id === jobId)!.batch_title} · ${regradeTheme}`
        : regradeTheme
      onRegrade?.(res.job_id, newTitle ?? null)
      setRegradeJob(null)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Re-grade failed')
    } finally {
      setRegrading(prev => ({ ...prev, [jobId]: false }))
    }
  }

  async function handleDeleteCachedImages(jobId: string) {
    if (!confirm('Delete cached images for this job? Re-grade will no longer be available.')) return
    setDeletingImages(prev => ({ ...prev, [jobId]: true }))
    try {
      await deleteJobImages(jobId)
      qc.setQueryData<JobStatus[]>(['jobs'], prev =>
        (prev ?? []).map(j => j.job_id === jobId ? { ...j, images_cached: false } : j)
      )
      setRegradeJob(null)
    } catch {
      alert('Could not delete cached images.')
    } finally {
      setDeletingImages(prev => ({ ...prev, [jobId]: false }))
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
              {job.status === 'done' && job.images_cached && (
                <button
                  onClick={() => {
                    if (regradeJob_ === job.job_id) {
                      setRegradeJob(null)
                    } else {
                      setRegradeJob(job.job_id)
                      setRegradeTheme(job.color_theme ?? 'none')
                      setRegraduSpi(job.seconds_per_image ?? null)
                    }
                  }}
                  className={`text-xs transition ${regradeJob_ === job.job_id ? 'text-brand-400' : 'text-stone-500 hover:text-stone-300'}`}
                  title="Re-render using cached images — no re-fetch needed"
                >
                  Re-grade
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

            {/* Re-grade panel — uses cached images, no re-fetch */}
            {regradeJob_ === job.job_id && (
              <div className="mt-2 pt-2 border-t border-stone-800 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-stone-500 font-medium">Re-grade from cached images</p>
                  <button
                    onClick={() => handleDeleteCachedImages(job.job_id)}
                    disabled={deletingImages[job.job_id]}
                    className="text-[10px] text-stone-700 hover:text-red-500 transition disabled:opacity-40"
                    title="Delete cached images to free storage"
                  >
                    {deletingImages[job.job_id] ? 'Deleting…' : 'Delete cached images'}
                  </button>
                </div>

                {/* Theme picker */}
                <div>
                  <p className="text-[10px] text-stone-600 mb-1.5">Colour theme:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {COLOR_THEMES.map(t => (
                      <button
                        key={t.value}
                        onClick={() => setRegradeTheme(t.value)}
                        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                          regradeTheme === t.value
                            ? 'border-brand-500 text-brand-400 bg-brand-500/10'
                            : 'border-stone-700 bg-stone-800 text-stone-300 hover:border-stone-500'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${THEME_DOT[t.value] ?? 'bg-stone-500'}`} />
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Pacing slider */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] text-stone-600">Seconds per image</p>
                    <span className="text-[10px] text-stone-400 font-mono">
                      {(regraduSpi ?? job.seconds_per_image ?? 0.13).toFixed(2)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.05}
                    max={2.0}
                    step={0.01}
                    value={regraduSpi ?? job.seconds_per_image ?? 0.13}
                    onChange={e => setRegraduSpi(parseFloat(e.target.value))}
                    className="w-full accent-brand-500"
                  />
                </div>

                <button
                  onClick={() => handleRegrade(job.job_id, regraduSpi)}
                  disabled={regrading[job.job_id]}
                  className="w-full rounded-lg bg-brand-500 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition"
                >
                  {regrading[job.job_id] ? 'Starting…' : 'Re-render'}
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
