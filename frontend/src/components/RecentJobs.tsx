/**
 * RecentJobs.tsx
 *
 * Lists the last 10 jobs for the current user.
 * Shows metadata (preset / duration + theme), URL expiry warning, and resign button.
 * Refreshes every 30s.
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRecentJobs, deleteJob, resignJob, regradeJob, deleteJobImages, listUserPhilosophers, reviewRegradeImages } from '../lib/api'
import type { JobStatus, LayeredConfig, PreviewBatchResult, UserPhilosopher } from '../lib/api'
import type { VideoSettings } from './SettingsPanel'
import JobMetaPopover from './JobMetaPopover'
import BackgroundVideoPicker from './BackgroundVideoPicker'
import PreviewModal from './PreviewModal'
import type { ConfirmedBatch } from './PreviewModal'
import { PHILOSOPHER_LIST, detectPhilosopher } from './BatchEditor'

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
  { value: 'midnight', label: 'Midnight' },
  { value: 'dusk',    label: 'Dusk' },
]

function getReEditThemes(job: JobStatus) {
  if (job.custom_grade_params || job.color_theme === 'custom') {
    return [...COLOR_THEMES, { value: 'custom', label: 'Saved Custom' }]
  }
  return COLOR_THEMES
}

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
  mocha: 'Mocha', noir: 'Noir', midnight: 'Midnight', dusk: 'Dusk',
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
  midnight: 'bg-blue-950 ring-1 ring-cyan-900',
  dusk:    'bg-purple-900 ring-1 ring-purple-700',
  custom:  'bg-fuchsia-500',
}

const ACCENT_LABEL: Record<string, string> = {
  blue: 'Blue accent',
  red: 'Red accent',
  gold: 'Gold accent',
  green: 'Green accent',
  purple: 'Purple accent',
}

const RE_EDIT_ACCENTS = [
  { value: 'none', label: 'None' },
  { value: 'blue', label: 'Blue accent' },
  { value: 'red', label: 'Red accent' },
  { value: 'gold', label: 'Gold accent' },
  { value: 'green', label: 'Green accent' },
  { value: 'purple', label: 'Purple accent' },
]

const THEME_SUFFIXES = [
  'natural', 'dark tones', 'sepia', 'amber', 'low exposure', 'silver', 'cobalt',
  'crimson', 'monochrome', 'mocha', 'noir', 'midnight', 'dusk', 'custom',
  'none', 'dark', 'warm', 'low_exp', 'grey', 'blue', 'red', 'bw',
]

const GRADE_TARGET_LABEL: Record<string, string> = {
  foreground: 'Grade FG',
  background: 'Grade BG',
  both: 'Grade both',
}

interface Props {
  onReuse?: (title: string | null, terms: string[], settings: Partial<VideoSettings> | null) => void
  onEditImages?: (terms: string[], batchTitle: string | null, settings: ReturnType<typeof extractSettings>) => void
  onColourGrade?: (terms: string[], batchTitle: string | null, settings: ((Partial<VideoSettings> & {
    custom_grade_params?: JobStatus['custom_grade_params']
    accent_folder?: string | null
    philosopher?: string | null
    philosopher_count?: number | null
    grade_philosopher?: boolean | null
    philosopher_is_user?: boolean | null
    preset_name?: string | null
    text_overlay?: JobStatus['text_overlay']
    ai_voiceover?: JobStatus['ai_voiceover']
  }) & { layered_config?: LayeredConfig | null }) | null, theme: string) => void
  onRegrade?: (newJobId: string, title: string | null) => void
}

function extractSettings(job: JobStatus): (Partial<VideoSettings> & {
  custom_grade_params?: JobStatus['custom_grade_params']
  accent_folder?: string | null
  philosopher?: string | null
  philosopher_count?: number | null
  grade_philosopher?: boolean | null
  philosopher_is_user?: boolean | null
  preset_name?: string | null
  text_overlay?: JobStatus['text_overlay']
  ai_voiceover?: JobStatus['ai_voiceover']
}) | null {
  const s: Partial<VideoSettings> & {
    custom_grade_params?: JobStatus['custom_grade_params']
    accent_folder?: string | null
    philosopher?: string | null
    philosopher_count?: number | null
    grade_philosopher?: boolean | null
    philosopher_is_user?: boolean | null
    preset_name?: string | null
    text_overlay?: JobStatus['text_overlay']
    ai_voiceover?: JobStatus['ai_voiceover']
  } = {}
  if (job.resolution) s.resolution = job.resolution
  if (job.seconds_per_image != null) s.seconds_per_image = job.seconds_per_image
  if (job.total_seconds != null) s.total_seconds = job.total_seconds
  if (job.fps != null) s.fps = job.fps
  if (job.allow_repeats != null) s.allow_repeats = job.allow_repeats
  if (job.color_theme) s.color_theme = job.color_theme
  if (job.max_per_query != null) s.max_per_query = job.max_per_query
  if (job.custom_grade_params) s.custom_grade_params = job.custom_grade_params
  if (job.accent_folder) s.accent_folder = job.accent_folder
  if (job.philosopher) s.philosopher = job.philosopher
  if (job.philosopher_count != null) s.philosopher_count = job.philosopher_count
  if (job.grade_philosopher != null) s.grade_philosopher = job.grade_philosopher
  if (job.philosopher_is_user != null) s.philosopher_is_user = job.philosopher_is_user
  if (job.preset_name) s.preset_name = job.preset_name
  if (job.text_overlay) s.text_overlay = job.text_overlay
  if (job.ai_voiceover) s.ai_voiceover = job.ai_voiceover
  return Object.keys(s).length > 0 ? s : null
}

function buildJobMeta(job: JobStatus): string[] {
  const chips: string[] = []
  if (job.total_seconds != null) chips.push(`${job.total_seconds}s`)
  if (job.mode === 'clips') {
    if (job.transition) chips.push(job.transition.replace('_', ' '))
    if (job.clip_count != null) chips.push(`${job.clip_count} clips`)
  }
  if (job.mode === 'layered' && job.layered_config) {
    chips.push(`Opacity ${Math.round(job.layered_config.foreground_opacity * 100)}%`)
    chips.push(`BG ${Math.round((job.layered_config.background_opacity ?? 1) * 100)}%`)
    chips.push(GRADE_TARGET_LABEL[job.layered_config.grade_target] ?? job.layered_config.grade_target)
  }
  if (job.accent_folder) chips.push(ACCENT_LABEL[job.accent_folder] ?? `${job.accent_folder} accent`)
  if (job.philosopher) {
    chips.push(
      job.philosopher
        .split('_')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    )
  }
  if (job.text_overlay?.enabled && job.text_overlay.font) {
    chips.push(`Font: ${job.text_overlay.font.replace(/_/g, ' ')}`)
  }
  if (job.ai_voiceover?.enabled) chips.push('Voiceover')
  return chips
}

function stripThemeSuffix(title: string | null | undefined): string | null | undefined {
  if (!title) return title
  const parts = title.split(' · ')
  if (parts.length < 2) return title
  const last = parts[parts.length - 1]?.trim().toLowerCase()
  if (!last || !THEME_SUFFIXES.includes(last)) return title
  return parts.slice(0, -1).join(' · ')
}

/** Returns 'ok' | 'warning' (< 4h left) | 'expired' based on completed_at or a manual resign time */
function inferReEditPhilosopher(job: JobStatus): string {
  return job.philosopher
    ?? detectPhilosopher(stripThemeSuffix(job.batch_title) ?? '')
    ?? ''
}

