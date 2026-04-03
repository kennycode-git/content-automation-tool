/**
 * LayeredPanel.tsx
 *
 * UI panel for the Layered rendering mode:
 *   - Background Pexels video search + multi-select grid (up to 5)
 *   - Foreground opacity control with suggestion pills
 *   - Foreground image speed slider
 *   - Grade target toggle (foreground / background / both)
 */

import { useState } from 'react'
import { searchBgVideos } from '../lib/api'
import type { BgVideoResult } from '../lib/api'

export interface LayeredPanelConfig {
  bgVideoUrls: string[]
  opacity: number
  gradeTarget: 'foreground' | 'background' | 'both'
  crossfadeDuration: number
}

export const DEFAULT_LAYERED_CONFIG: LayeredPanelConfig = {
  bgVideoUrls: [],
  opacity: 0.55,
  gradeTarget: 'both',
  crossfadeDuration: 0.5,
}

export const OPACITY_PRESETS = [
  { label: 'Subtle',    value: 0.30 },
  { label: 'Medium',    value: 0.55 },
  { label: 'Cinematic', value: 0.70 },
  { label: 'Heavy',     value: 0.85 },
]

interface Props {
  config: LayeredPanelConfig
  onChange: (c: LayeredPanelConfig) => void
}

export default function LayeredPanel({ config, onChange }: Props) {
  const [query, setQuery]           = useState('')
  const [results, setResults]       = useState<BgVideoResult[]>([])
  const [searching, setSearching]   = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [hoveredId, setHoveredId]   = useState<string | null>(null)

  async function handleSearch() {
    const q = query.trim()
    if (!q) return
    setSearchError(null)
    setSearching(true)
    try {
      const res = await searchBgVideos(q, 9)
      setResults(res.items)
      if (res.items.length === 0) setSearchError('No videos found. Try a different search term.')
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  function toggleVideo(url: string) {
    const selected = config.bgVideoUrls
    if (selected.includes(url)) {
      onChange({ ...config, bgVideoUrls: selected.filter(u => u !== url) })
    } else if (selected.length < 5) {
      onChange({ ...config, bgVideoUrls: [...selected, url] })
    }
  }

  return (
    <div className="space-y-5">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-stone-200">Background Videos</span>
        <span className="rounded bg-brand-500/20 px-1.5 py-0.5 text-[9px] font-bold text-brand-400 tracking-wider">★ NEW</span>
        <span className="text-xs text-stone-500 ml-auto">{config.bgVideoUrls.length}/5 selected</span>
      </div>

      <p className="text-xs text-stone-500 -mt-3">
        Your foreground images float over a looping Pexels video background.
        Select 1–5 videos — multiple videos crossfade together.
      </p>

      {/* Search bar */}
      <div className="flex gap-2" data-tour="layered-bg-search">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder='Search background videos, e.g. "nature", "city"…'
          className="flex-1 rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-200 placeholder-stone-500 focus:border-brand-500 focus:outline-none"
        />
        <button
          onClick={handleSearch}
          disabled={searching || !query.trim()}
          className="rounded-lg bg-stone-700 px-4 py-2 text-sm font-medium text-stone-200 hover:bg-stone-600 disabled:opacity-50 transition shrink-0"
        >
          {searching ? '…' : 'Search'}
        </button>
      </div>

      {searchError && <p className="text-xs text-red-400">{searchError}</p>}

      {/* Video results grid */}
      {results.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {results.map(v => {
            const isSelected = config.bgVideoUrls.includes(v.download_url)
            const isHovered  = hoveredId === v.id
            const maxReached = config.bgVideoUrls.length >= 5 && !isSelected
            return (
              <button
                key={v.id}
                onClick={() => toggleVideo(v.download_url)}
                onMouseEnter={() => setHoveredId(v.id)}
                onMouseLeave={() => setHoveredId(null)}
                disabled={maxReached}
                title={maxReached ? 'Maximum 5 videos selected' : undefined}
                className={`relative rounded-lg overflow-hidden aspect-[9/16] border-2 transition ${
                  isSelected
                    ? 'border-brand-500'
                    : maxReached
                      ? 'border-stone-800 opacity-40 cursor-not-allowed'
                      : 'border-stone-700 hover:border-stone-500'
                }`}
              >
                {isHovered && !maxReached ? (
                  <video
                    src={v.preview_url}
                    autoPlay muted loop playsInline
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <img
                    src={v.thumbnail}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}
                {isSelected && (
                  <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center shadow-md">
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pointer-events-none">
                  <span className="text-[9px] text-white/80">{v.duration}s</span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {results.length === 0 && !searching && !searchError && (
        <div className="rounded-lg border border-dashed border-stone-700 bg-stone-800/40 py-6 text-center">
          <p className="text-xs text-stone-500">Search for a background video to get started</p>
          <p className="text-[10px] text-stone-600 mt-1">Tip: try "abstract", "nature", "rain", "ocean"</p>
        </div>
      )}

      {config.bgVideoUrls.length > 0 && (
        <p className="text-[10px] text-stone-500">
          {config.bgVideoUrls.length === 1
            ? '1 video selected — will loop to fill duration.'
            : `${config.bgVideoUrls.length} videos selected — will crossfade between them.`}
        </p>
      )}

      <hr className="border-stone-800" />

      {/* Grade target */}
      <div data-tour="layered-grade-target">
        <span className="text-xs font-medium text-stone-300 block mb-2">Apply colour grade to</span>
        <div className="grid grid-cols-3 gap-1.5">
          {(['foreground', 'background', 'both'] as const).map(t => (
            <button
              key={t}
              onClick={() => onChange({ ...config, gradeTarget: t })}
              className={`rounded-lg py-2 text-xs font-medium transition capitalize ${
                config.gradeTarget === t
                  ? 'bg-brand-500/20 border border-brand-500/50 text-brand-300'
                  : 'bg-stone-800 border border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-stone-600 mt-1.5">
          {config.gradeTarget === 'foreground' && 'Images are graded; background video stays natural.'}
          {config.gradeTarget === 'background' && 'Background video is graded; foreground images stay natural.'}
          {config.gradeTarget === 'both'       && 'Both foreground images and background video are graded.'}
        </p>
      </div>
    </div>
  )
}
