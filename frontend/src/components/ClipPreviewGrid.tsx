/**
 * ClipPreviewGrid.tsx
 *
 * Clip picker UI for Video Clips mode.
 * Displays fetched Pexels clips as cards: thumbnail, play-on-click preview,
 * checkbox selection, per-clip trim controls, and up/down reorder buttons.
 */

import { useEffect, useRef, useState } from 'react'
import type { ClipSearchResult, SelectedClip } from '../lib/api'

interface Props {
  clips: ClipSearchResult[]
  selected: SelectedClip[]
  onSelectionChange: (clips: SelectedClip[]) => void
  onGenerate: (clips: SelectedClip[]) => void
  generating?: boolean
  maxClipDuration?: number
  maxTotalDuration?: number
  onLoadMore?: () => void
  hasMoreOptions?: boolean
  loadingMore?: boolean
}

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`
}

function getEffectiveClipDuration(
  clipDuration: number,
  trimStart: number,
  trimEnd: number,
  maxClipDuration: number,
) {
  const rawEnd = trimEnd > 0 ? trimEnd : clipDuration
  const effectiveEnd = Math.min(rawEnd, trimStart + maxClipDuration)
  return Math.max(0, effectiveEnd - trimStart)
}

function ClipCard({
  clip,
  selectedClip,
  onToggle,
  onTrimChange,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  maxClipDuration,
}: {
  clip: ClipSearchResult
  selectedClip: SelectedClip | null
  onToggle: () => void
  onTrimChange: (trimStart: number, trimEnd: number) => void
  onMoveUp: () => void
  onMoveDown: () => void
  isFirst: boolean
  isLast: boolean
  maxClipDuration: number
}) {
  const [playing, setPlaying] = useState(false)
  const [showTrimPreviewHint, setShowTrimPreviewHint] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const isSelected = selectedClip !== null

  const trimStart = selectedClip?.trim_start ?? 0
  const trimEnd = selectedClip?.trim_end ?? 0
  const rawEnd = trimEnd > 0 ? trimEnd : clip.duration
  const effectiveEnd = Math.min(rawEnd, trimStart + maxClipDuration)
  const trimmedDuration = effectiveEnd - trimStart

  useEffect(() => {
    const video = videoRef.current
    if (!video || !playing) return
    const nextTime = Math.min(trimStart, Math.max(0, clip.duration - 0.1))
    if (Math.abs(video.currentTime - nextTime) > 0.15) {
      video.currentTime = nextTime
    }
  }, [clip.duration, playing, trimStart])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !playing) return

    const timer = window.setInterval(() => {
      if (video.currentTime >= Math.max(trimStart, effectiveEnd - 0.05)) {
        video.currentTime = trimStart
        if (video.paused) {
          video.play().catch(() => {})
        }
      }
    }, 100)

    setShowTrimPreviewHint(true)
    return () => {
      window.clearInterval(timer)
      setShowTrimPreviewHint(false)
    }
  }, [playing, trimStart, effectiveEnd])

  function handleCardClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('input, button')) return
    if (playing) {
      videoRef.current?.pause()
      setPlaying(false)
    } else {
      if (videoRef.current) {
        videoRef.current.currentTime = trimStart
        videoRef.current.play().catch(() => {})
      }
      setPlaying(true)
    }
  }

  return (
    <div
      className={`relative rounded-xl overflow-hidden border transition-all ${
        isSelected
          ? 'border-brand-500 ring-1 ring-brand-500/40'
          : 'border-stone-700 opacity-60'
      }`}
    >
      <div
        className="relative aspect-[9/16] bg-stone-900 cursor-pointer"
        onClick={handleCardClick}
      >
        <img
          src={clip.thumbnail}
          alt=""
          className={`absolute inset-0 h-full w-full object-cover transition-opacity ${playing ? 'opacity-0' : 'opacity-100'}`}
        />
        <video
          ref={videoRef}
          src={clip.preview_url}
          muted
          playsInline
          className={`absolute inset-0 h-full w-full object-cover transition-opacity ${playing ? 'opacity-100' : 'opacity-0'}`}
          onEnded={() => setPlaying(false)}
          onError={() => setPlaying(false)}
          onLoadedMetadata={() => {
            if (!videoRef.current) return
            videoRef.current.currentTime = trimStart
          }}
        />

        {!playing && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50">
              <svg className="ml-0.5 h-4 w-4 text-white" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5 3l9 5-9 5V3z" />
              </svg>
            </div>
          </div>
        )}

        <div className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-mono text-white">
          {formatDuration(clip.duration)}
        </div>

        <button
          onClick={e => { e.stopPropagation(); onToggle() }}
          className={`absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded border-2 transition ${
            isSelected
              ? 'border-brand-500 bg-brand-500'
              : 'border-stone-400 bg-black/40 hover:border-white'
          }`}
        >
          {isSelected && (
            <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 6l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        {isSelected && (
          <div className="absolute right-1.5 top-1.5 flex flex-col gap-0.5">
            <button
              onClick={e => { e.stopPropagation(); onMoveUp() }}
              disabled={isFirst}
              className="flex h-5 w-5 items-center justify-center rounded bg-black/50 text-white transition hover:bg-black/70 disabled:opacity-30"
              title="Move up"
            >
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 8l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              onClick={e => { e.stopPropagation(); onMoveDown() }}
              disabled={isLast}
              className="flex h-5 w-5 items-center justify-center rounded bg-black/50 text-white transition hover:bg-black/70 disabled:opacity-30"
              title="Move down"
            >
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 4l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {isSelected && (
        <div className="space-y-2 bg-stone-900 px-3 py-2.5">
          <div className="flex flex-col gap-1 text-[10px] text-stone-400 sm:flex-row sm:items-center sm:justify-between">
            <span>Trim</span>
            <span className="font-mono text-stone-300">
              {trimStart.toFixed(1)}s - {effectiveEnd.toFixed(1)}s
              <span className="ml-1 text-stone-600">({trimmedDuration.toFixed(1)}s)</span>
            </span>
          </div>
          <div className="space-y-1">
            <div className="grid grid-cols-[24px,minmax(0,1fr)] items-center gap-2">
              <span className="text-[9px] text-stone-600 text-right">in</span>
              <input
                type="range"
                min={0}
                max={clip.duration}
                step={0.1}
                value={trimStart}
                onChange={e => {
                  const val = parseFloat(e.target.value)
                  onTrimChange(Math.min(val, effectiveEnd - 0.5), trimEnd)
                }}
                className="h-1 w-full min-w-0 accent-brand-500"
              />
            </div>
            <div className="grid grid-cols-[24px,minmax(0,1fr)] items-center gap-2">
              <span className="text-[9px] text-stone-600 text-right">out</span>
              <input
                type="range"
                min={0}
                max={clip.duration}
                step={0.1}
                value={rawEnd}
                onChange={e => {
                  const val = parseFloat(e.target.value)
                  const isFullLength = Math.abs(val - clip.duration) < 0.05
                  onTrimChange(trimStart, isFullLength ? 0 : Math.max(val, trimStart + 0.5))
                }}
                className="h-1 w-full min-w-0 accent-brand-500"
              />
            </div>
            {trimmedDuration < (rawEnd - trimStart) - 0.05 && (
              <p className="text-[9px] text-right text-amber-500/80">
                capped at {maxClipDuration}s max
              </p>
            )}
            {playing && showTrimPreviewHint && (
              <p className="text-[9px] text-right text-brand-300/80">
                Preview loops the trimmed section
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ClipPreviewGrid({
  clips,
  selected,
  onSelectionChange,
  onGenerate,
  generating,
  maxClipDuration = 15,
  maxTotalDuration = 60,
  onLoadMore,
  hasMoreOptions = false,
  loadingMore = false,
}: Props) {
  const [page, setPage] = useState(1)
  const [limitMessage, setLimitMessage] = useState<string | null>(null)
  const selectedMap = new Map(selected.map(s => [s.id, s]))
  const PAGE_SIZE = 8
  const totalSecs = selected.reduce((sum, s) => {
    const clip = clips.find(c => c.id === s.id)
    if (!clip) return sum
    return sum + getEffectiveClipDuration(clip.duration, s.trim_start, s.trim_end, maxClipDuration)
  }, 0)

  useEffect(() => {
    setPage(1)
  }, [clips])

  useEffect(() => {
    if (limitMessage?.startsWith('Selected up to') && totalSecs < maxTotalDuration - 0.01) {
      setLimitMessage(null)
    }
  }, [limitMessage, maxTotalDuration, totalSecs])

  function toggleClip(clip: ClipSearchResult) {
    if (selectedMap.has(clip.id)) {
      onSelectionChange(selected.filter(s => s.id !== clip.id))
    } else {
      const newClip: SelectedClip = {
        id: clip.id,
        download_url: clip.download_url,
        preview_url: clip.preview_url,
        thumbnail: clip.thumbnail,
        duration: clip.duration,
        trim_start: 0,
        trim_end: 0,
      }
      const nextTotal = totalSecs + getEffectiveClipDuration(clip.duration, 0, 0, maxClipDuration)
      if (nextTotal > maxTotalDuration + 0.01) {
        setLimitMessage(`Keep the total selected duration at ${formatDuration(maxTotalDuration)} or less.`)
        return
      }
      const ordered = clips
        .filter(c => selectedMap.has(c.id) || c.id === clip.id)
        .map(c => (c.id === clip.id ? newClip : selectedMap.get(c.id)!))
      onSelectionChange(ordered)
    }
  }

  function updateTrim(id: string, trimStart: number, trimEnd: number) {
    const next = selected.map(s => (
      s.id === id ? { ...s, trim_start: trimStart, trim_end: trimEnd } : s
    ))
    const nextTotal = next.reduce((sum, s) => {
      const clip = clips.find(c => c.id === s.id)
      if (!clip) return sum
      return sum + getEffectiveClipDuration(clip.duration, s.trim_start, s.trim_end, maxClipDuration)
    }, 0)
    if (nextTotal > maxTotalDuration + 0.01) {
      setLimitMessage(`Trim clips so the total stays within ${formatDuration(maxTotalDuration)}.`)
      return
    }
    onSelectionChange(next)
  }

  function moveClip(id: string, direction: 'up' | 'down') {
    const idx = selected.findIndex(s => s.id === id)
    if (idx < 0) return
    const next = [...selected]
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= next.length) return
    ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    onSelectionChange(next)
  }

  function selectAll() {
    let runningTotal = 0
    const ordered = clips.flatMap(c => {
      const existing = selectedMap.get(c.id) ?? {
        id: c.id,
        download_url: c.download_url,
        preview_url: c.preview_url,
        thumbnail: c.thumbnail,
        duration: c.duration,
        trim_start: 0,
        trim_end: 0,
      }
      const clipDuration = getEffectiveClipDuration(c.duration, existing.trim_start, existing.trim_end, maxClipDuration)
      if (runningTotal + clipDuration > maxTotalDuration + 0.01) return []
      runningTotal += clipDuration
      return [existing]
    })
    setLimitMessage(ordered.length < clips.length ? `Selected up to the ${formatDuration(maxTotalDuration)} cap.` : null)
    onSelectionChange(ordered)
  }

  function deselectAll() {
    setLimitMessage(null)
    onSelectionChange([])
  }

  const allSelected = clips.length > 0 && clips.every(c => selectedMap.has(c.id))
  const selectedCount = selected.length
  const totalPages = Math.max(1, Math.ceil(clips.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedClips = clips.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-stone-400">
          {clips.length} clip{clips.length !== 1 ? 's' : ''} found
        </p>
        <div className="flex items-center gap-3">
          {totalPages > 1 && (
            <div className="flex items-center gap-1.5 text-xs text-stone-500">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="rounded border border-stone-700 px-2 py-1 transition hover:border-stone-500 hover:text-stone-200 disabled:opacity-40"
              >
                Prev
              </button>
              <span>{safePage} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="rounded border border-stone-700 px-2 py-1 transition hover:border-stone-500 hover:text-stone-200 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
          <button
            onClick={allSelected ? deselectAll : selectAll}
            className="text-xs text-stone-400 transition hover:text-stone-200"
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {pagedClips.map((clip) => {
          const selClip = selectedMap.get(clip.id) ?? null
          const selIdx = selected.findIndex(s => s.id === clip.id)
          return (
            <ClipCard
              key={clip.id}
              clip={clip}
              selectedClip={selClip}
              onToggle={() => toggleClip(clip)}
              onTrimChange={(start, end) => updateTrim(clip.id, start, end)}
              onMoveUp={() => moveClip(clip.id, 'up')}
              onMoveDown={() => moveClip(clip.id, 'down')}
              isFirst={selIdx === 0}
              isLast={selIdx === selected.length - 1}
              maxClipDuration={maxClipDuration}
            />
          )
        })}
      </div>

      {hasMoreOptions && (
        <div className="flex justify-center">
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="rounded-lg border border-stone-700 px-4 py-2 text-xs font-medium text-stone-300 transition hover:border-stone-500 hover:text-stone-100 disabled:opacity-40"
          >
            {loadingMore ? 'Loading more...' : 'Load more options'}
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-stone-800 pt-2">
        <div>
          <p className="text-xs text-stone-500">
            {selectedCount > 0
              ? `${selectedCount} clip${selectedCount !== 1 ? 's' : ''} selected`
              : 'No clips selected'}
          </p>
          {selectedCount > 0 && (
            <p className="mt-0.5 text-[10px] text-stone-600">
              Est. ~{totalSecs.toFixed(0)}s total · {Math.max(0, maxTotalDuration - totalSecs).toFixed(0)}s remaining
            </p>
          )}
          {limitMessage && (
            <p className="mt-0.5 text-[10px] text-amber-500/80">
              {limitMessage}
            </p>
          )}
        </div>
        <button
          onClick={() => onGenerate(selected)}
          disabled={selectedCount === 0 || generating}
          className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-40"
        >
          {generating ? 'Generating...' : `Generate with ${selectedCount} clip${selectedCount !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  )
}