function isUserPhilosopherKey(key: string, userPhilosophers: UserPhilosopher[]): boolean {
  return userPhilosophers.some(p => p.key === key)
}

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
  const [reEditJob, setReEditJob] = useState<string | null>(null)
  const [reEditTheme, setReEditTheme] = useState('none')
  const [reEditAccent, setReEditAccent] = useState<string>('none')
  const [reEditPhilosopher, setReEditPhilosopher] = useState<string>('')
  const [reEditPhilosopherCount, setReEditPhilosopherCount] = useState<number>(3)
  const [reEditGradePhilosopher, setReEditGradePhilosopher] = useState<boolean>(true)
  const [reEditPhilosopherIsUser, setReEditPhilosopherIsUser] = useState<boolean>(false)
  const [reEditSpi, setReEditSpi] = useState<number | null>(null)
  const [reEditTotal, setReEditTotal] = useState<number | null>(null)
  const [reEditFgOpacity, setReEditFgOpacity] = useState<number | null>(null)
  const [reEditBgOpacity, setReEditBgOpacity] = useState<number | null>(null)
  const [reEditGradeTarget, setReEditGradeTarget] = useState<'foreground' | 'background' | 'both'>('both')
  const [reEditBgVideoUrls, setReEditBgVideoUrls] = useState<string[] | null>(null)
  const [reviewImages, setReviewImages] = useState(false)
  const [reviewData, setReviewData] = useState<PreviewBatchResult | null>(null)
  const [reviewJob, setReviewJob] = useState<JobStatus | null>(null)
  const [loadingReview, setLoadingReview] = useState<Record<string, boolean>>({})
  const [reEditing, setReEditing] = useState<Record<string, boolean>>({})
  const [deletingImages, setDeletingImages] = useState<Record<string, boolean>>({})
  const [clearingAll, setClearingAll] = useState(false)
  const [userPhilosophers, setUserPhilosophers] = useState<UserPhilosopher[]>([])
  const pendingRegrade = useRef<{
    job: JobStatus
    theme: string
    accent: string
    spi: number | null
    total: number | null
    philosopher: string | null
    philosopher_count: number
    grade_philosopher: boolean
    philosopher_is_user: boolean
  } | null>(null)

  const { data: jobs = [], refetch } = useQuery({
    queryKey: ['jobs'],
    queryFn: getRecentJobs,
    refetchInterval: 30_000,
  })

  useEffect(() => {
    listUserPhilosophers().then(setUserPhilosophers).catch(() => {})
  }, [])

  async function handleDelete(jobId: string) {
    if (!confirm('Delete this job and its video file?')) return
    await deleteJob(jobId)
    qc.setQueryData<JobStatus[]>(['jobs'], prev => (prev ?? []).filter(job => job.job_id !== jobId))
    refetch()
  }

  async function handleDeleteVisible() {
    if (jobs.length === 0) return
    if (!confirm(`Clear all ${jobs.length} recent job${jobs.length !== 1 ? 's' : ''} and delete their files?`)) return
    setClearingAll(true)
    try {
      await Promise.all(jobs.map(job => deleteJob(job.job_id)))
      qc.setQueryData<JobStatus[]>(['jobs'], [])
      refetch()
    } finally {
      setClearingAll(false)
    }
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

  async function handleReEditSubmit(job: JobStatus) {
    const jobId = job.job_id
    try {
      const layeredConfig = job.mode === 'layered' && job.layered_config
        ? {
            ...job.layered_config,
            background_video_urls: reEditBgVideoUrls ?? job.layered_config.background_video_urls,
            foreground_opacity: reEditFgOpacity ?? job.layered_config.foreground_opacity,
            background_opacity: reEditBgOpacity ?? (job.layered_config.background_opacity ?? 1),
            foreground_speed: reEditSpi ?? job.layered_config.foreground_speed,
            grade_target: reEditGradeTarget,
          }
        : undefined
      const resolvedPhilosopher = reEditPhilosopher || null
      if (reviewImages && job.images_cached) {
        setLoadingReview(prev => ({ ...prev, [jobId]: true }))
        pendingRegrade.current = {
          job,
          theme: reEditTheme,
          accent: reEditAccent,
          spi: reEditSpi,
          total: reEditTotal,
          philosopher: resolvedPhilosopher,
          philosopher_count: reEditPhilosopherCount,
          grade_philosopher: reEditGradePhilosopher,
          philosopher_is_user: reEditPhilosopherIsUser,
        }
        try {
          const data = await reviewRegradeImages(jobId, {
            color_theme: reEditTheme,
            accent_folder: reEditAccent === 'none' ? null : reEditAccent,
            ...(reEditSpi != null ? { seconds_per_image: reEditSpi } : {}),
            ...(reEditTotal != null ? { total_seconds: reEditTotal } : {}),
            ...(reEditTheme === 'custom' && job.custom_grade_params ? { custom_grade_params: job.custom_grade_params } : {}),
            philosopher: resolvedPhilosopher,
            philosopher_count: reEditPhilosopherCount,
            grade_philosopher: resolvedPhilosopher ? reEditGradePhilosopher : false,
            philosopher_is_user: resolvedPhilosopher ? reEditPhilosopherIsUser : false,
            ...(layeredConfig ? { layered_config: layeredConfig } : {}),
          })
          setReviewJob(job)
          setReviewData(data)
        } catch (e: unknown) {
          pendingRegrade.current = null
          alert(e instanceof Error ? e.message : 'Could not load cached images.')
        } finally {
          setLoadingReview(prev => ({ ...prev, [jobId]: false }))
        }
        return
      }

      setReEditing(prev => ({ ...prev, [jobId]: true }))
      if (job.images_cached) {
        const res = await regradeJob(jobId, {
          color_theme: reEditTheme,
          accent_folder: reEditAccent === 'none' ? null : reEditAccent,
          ...(reEditSpi != null ? { seconds_per_image: reEditSpi } : {}),
          ...(reEditTotal != null ? { total_seconds: reEditTotal } : {}),
          ...(reEditTheme === 'custom' && job.custom_grade_params ? { custom_grade_params: job.custom_grade_params } : {}),
          philosopher: resolvedPhilosopher,
          philosopher_count: reEditPhilosopherCount,
          grade_philosopher: resolvedPhilosopher ? reEditGradePhilosopher : false,
          philosopher_is_user: resolvedPhilosopher ? reEditPhilosopherIsUser : false,
          ...(layeredConfig ? { layered_config: layeredConfig } : {}),
        })
        const newTitle = job.batch_title
          ? `${job.batch_title} · ${reEditTheme}`
          : reEditTheme
        onRegrade?.(res.job_id, newTitle)
      } else {
        const updatedSettings: ReturnType<typeof extractSettings> & { layered_config?: LayeredConfig | null } = {
          ...extractSettings(job),
          accent_folder: reEditAccent === 'none' ? null : reEditAccent,
          ...(reEditSpi != null ? { seconds_per_image: reEditSpi } : {}),
          ...(reEditTotal != null ? { total_seconds: reEditTotal } : {}),
          ...(reEditTheme === 'custom' && job.custom_grade_params ? { custom_grade_params: job.custom_grade_params } : {}),
          philosopher: resolvedPhilosopher,
          philosopher_count: resolvedPhilosopher ? reEditPhilosopherCount : undefined,
          grade_philosopher: resolvedPhilosopher ? reEditGradePhilosopher : undefined,
          philosopher_is_user: resolvedPhilosopher ? reEditPhilosopherIsUser : undefined,
          ...(layeredConfig ? { layered_config: layeredConfig } : {}),
        }
        onColourGrade?.(job.search_terms!, job.batch_title ?? null, updatedSettings, reEditTheme)
      }
      setReEditJob(null)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Re-edit failed')
    } finally {
      setReEditing(prev => ({ ...prev, [jobId]: false }))
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
      setReEditJob(null)
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
      {jobs.length > 1 && (
        <div className="flex justify-end">
          <button
            onClick={handleDeleteVisible}
            disabled={clearingAll}
            className="text-xs text-stone-500 hover:text-red-400 transition disabled:opacity-50"
            title="Clear all visible recent jobs"
          >
            {clearingAll ? 'Clearing...' : 'Clear all'}
          </button>
        </div>
      )}
      {jobs.map(job => {
        const expiry = expiryStatus(job, resignedAt[job.job_id])
        const meta = job.preset_name ?? null
        const detailChips = buildJobMeta(job)
        const metadataItems = [
          `Created ${new Date(job.created_at).toLocaleString()}`,
          ...(meta ? [`Preset ${meta}`] : []),
          ...detailChips,
          ...(expiry === 'warning' ? ['Download link expiring soon'] : []),
          ...(expiry === 'expired' ? ['Download link expired'] : []),
        ]

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
                <div className="flex items-center gap-2 min-w-0">
                  <p className="font-mono text-xs text-stone-300 truncate" title={job.batch_title ?? undefined}>
                    {job.batch_title ? stripThemeSuffix(job.batch_title) : `${job.job_id.slice(0, 8)}...`}
                  </p>
                  {job.color_theme && (
                    <span
                      className={`inline-block h-2 w-2 rounded-full shrink-0 ${THEME_DOT[job.color_theme] ?? 'bg-stone-500'}`}
                      title={THEME_LABEL[job.color_theme] ?? job.color_theme}
                    />
                  )}
                  <JobMetaPopover items={metadataItems} />
                </div>
              </div>
              <div className="hidden">
                <p className="font-mono text-xs text-stone-300 truncate" title={job.batch_title ?? undefined}>
                  {job.batch_title ? job.batch_title : job.job_id.slice(0, 8) + '…'}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs text-stone-600 shrink-0">
                    {new Date(job.created_at).toLocaleString()}
                  </span>
                  {meta && <span className="text-xs text-stone-700 shrink-0">· {meta}</span>}
                  {detailChips.length > 0 && (
                    <span className="text-xs text-stone-700 truncate">· {detailChips.join(' · ')}</span>
                  )}
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
                  onClick={() => onEditImages(job.search_terms!, job.batch_title ?? null, extractSettings(job))}
                  className="text-xs text-stone-500 hover:text-stone-300 transition"
                  title="Re-fetch images and edit before re-rendering"
                >
                  Edit images
                </button>
              )}
              {job.status === 'done' && (job.images_cached || (job.search_terms && job.search_terms.length > 0 && onColourGrade)) && (
                <button
                  onClick={() => {
                  if (reEditJob === job.job_id) {
                    setReEditJob(null)
                    setReviewImages(false)
                  } else {
                    setReEditJob(job.job_id)
                    setReviewImages(false)
                    setReEditTheme(job.color_theme ?? 'none')
                      setReEditAccent(job.accent_folder ?? 'none')
                      const initialPhilosopher = inferReEditPhilosopher(job)
                      setReEditPhilosopher(initialPhilosopher)
                      setReEditPhilosopherCount(job.philosopher_count ?? 3)
                      setReEditGradePhilosopher(job.grade_philosopher ?? true)
                      setReEditPhilosopherIsUser(job.philosopher_is_user ?? isUserPhilosopherKey(initialPhilosopher, userPhilosophers))
                      setReEditSpi(job.seconds_per_image ?? null)
                      setReEditTotal(job.total_seconds ?? null)
                      setReEditFgOpacity(job.layered_config?.foreground_opacity ?? null)
                      setReEditBgOpacity(job.layered_config?.background_opacity ?? 1)
                      setReEditGradeTarget(job.layered_config?.grade_target ?? 'both')
                      setReEditBgVideoUrls(job.layered_config?.background_video_urls ?? null)
                    }
                  }}
                  className={`text-xs transition ${reEditJob === job.job_id ? 'text-brand-400' : 'text-stone-500 hover:text-stone-300'}`}
                  title="Change colour theme, pacing, or length and re-render"
                >
                  Re-edit video
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

            {/* Re-edit video panel */}
            {reEditJob === job.job_id && (
              <div className="mt-2 pt-2 border-t border-stone-800 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-stone-500 font-medium">Re-edit video</p>
                  {job.images_cached && (
                    <button
                      onClick={() => handleDeleteCachedImages(job.job_id)}
                      disabled={deletingImages[job.job_id]}
                      className="text-[10px] text-stone-700 hover:text-red-500 transition disabled:opacity-40"
                      title="Delete cached images to free storage"
                    >
                      {deletingImages[job.job_id] ? 'Deleting…' : 'Delete cached images'}
                    </button>
                  )}
                </div>

                {/* Theme picker */}
                <div>
                  <p className="text-[10px] text-stone-600 mb-1.5">Colour theme:</p>
                  <select
                    value={reEditTheme}
                    onChange={e => setReEditTheme(e.target.value)}
                    className="w-full rounded-lg border border-stone-700 bg-stone-800 px-2.5 py-2 text-xs text-stone-200 focus:border-brand-500 focus:outline-none"
                  >
                    {getReEditThemes(job).map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <p className="text-[10px] text-stone-600 mb-1.5">Accent images:</p>
                  <select
                    value={reEditAccent}
                    onChange={e => setReEditAccent(e.target.value)}
                    className="w-full rounded-lg border border-stone-700 bg-stone-800 px-2.5 py-2 text-xs text-stone-200 focus:border-brand-500 focus:outline-none"
                  >
                    {RE_EDIT_ACCENTS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] text-stone-600 mb-1.5">Philosopher images:</p>
                  <select
                    value={reEditPhilosopher}
                    onChange={e => {
                      const value = e.target.value
                      setReEditPhilosopher(value)
                      setReEditPhilosopherIsUser(isUserPhilosopherKey(value, userPhilosophers))
                    }}
                    className="w-full rounded-lg border border-stone-700 bg-stone-800 px-2.5 py-2 text-xs text-stone-200 focus:border-brand-500 focus:outline-none"
                  >
                    <option value="">None</option>
                    <optgroup label="System">
                      {PHILOSOPHER_LIST.map(p => (
                        <option key={p.key} value={p.key}>{p.display}</option>
                      ))}
                    </optgroup>
                    {userPhilosophers.length > 0 && (
                      <optgroup label="My philosophers">
                        {userPhilosophers.map(p => (
                          <option key={p.key} value={p.key}>{p.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {reEditPhilosopher && (
                    <>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-[10px] text-stone-600">Philosopher images</p>
                          <span className="text-[10px] text-stone-400 font-mono">{reEditPhilosopherCount}</span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={5}
                          step={1}
                          value={reEditPhilosopherCount}
                          onChange={e => setReEditPhilosopherCount(Number(e.target.value))}
                          className="w-full accent-brand-500"
                        />
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={reEditGradePhilosopher}
                          onChange={e => setReEditGradePhilosopher(e.target.checked)}
                          className="accent-brand-500 w-3.5 h-3.5"
                        />
                        <span className="text-xs text-stone-400">Color grade philosopher images</span>
                      </label>
                    </>
                  )}
                </div>

                {/* Seconds per image */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] text-stone-600">Seconds per image</p>
                    <span className="text-[10px] text-stone-400 font-mono">
                      {(reEditSpi ?? job.seconds_per_image ?? 0.13).toFixed(2)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.05}
                    max={2.0}
                    step={0.01}
                    value={reEditSpi ?? job.seconds_per_image ?? 0.13}
                    onChange={e => setReEditSpi(parseFloat(e.target.value))}
                    className="w-full accent-brand-500"
                  />
                </div>

                {/* Video length */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] text-stone-600">Video length</p>
                    <span className="text-[10px] text-stone-400 font-mono">
                      {(reEditTotal ?? job.total_seconds ?? 11)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={60}
                    step={1}
                    value={reEditTotal ?? job.total_seconds ?? 11}
                    onChange={e => setReEditTotal(parseFloat(e.target.value))}
                    className="w-full accent-brand-500"
                  />
                </div>

                {job.mode === 'layered' && job.layered_config && (
                  <>
                    <BackgroundVideoPicker
                      selectedUrls={reEditBgVideoUrls ?? job.layered_config.background_video_urls}
                      onChange={urls => setReEditBgVideoUrls(urls)}
                      compact
                    />

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] text-stone-600">Foreground image opacity</p>
                        <span className="text-[10px] text-stone-400 font-mono">{Math.round((reEditFgOpacity ?? job.layered_config.foreground_opacity) * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={reEditFgOpacity ?? job.layered_config.foreground_opacity}
                        onChange={e => setReEditFgOpacity(parseFloat(e.target.value))}
                        className="w-full accent-brand-500"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] text-stone-600">Background video opacity</p>
                        <span className="text-[10px] text-stone-400 font-mono">{Math.round((reEditBgOpacity ?? job.layered_config.background_opacity ?? 1) * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={reEditBgOpacity ?? job.layered_config.background_opacity ?? 1}
                        onChange={e => setReEditBgOpacity(parseFloat(e.target.value))}
                        className="w-full accent-brand-500"
                      />
                    </div>

                    <div>
                      <p className="text-[10px] text-stone-600 mb-1.5">Apply colour grade to</p>
                      <select
                        value={reEditGradeTarget}
                        onChange={e => setReEditGradeTarget(e.target.value as 'foreground' | 'background' | 'both')}
                        className="w-full rounded-lg border border-stone-700 bg-stone-800 px-2.5 py-2 text-xs text-stone-200 focus:border-brand-500 focus:outline-none"
                      >
                        <option value="foreground">Foreground only</option>
                        <option value="background">Background only</option>
                        <option value="both">Both</option>
                      </select>
                    </div>
                  </>
                )}

                <button
                  onClick={() => handleReEditSubmit(job)}
                  disabled={reEditing[job.job_id] || loadingReview[job.job_id]}
                  className="w-full rounded-lg bg-brand-500 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition"
                >
                  {loadingReview[job.job_id] ? 'Loading images…' : reEditing[job.job_id] ? 'Starting…' : 'Re-render'}
                </button>

                {job.images_cached && (
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={reviewImages}
                      onChange={e => setReviewImages(e.target.checked)}
                      className="accent-brand-500 w-3.5 h-3.5"
                    />
                    <span className="text-xs text-stone-400">Review image selection first</span>
                  </label>
                )}
              </div>
            )}
          </div>
        )
      })}
      {reviewData && reviewJob && (
        <PreviewModal
          batches={[reviewData]}
          onConfirm={async (confirmed: ConfirmedBatch[]) => {
            setReviewData(null)
            const pending = pendingRegrade.current
            if (!pending) return
            const job = pending.job
            setReEditing(prev => ({ ...prev, [job.job_id]: true }))
            try {
              const selectedPaths = confirmed[0]?.images.map(i => i.render_storage_path ?? i.storage_path) ?? []
              const layeredConfig = job.mode === 'layered' && job.layered_config
                ? {
                    ...job.layered_config,
                    background_video_urls: reEditBgVideoUrls ?? job.layered_config.background_video_urls,
                    foreground_opacity: reEditFgOpacity ?? job.layered_config.foreground_opacity,
                    background_opacity: reEditBgOpacity ?? (job.layered_config.background_opacity ?? 1),
                    foreground_speed: pending.spi ?? job.layered_config.foreground_speed,
                    grade_target: reEditGradeTarget,
                  }
                : undefined
              const res = await regradeJob(job.job_id, {
                color_theme: pending.theme,
                accent_folder: pending.accent === 'none' ? null : pending.accent,
                ...(pending.spi != null ? { seconds_per_image: pending.spi } : {}),
                ...(pending.total != null ? { total_seconds: pending.total } : {}),
                ...(selectedPaths.length ? { selected_paths: selectedPaths } : {}),
                ...(pending.theme === 'custom' && job.custom_grade_params ? { custom_grade_params: job.custom_grade_params } : {}),
                philosopher: pending.philosopher,
                philosopher_count: pending.philosopher ? pending.philosopher_count : undefined,
                grade_philosopher: pending.philosopher ? pending.grade_philosopher : false,
                philosopher_is_user: pending.philosopher ? pending.philosopher_is_user : false,
                ...(layeredConfig ? { layered_config: layeredConfig } : {}),
              })
              const newTitle = job.batch_title
                ? `${job.batch_title} · ${pending.theme}`
                : pending.theme
              onRegrade?.(res.job_id, newTitle)
              setReEditJob(null)
              setReviewImages(false)
            } catch (e: unknown) {
              alert(e instanceof Error ? e.message : 'Re-edit failed')
            } finally {
              setReEditing(prev => ({ ...prev, [job.job_id]: false }))
              pendingRegrade.current = null
              setReviewJob(null)
            }
          }}
          onCancel={() => {
            setReviewData(null)
            setReviewJob(null)
            pendingRegrade.current = null
          }}
        />
      )}
    </div>
  )
}
