/**
 * ClipPreviewGrid.tsx
 *
 * Clip picker UI for Video Clips mode.
 * Displays fetched Pexels clips as cards: thumbnail, play-on-click preview,
 * checkbox selection, per-clip trim controls, and up/down reorder buttons.
 */

import { useRef, useState } from 'react'
import type { ClipSearchResult, SelectedClip } from '../lib/api'

interface Props {
  clips: ClipSearchResult[]
  selected: SelectedClip[]
  onSelectionChange: (clips: SelectedClip[]) => void
  onGenerate: (clips: SelectedClip[]) => void
  generating?: boolean
}

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`
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
}: {
  clip: ClipSearchResult
  selectedClip: SelectedClip | null
  onToggle: () => void
  onTrimChange: (trimStart: number, trimEnd: number) => void
  onMoveUp: () => void
  onMoveDown: () => void
  isFirst: boolean
  isLast: boolean
}) {
  const [playing, setPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const isSelected = selectedClip !== null

  const trimStart = selectedClip?.trim_start ?? 0
  const trimEnd = selectedClip?.trim_end ?? 0
  const effectiveEnd = trimEnd > 0 ? trimEnd : clip.duration
  const trimmedDuration = effectiveEnd - trimStart

  function handleCardClick(e: React.MouseEvent) {
    // Don't toggle if clicking controls
    if ((e.target as HTMLElement).closest('input, button')) return
    if (playing) {
      videoRef.current?.pause()
      setPlaying(false)
    } else {
      videoRef.current?.play()
      setPlaying(true)
    }
  }

  return (
    <div
      className={`relative rounded-xl overflow-hidden border transition-all
        ${isSelected
          ? 'border-brand-500 ring-1 ring-brand-500/40'
          : 'border-stone-700 opacity-60'}`}
    >
      {/* Thumbnail / video */}
      <div
        className="relative aspect-[9/16] bg-stone-900 cursor-pointer"
        onClick={handleCardClick}
      >
        <img
          src={clip.thumbnail}
          alt=""
          className={`absolute inset-0 w-full h-full object-cover transition-opacity ${playing ? 'opacity-0' : 'opacity-100'}`}
        />
        <video
          ref={videoRef}
          src={clip.preview_url}
          muted
          loop
          playsInline
          className={`absolute inset-0 w-full h-full object-cover transition-opacity ${playing ? 'opacity-100' : 'opacity-0'}`}
          onEnded={() => setPlaying(false)}
        />

        {/* Play indicator */}
        {!playing && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
              <svg className="w-4 h-4 text-white ml-0.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5 3l9 5-9 5V3z" />
              </svg>
            </div>
          </div>
        )}

        {/* Duration badge */}
        <div className="absolute bottom-1.5 right-1.5 bg-black/70 rounded px-1.5 py-0.5 text-[10px] text-white font-mono">
          {formatDuration(clip.duration)}
        </div>

        {/* Checkbox */}
        <button
          onClick={e => { e.stopPropagation(); onToggle() }}
          className={`absolute top-1.5 left-1.5 w-5 h-5 rounded border-2 flex items-center justify-center transition
            ${isSelected
              ? 'bg-brand-500 border-brand-500'
              : 'bg-black/40 border-stone-400 hover:border-white'}`}
        >
          {isSelected && (
            <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 6l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        {/* Reorder buttons */}
        {isSelected && (
          <div className="absolute top-1.5 right-1.5 flex flex-col gap-0.5">
            <button
              onClick={e => { e.stopPropagation(); onMoveUp() }}
              disabled={isFirst}
              className="w-5 h-5 rounded bg-black/50 flex items-center justify-center text-white disabled:opacity-30 hover:bg-black/70 transition"
              title="Move up"
            >
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 8l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              onClick={e => { e.stopPropagation(); onMoveDown() }}
              disabled={isLast}
              className="w-5 h-5 rounded bg-black/50 flex items-center justify-center text-white disabled:opacity-30 hover:bg-black/70 transition"
              title="Move down"
            >
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 4l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Trim controls — only when selected */}
      {isSelected && (
        <div className="bg-stone-900 px-2.5 py-2 space-y-2">
          <div className="flex items-center justify-between text-[10px] text-stone-400">
            <span>Trim</span>
            <span className="text-stone-300 font-mono">
              {trimStart.toFixed(1)}s – {effectiveEnd.toFixed(1)}s
              <span className="text-stone-600 ml-1">({trimmedDuration.toFixed(1)}s)</span>
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-stone-600 w-5 text-right">in</span>
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
                className="flex-1 accent-brand-500 h-1"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-stone-600 w-5 text-right">out</span>
              <input
                type="range"
                min={0}
                max={clip.duration}
                step={0.1}
                value={trimEnd > 0 ? trimEnd : clip.duration}
                onChange={e => {
                  const val = parseFloat(e.target.value)
                  const isFullLength = Math.abs(val - clip.duration) < 0.05
                  onTrimChange(trimStart, isFullLength ? 0 : Math.max(val, trimStart + 0.5))
                }}
                className="flex-1 accent-brand-500 h-1"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ClipPreviewGrid({ clips, selected, onSelectionChange, onGenerate, generating }: Props) {
  // Build a map from id → SelectedClip for quick lookup
  const selectedMap = new Map(selected.map(s => [s.id, s]))

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
      // Insert in original clip order
      const ordered = clips
        .filter(c => selectedMap.has(c.id) || c.id === clip.id)
        .map(c => (c.id === clip.id ? newClip : selectedMap.get(c.id)!))
      onSelectionChange(ordered)
    }
  }

  function updateTrim(id: string, trimStart: number, trimEnd: number) {
    onSelectionChange(selected.map(s => s.id === id ? { ...s, trim_start: trimStart, trim_end: trimEnd } : s))
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
    const ordered = clips.map(c => selectedMap.get(c.id) ?? {
      id: c.id,
      download_url: c.download_url,
      preview_url: c.preview_url,
      thumbnail: c.thumbnail,
      duration: c.duration,
      trim_start: 0,
      trim_end: 0,
    })
    onSelectionChange(ordered)
  }

  function deselectAll() {
    onSelectionChange([])
  }

  const allSelected = clips.length > 0 && clips.every(c => selectedMap.has(c.id))
  const selectedCount = selected.length

  // For the card list, use the selected order for selected clips + unselected clips at end
  const orderedClips = [
    ...selected.map(s => clips.find(c => c.id === s.id)!).filter(Boolean),
    ...clips.filter(c => !selectedMap.has(c.id)),
  ]

  return (
    <div className="space-y-3">
      {/* Header controls */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-stone-400">
          {clips.length} clip{clips.length !== 1 ? 's' : ''} found
        </p>
        <button
          onClick={allSelected ? deselectAll : selectAll}
          className="text-xs text-stone-400 hover:text-stone-200 transition"
        >
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
      </div>

      {/* Clip grid */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4">
        {orderedClips.map((clip) => {
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
            />
          )
        })}
      </div>

      {/* Generate footer */}
      <div className="pt-2 border-t border-stone-800 flex items-center justify-between gap-3">
        <p className="text-xs text-stone-500">
          {selectedCount > 0
            ? `${selectedCount} clip${selectedCount !== 1 ? 's' : ''} selected`
            : 'No clips selected'}
        </p>
        <button
          onClick={() => onGenerate(selected)}
          disabled={selectedCount === 0 || generating}
          className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-40 transition"
        >
          {generating ? 'Generating…' : `Generate with ${selectedCount} clip${selectedCount !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  )
}
