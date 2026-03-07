/**
 * JobPanel.tsx
 *
 * Shows live job status with polling via React Query.
 * Stops polling when job reaches terminal state (done/failed).
 * Progress bar advances deterministically through pipeline steps.
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getJobStatus } from '../lib/api'
import type { JobStatus } from '../lib/api'

const STATUS_LABELS: Record<string, string> = {
  queued: '⏳ Queued',
  running: '⚙️ Processing…',
  done: '✅ Complete',
  failed: '❌ Failed',
  deleted: '🗑 Deleted',
}

function friendlyError(msg: string): string {
  if (msg.includes('No images returned') || msg.includes('no images'))
    return 'No images found for these search terms. Unsplash free tier allows ~50 requests/hour — try fewer terms or wait a few minutes before retrying.'
  if (msg.includes('429') || msg.includes('Rate Limit') || msg.includes('rate limit'))
    return 'Unsplash rate limit reached (~50 requests/hour on the free tier). Wait a few minutes then try again.'
  return msg
}

// Maps progress_message prefixes → % complete
function stepProgress(status: string, msg: string | null): number {
  if (status === 'done') return 100
  if (!msg || msg === 'Queued') return 5
  if (msg.startsWith('Loading uploaded')) return 10
  if (msg.startsWith('Fetching')) return 20
  if (msg.startsWith('Downloading')) return 40
  if (msg.startsWith('Applying')) return 60
  if (msg.startsWith('Rendering')) return 75
  if (msg.startsWith('Uploading')) return 90
  return 5
}

interface Props {
  jobId: string
  title?: string | null
  minimized?: boolean
  onToggleMinimize?: () => void
  onDismiss?: () => void
  onDone?: (job: JobStatus) => void
  onCancel?: () => Promise<void>
}

export default function JobPanel({ jobId, title, minimized, onToggleMinimize, onDismiss, onDone, onCancel }: Props) {
  const [cancelling, setCancelling] = useState(false)
  const { data: job, isLoading, error } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => getJobStatus(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'done' || status === 'failed' ? false : 3000
    },
  })

  const doneFired = useRef(false)
  useEffect(() => {
    if (job?.status === 'done' && onDone && !doneFired.current) {
      doneFired.current = true
      onDone(job)
    }
  }, [job?.status, job, onDone])

  if (isLoading) return <div className="text-sm text-stone-500">Loading…</div>
  if (error) return <div className="text-sm text-red-400">Error loading job status.</div>
  if (!job) return null

  const isTerminal = job.status === 'done' || job.status === 'failed'
  const pct = stepProgress(job.status, job.progress_message)
  const displayTitle = title ?? job.batch_title

  return (
    <div className="rounded-xl border border-stone-700 bg-stone-800 p-4">
      {/* Header row */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-stone-200">
          {STATUS_LABELS[job.status] ?? job.status}
        </span>
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

      {/* Collapsed content when minimised */}
      {minimized ? null : (
        <>
          {job.progress_message && !isTerminal && (
            <p className="text-xs text-stone-400 mb-2">{job.progress_message}</p>
          )}

          {!isTerminal && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-700">
              <div
                className="h-1.5 rounded-full bg-brand-500 transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          {job.status === 'done' && job.output_url && (
            <div className="mt-3 space-y-2">
              <video
                src={job.output_url}
                poster={job.thumbnail_url ?? undefined}
                autoPlay
                muted
                loop
                controls
                className="w-full max-h-96 rounded-lg object-contain bg-black"
              />
              <a
                href={job.output_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-lg bg-brand-500 py-2 text-center text-sm font-semibold text-white hover:bg-brand-700"
              >
                Download video
              </a>
            </div>
          )}

          {job.status === 'failed' && job.error_message && (
            <p className="mt-3 rounded-lg bg-red-950 px-3 py-2 text-xs text-red-400">
              {friendlyError(job.error_message)}
            </p>
          )}
        </>
      )}
    </div>
  )
}
