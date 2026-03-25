/**
 * JobPanel.tsx
 *
 * Shows live job status with polling via React Query.
 * Stops polling when job reaches terminal state (done/failed).
 * Progress bar advances deterministically through pipeline steps.
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getJobStatus, regradeJob } from '../lib/api'
import type { JobStatus } from '../lib/api'

const RE_EDIT_THEMES = [
  { value: 'none',     label: 'Natural' },
  { value: 'dark',     label: 'Dark Tones' },
  { value: 'sepia',    label: 'Sepia' },
  { value: 'warm',     label: 'Amber' },
  { value: 'low_exp',  label: 'Low Exposure' },
  { value: 'grey',     label: 'Silver' },
  { value: 'blue',     label: 'Cobalt' },
  { value: 'red',      label: 'Crimson' },
  { value: 'bw',       label: 'Monochrome' },
  { value: 'mocha',    label: 'Mocha' },
  { value: 'noir',     label: 'Noir' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'dusk',     label: 'Dusk' },
]

const RE_EDIT_THEME_DOT: Record<string, string> = {
  none:     'bg-stone-400',
  warm:     'bg-amber-500',
  dark:     'bg-stone-900 ring-1 ring-stone-600',
  grey:     'bg-slate-400',
  blue:     'bg-blue-500',
  red:      'bg-red-500',
  bw:       'bg-white ring-1 ring-stone-500',
  sepia:    'bg-amber-800',
  low_exp:  'bg-stone-950 ring-1 ring-stone-700',
  mocha:    'bg-amber-950',
  noir:     'bg-stone-900 ring-1 ring-amber-900',
  midnight: 'bg-blue-950 ring-1 ring-cyan-900',
  dusk:     'bg-purple-900 ring-1 ring-purple-700',
}

// ─── Pipeline progress overlay ───────────────────────────────────────────────

const PIPELINE_STEPS = [
  { key: 'fetch',    emoji: '🔍', label: 'Searching for photos',  sub: 'Searching photo libraries for your terms'    },
  { key: 'download', emoji: '📷', label: 'Collecting photos',     sub: null                                         },
  { key: 'grade',    emoji: '🎨', label: 'Applying your look',    sub: 'Colour grading and finishing the images'    },
  { key: 'render',   emoji: '🎬', label: 'Building the video',    sub: 'Stitching your photos into a slideshow'     },
  { key: 'upload',   emoji: '✨', label: 'Almost there',          sub: 'Uploading and generating your download link'},
]

const CLIPS_PIPELINE_STEPS = [
  { key: 'download', emoji: '📥', label: 'Downloading clips',     sub: null                                         },
  { key: 'render',   emoji: '🎬', label: 'Rendering video',       sub: 'Applying colour grade and stitching clips'  },
  { key: 'upload',   emoji: '✨', label: 'Almost there',          sub: 'Uploading and generating your download link'},
]

const QUOTES = [
  { text: 'The impediment to action advances action. What stands in the way becomes the way.', author: 'Marcus Aurelius' },
  { text: 'Begin at once to live, and count each separate day as a separate life.', author: 'Seneca' },
  { text: 'Some things are in our control and others not.', author: 'Epictetus' },
  { text: 'If it is not right, do not do it; if it is not true, do not say it.', author: 'Marcus Aurelius' },
  { text: 'No man ever steps in the same river twice, for it is not the same river and he is not the same man.', author: 'Heraclitus' },
  { text: 'It is not that we have a short time to live, but that we waste a lot of it.', author: 'Seneca' },
  { text: 'While we are postponing, life speeds by.', author: 'Seneca' },
  { text: 'The unexamined life is not worth living.', author: 'Socrates' },
]

function activeStepIdx(msg: string | null): number {
  if (!msg || msg === 'Queued') return -1
  if (msg.startsWith('Loading') || msg.startsWith('Fetching') || msg.startsWith('API limit')) return 0
  if (msg.startsWith('Downloading')) return 1
  if (msg.startsWith('Applying') || msg.startsWith('Adding')) return 2
  if (msg.startsWith('Rendering')) return 3
  if (msg.startsWith('Uploading')) return 4
  return -1
}

function activeClipsStepIdx(msg: string | null): number {
  if (!msg || msg === 'Queued') return -1
  if (msg.startsWith('Downloading')) return 0
  if (msg.startsWith('Rendering')) return 1
  if (msg.startsWith('Uploading')) return 2
  return -1
}

function ProgressOverlay({ status, message, imageCount, persistedSource, searchTerms, maxPerQuery, isClips, onMouseEnter, onMouseLeave }: {
  status: string
  message: string | null
  imageCount: { done: number; total: number } | null
  persistedSource: string | null
  searchTerms?: string[] | null
  maxPerQuery?: number | null
  isClips?: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}) {
  const [hoveredStep, setHoveredStep] = useState<string | null>(null)
  const msg = message ?? ''
  const isQueued = !msg || msg === 'Queued'
  const steps = isClips ? CLIPS_PIPELINE_STEPS : PIPELINE_STEPS
  const idx = status === 'done' ? steps.length : (isClips ? activeClipsStepIdx(msg) : activeStepIdx(msg))

  const termCount = searchTerms?.length ?? 0
  const targetImages = termCount && maxPerQuery ? termCount * maxPerQuery : null
  const source = msg.includes('Pexels') ? 'Pexels' : msg.includes('Unsplash') ? 'Unsplash' : persistedSource

  return (
    <div
      className="absolute top-full left-0 right-0 z-50 pt-2"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
    <div className="rounded-xl border border-stone-600/80 bg-stone-900 shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-2.5 border-b border-stone-800/80">
        <p className="text-xs font-semibold text-stone-200">
          {isQueued ? 'Waiting to start…' : 'Your video is being made'}
        </p>
        {!isQueued && (
          <p className="text-xs text-stone-500 mt-0.5">You can carry on. We'll let you know when it's ready</p>
        )}
      </div>

      {!isQueued && (
        <div className="px-4 pb-3 border-b border-stone-800/60">
          {(() => {
            const q = QUOTES[Math.floor(Date.now() / 10000) % QUOTES.length]
            return (
              <p className="text-[10px] text-stone-600 leading-relaxed italic">
                "{q.text}" — {q.author}
              </p>
            )
          })()}
        </div>
      )}

      {/* Steps */}
      <div className="px-4 py-3 space-y-2.5">
        {isQueued ? (
          <div className="flex items-center gap-2.5 py-1">
            <span className="text-base">⏳</span>
            <p className="text-xs text-stone-400">Your job is in the queue and will start shortly</p>
          </div>
        ) : (
          steps.map((step, i) => {
            const isDone   = i < idx
            const isActive = i === idx
            const subText  = step.key === 'download' && imageCount != null && !isClips
              ? (isDone
                  ? `${imageCount.done} photos collected`
                  : `${imageCount.done}/${imageCount.total} photos downloaded`)
              : step.sub
            const hasDetail = !isClips && (step.key === 'fetch' || step.key === 'download') && (isActive || isDone)

            return (
              <div
                key={step.key}
                className={`flex flex-col gap-1 transition-opacity ${i > idx ? 'opacity-25' : 'opacity-100'}`}
                onMouseEnter={hasDetail ? () => setHoveredStep(step.key) : undefined}
                onMouseLeave={hasDetail ? () => setHoveredStep(null) : undefined}
              >
              <div className="flex items-center gap-3">
                {/* Step icon */}
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm ${
                  isDone   ? 'bg-emerald-500/10 text-emerald-400' :
                  isActive ? 'bg-brand-500/10' :
                  'bg-stone-800'
                }`}>
                  {isDone
                    ? <span className="text-emerald-400 font-bold text-xs">✓</span>
                    : <span className={isActive ? 'animate-pulse' : ''}>{step.emoji}</span>
                  }
                </div>

                {/* Label + sub */}
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-medium leading-snug ${
                    isDone   ? 'text-stone-500' :
                    isActive ? 'text-stone-100' :
                    'text-stone-600'
                  }`}>
                    {step.label}
                  </p>
                  {(isActive || (isDone && subText)) && (
                    <p className="text-xs text-stone-500 mt-0.5 leading-snug">{subText}</p>
                  )}
                </div>

                {/* Active pulse dot */}
                {isActive && (
                  <span className="relative flex h-2 w-2 ml-auto flex-shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-50" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
                  </span>
                )}
              </div>

              {/* Detail sub-panel — fetch step or download step */}
              {hasDetail && hoveredStep === step.key && (
                <div className="ml-10 rounded-lg border border-stone-700 bg-stone-800/80 px-3 py-2 space-y-1">
                  {termCount > 0 && (
                    <p className="text-xs text-stone-400">
                      <span className="text-stone-300 font-medium">{termCount}</span> search {termCount === 1 ? 'term' : 'terms'}
                      {targetImages && <span> · targeting <span className="text-stone-300 font-medium">~{targetImages}</span> images</span>}
                    </p>
                  )}
                  {source && (
                    <p className="text-xs text-stone-400">Source: <span className="text-stone-300 font-medium">{source}</span></p>
                  )}
                  {imageCount != null ? (
                    <p className="text-xs text-stone-400">
                      {step.key === 'download' && isDone
                        ? <><span className="text-stone-300 font-medium">{imageCount.done}</span> photos collected</>
                        : <><span className="text-stone-300 font-medium">{imageCount.done}</span>/<span className="text-stone-300 font-medium">{imageCount.total}</span> photos downloaded</>
                      }
                    </p>
                  ) : targetImages && step.key === 'download' && isDone ? (
                    <p className="text-xs text-stone-400">~<span className="text-stone-300 font-medium">{targetImages}</span> photos collected</p>
                  ) : null}
                  {msg.includes('retrying') && (
                    <p className="text-xs text-amber-500/80">{msg}</p>
                  )}
                </div>
              )}
              </div>
            )
          })
        )}
      </div>
    </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  queued: '⏳ Queued',
  running: '⚙️ Processing…',
  done: '✅ Complete',
  failed: '❌ Failed',
  deleted: '🗑 Deleted',
}

function friendlyError(msg: string): string {
  if (msg.includes('No images returned') || msg.includes('no images'))
    return 'No images found for these search terms. Try different or broader keywords.'
  if (msg.includes('429') || msg.includes('Rate Limit') || msg.includes('rate limit') || msg.includes('API limit'))
    return 'Photo API rate limit reached. Wait a few minutes then try again.'
  return msg
}

// Maps progress_message prefixes → % complete
function stepProgress(status: string, msg: string | null): number {
  if (status === 'done') return 100
  if (!msg || msg === 'Queued') return 5
  if (msg.startsWith('Loading uploaded')) return 10
  if (msg.startsWith('Fetching') || msg.startsWith('API limit')) return 20
  if (msg.startsWith('Downloading')) return 40
  if (msg.startsWith('Applying')) return 60
  if (msg.startsWith('Rendering')) return 75
  if (msg.startsWith('Uploading')) return 90
  return 5
}

// Rough seconds-remaining estimates per pipeline stage
function estimatedSecsRemaining(status: string, msg: string | null, imageCount: { done: number; total: number } | null): number {
  if (status === 'done' || status === 'failed') return 0
  if (!msg || msg === 'Queued') return 50
  if (msg.startsWith('Loading uploaded') || msg.startsWith('Fetching') || msg.startsWith('API limit')) return 40
  if (msg.startsWith('Downloading')) {
    if (imageCount && imageCount.total > 0) {
      const frac = 1 - imageCount.done / imageCount.total
      return Math.round(4 + frac * 24) // 4–28s depending on progress
    }
    return 28
  }
  if (msg.startsWith('Applying')) return 16
  if (msg.startsWith('Rendering')) return 10
  if (msg.startsWith('Uploading')) return 4
  return 50
}

function formatEta(secs: number): string {
  if (secs <= 0) return ''
  if (secs < 60) return `~${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return s > 0 ? `~${m}m ${s}s` : `~${m}m`
}

interface Props {
  jobId: string
  title?: string | null
  minimized?: boolean
  onToggleMinimize?: () => void
  onDismiss?: () => void
  onDone?: (job: JobStatus) => void
  onCancel?: () => Promise<void>
  onEstimate?: (secs: number) => void
  onRetry?: (job: JobStatus) => void
  onRegraded?: (newJobId: string, title: string | null) => void
  onColourGrade?: (terms: string[], batchTitle: string | null, settings: { color_theme: string; seconds_per_image?: number; total_seconds?: number } | null, theme: string) => void
}

export default function JobPanel({ jobId, title, minimized, onToggleMinimize, onDismiss, onDone, onCancel, onEstimate, onRetry, onRegraded, onColourGrade }: Props) {
  const [cancelling, setCancelling] = useState(false)
  const [showOverlay, setShowOverlay] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [reEditOpen, setReEditOpen] = useState(false)
  const [reEditTheme, setReEditTheme] = useState('none')
  const [reEditSpi, setReEditSpi] = useState<number | null>(null)
  const [reEditTotal, setReEditTotal] = useState<number | null>(null)
  const [reEditing, setReEditing] = useState(false)
  const imageCountRef = useRef<{ done: number; total: number } | null>(null)
  const sourceRef = useRef<string | null>(null)
  const overlayHideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  function openOverlay() {
    if (overlayHideTimeout.current) clearTimeout(overlayHideTimeout.current)
    setShowOverlay(true)
  }
  function closeOverlayDelayed() {
    overlayHideTimeout.current = setTimeout(() => setShowOverlay(false), 200)
  }

  const { data: job, isLoading, error, refetch } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => getJobStatus(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'done' || status === 'failed' ? false : 3000
    },
  })

  // Auto-dismiss if job no longer exists (404 / deleted from DB)
  useEffect(() => {
    if (error && onDismiss) {
      const msg = (error as Error).message ?? ''
      if (msg.includes('404') || msg.includes('not found') || msg.includes('Not found')) {
        onDismiss()
      }
    }
  }, [error])  // eslint-disable-line react-hooks/exhaustive-deps

  const doneFired = useRef(false)
  const jobRef = useRef(job)
  jobRef.current = job
  useEffect(() => {
    if (job?.status === 'done' && !doneFired.current) {
      doneFired.current = true
      if (onDone) onDone(jobRef.current!)
      // images_cached is written after status=done on the backend — do one
      // delayed refetch to pick it up so the Re-edit button can appear
      const t = setTimeout(() => refetch(), 4000)
      return () => clearTimeout(t)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status])

  // Persist image count + source so they remain visible after message changes
  useEffect(() => {
    const msg = job?.progress_message ?? ''
    const m = msg.match(/Downloading (\d+)(?:\/(\d+))?/)
    if (m) imageCountRef.current = { done: parseInt(m[1], 10), total: m[2] ? parseInt(m[2], 10) : parseInt(m[1], 10) }
    if (msg.includes('Pexels')) sourceRef.current = 'Pexels'
    else if (msg.includes('Unsplash')) sourceRef.current = 'Unsplash'
    if (onEstimate && job) {
      onEstimate(estimatedSecsRemaining(job.status, job.progress_message, imageCountRef.current))
    }
  }, [job?.progress_message, job?.status])

  if (isLoading) return <div className="text-sm text-stone-500">Loading…</div>
  if (error) return (
    <div className="flex items-center justify-between gap-3 text-sm text-red-400 px-1">
      <span>Job not found.</span>
      {onDismiss && (
        <button onClick={onDismiss} className="text-xs text-stone-500 hover:text-stone-300 transition">Dismiss</button>
      )}
    </div>
  )
  if (!job) return null

  const isTerminal = job.status === 'done' || job.status === 'failed'
  const pct = stepProgress(job.status, job.progress_message)
  const displayTitle = title ?? job.batch_title

  async function handleDownload(url: string) {
    setDownloading(true)
    const filename = `${displayTitle ?? jobId.slice(0, 8)}.mp4`
    try {
      const blob = await fetch(url).then(r => r.blob())
      const file = new File([blob], filename, { type: 'video/mp4' })

      // Web Share API with file support — works on iOS and Android (Chrome 86+)
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] })
        return
      }

      // Desktop: blob URL anchor download
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      if (!isMobile) {
        const blobUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(blobUrl)
        return
      }

      // Mobile fallback (no Web Share API) — open in browser + instruct user
      window.open(url, '_blank')
      window.dispatchEvent(new CustomEvent('cogito:toast', {
        detail: { message: 'Hold on the video and tap "Save to Photos" to download', duration: 7000 }
      }))
    } catch {
      window.open(url, '_blank')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="rounded-xl border border-stone-700 bg-stone-800 p-4 relative">
      {/* Progress overlay (hover) */}
      {!isTerminal && showOverlay && (
        <ProgressOverlay
          status={job.status}
          message={job.progress_message}
          imageCount={imageCountRef.current}
          persistedSource={sourceRef.current}
          searchTerms={job.search_terms}
          maxPerQuery={job.max_per_query}
          isClips={!job.search_terms?.length}
          onMouseEnter={openOverlay}
          onMouseLeave={closeOverlayDelayed}
        />
      )}

      {/* Header row */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-stone-200">
            {STATUS_LABELS[job.status] ?? job.status}
          </span>
          {/* Magnifying glass — hover to see progress detail */}
          {!isTerminal && (
            <button
              onMouseEnter={openOverlay}
              onMouseLeave={closeOverlayDelayed}
              className="text-stone-500 hover:text-stone-200 transition-colors focus:outline-none flex-shrink-0"
              aria-label="Show progress detail"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <circle cx="8.5" cy="8.5" r="5" />
                <line x1="13" y1="13" x2="17" y2="17" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-stone-500 truncate max-w-32">
            {displayTitle ?? jobId.slice(0, 8) + '…'}
          </span>
          {!isTerminal && onCancel && (
            <button
              onClick={async () => {
                if (!confirm('Cancel this job? The render will be terminated.')) return
                setCancelling(true)
                await onCancel()
              }}
              disabled={cancelling}
              className="text-xs text-stone-600 hover:text-red-400 leading-none disabled:opacity-40"
              title="Cancel job"
            >
              {cancelling ? '…' : '✕'}
            </button>
          )}
          {isTerminal && onToggleMinimize && (
            <button
              onClick={onToggleMinimize}
              className="text-xs text-stone-500 hover:text-stone-300 leading-none"
              title={minimized ? 'Expand' : 'Minimise'}
            >
              {minimized ? '▼' : '▲'}
            </button>
          )}
          {isTerminal && onDismiss && (
            <button
              onClick={onDismiss}
              className="text-xs text-stone-600 hover:text-red-400 leading-none"
              title="Dismiss"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Metadata strip */}
      {!minimized && (job.color_theme || job.resolution || job.total_seconds) && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2">
          {job.color_theme && job.color_theme !== 'none' && (
            <span className="rounded-md bg-stone-800 px-2 py-0.5 text-xs text-stone-400 capitalize">
              {{
                dark: 'Dark Tones', sepia: 'Sepia', warm: 'Amber', grey: 'Silver',
                blue: 'Cobalt', red: 'Crimson', bw: 'Mono', low_exp: 'Low Exposure',
              }[job.color_theme] ?? job.color_theme}
            </span>
          )}
          {job.resolution && (
            <span className="rounded-md bg-stone-800 px-2 py-0.5 text-xs text-stone-400">{job.resolution}</span>
          )}
          {job.total_seconds != null && (
            <span className="rounded-md bg-stone-800 px-2 py-0.5 text-xs text-stone-400">{job.total_seconds}s</span>
          )}
          {job.preset_name && (
            <span className="rounded-md bg-stone-800 px-2 py-0.5 text-xs text-stone-500 italic">{job.preset_name}</span>
          )}
        </div>
      )}

      {/* Collapsed content when minimised */}
      {minimized ? null : (
        <>
          {job.progress_message && !isTerminal && (
            <p className="text-xs text-stone-400 mb-2">{job.progress_message}</p>
          )}

          {!isTerminal && (() => {
            const etaSecs = estimatedSecsRemaining(job.status, job.progress_message, imageCountRef.current)
            const eta = job.status !== 'queued' && job.status !== 'failed' ? formatEta(etaSecs) : ''
            const showPreviews = job.preview_images && job.preview_images.length > 0 && !['queued', 'done', 'failed'].includes(job.status)
            return (
              <div>
                {/* Progress bar */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-700 relative">
                  <div
                    className="h-1.5 rounded-full bg-brand-500 transition-all duration-700 relative overflow-hidden"
                    style={{ width: `${pct}%` }}
                  >
                    <div className="absolute inset-0 progress-shimmer" />
                  </div>
                </div>

                {/* ETA + carry on hint */}
                <div className="flex items-center justify-between mt-1">
                  <p className="text-[10px] text-stone-600">Keep going — we'll ping you when it's ready</p>
                  {eta && <p className="text-[10px] text-stone-600">{eta} remaining</p>}
                </div>

                {/* Preview image strip */}
                {showPreviews && (
                  <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
                    {job.preview_images!.map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt=""
                        className="h-12 w-8 rounded object-cover flex-shrink-0 opacity-70"
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {job.status === 'done' && job.output_url && (
            <div className="mt-3 space-y-2">
              <video
                src={job.output_url}
                poster={job.thumbnail_url ?? undefined}
                autoPlay
                muted
                loop
                controls
                controlsList="nodownload"
                className="w-full max-h-96 rounded-lg object-contain bg-black"
              />
              <button
                onClick={() => handleDownload(job.output_url!)}
                disabled={downloading}
                className="block w-full rounded-lg bg-brand-500 py-2 text-center text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {downloading ? 'Downloading…' : 'Download video'}
              </button>
              {job.status === 'done' && onRegraded && (
                <button
                  onClick={() => {
                    setReEditOpen(o => !o)
                    if (!reEditOpen) {
                      setReEditTheme(job.color_theme ?? 'none')
                      setReEditSpi(job.seconds_per_image ?? null)
                      setReEditTotal(job.total_seconds ?? null)
                    }
                  }}
                  className={`w-full rounded-lg border py-1.5 text-xs font-medium transition ${
                    reEditOpen
                      ? 'border-brand-500 text-brand-400 bg-brand-500/10'
                      : 'border-stone-700 bg-stone-800 text-stone-400 hover:border-stone-600 hover:text-stone-200'
                  }`}
                >
                  Re-edit video
                </button>
              )}
              {reEditOpen && job.status === 'done' && onRegraded && (
                <div className="rounded-lg border border-stone-700 bg-stone-900 p-3 space-y-3">
                  {/* Theme picker */}
                  <div>
                    <p className="text-[10px] text-stone-600 mb-1.5">Colour theme:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {RE_EDIT_THEMES.map(t => (
                        <button
                          key={t.value}
                          onClick={() => setReEditTheme(t.value)}
                          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                            reEditTheme === t.value
                              ? 'border-brand-500 text-brand-400 bg-brand-500/10'
                              : 'border-stone-700 bg-stone-800 text-stone-300 hover:border-stone-500'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${RE_EDIT_THEME_DOT[t.value] ?? 'bg-stone-500'}`} />
                          {t.label}
                        </button>
                      ))}
                    </div>
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

                  <button
                    onClick={async () => {
                      setReEditing(true)
                      const newTitle = job.batch_title
                        ? `${job.batch_title} · ${reEditTheme}`
                        : reEditTheme
                      try {
                        if (job.images_cached) {
                          const res = await regradeJob(job.job_id, {
                            color_theme: reEditTheme,
                            ...(reEditSpi != null ? { seconds_per_image: reEditSpi } : {}),
                            ...(reEditTotal != null ? { total_seconds: reEditTotal } : {}),
                          })
                          onRegraded(res.job_id, newTitle)
                        } else if (onColourGrade && job.search_terms?.length) {
                          // Images not cached yet — fall back to full re-render
                          onColourGrade(job.search_terms, job.batch_title ?? null, {
                            color_theme: reEditTheme,
                            ...(reEditSpi != null ? { seconds_per_image: reEditSpi } : {}),
                            ...(reEditTotal != null ? { total_seconds: reEditTotal } : {}),
                          }, reEditTheme)
                        } else {
                          alert('Images not yet cached — try again in a few seconds.')
                          return
                        }
                        setReEditOpen(false)
                      } catch (e: unknown) {
                        alert(e instanceof Error ? e.message : 'Re-edit failed')
                      } finally {
                        setReEditing(false)
                      }
                    }}
                    disabled={reEditing}
                    className="w-full rounded-lg bg-brand-500 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition"
                  >
                    {reEditing ? 'Starting…' : 'Re-render'}
                  </button>
                </div>
              )}
            </div>
          )}

          {job.status === 'failed' && (
            <div className="mt-3 space-y-2">
              {job.error_message && (
                <p className="rounded-lg bg-red-950 px-3 py-2 text-xs text-red-400">
                  {friendlyError(job.error_message)}
                </p>
              )}
              {onRetry && job.search_terms?.length ? (
                <button
                  onClick={() => onRetry(job)}
                  className="text-xs text-stone-500 hover:text-stone-200 transition-colors"
                >
                  ↩ Retry
                </button>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  )
}
