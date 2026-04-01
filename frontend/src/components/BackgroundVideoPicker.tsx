import { useState } from 'react'
import { searchBgVideos } from '../lib/api'
import type { BgVideoResult } from '../lib/api'

interface Props {
  selectedUrls: string[]
  onChange: (urls: string[]) => void
  compact?: boolean
}

export default function BackgroundVideoPicker({ selectedUrls, onChange, compact = false }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BgVideoResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  async function handleSearch() {
    const q = query.trim()
    if (!q) return
    setSearchError(null)
    setSearching(true)
    try {
      const res = await searchBgVideos(q, 9)
      setResults(res)
      if (res.length === 0) setSearchError('No videos found. Try a different search term.')
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  function toggleVideo(url: string) {
    if (selectedUrls.includes(url)) {
      onChange(selectedUrls.filter(u => u !== url))
    } else if (selectedUrls.length < 5) {
      onChange([...selectedUrls, url])
    }
  }

  return (
    <div className={compact ? 'mt-3 rounded-lg border border-stone-700 bg-stone-900/70 p-3' : 'space-y-5'}>
      <div className="flex items-center gap-2">
        <span className={`${compact ? 'text-xs font-semibold' : 'text-sm font-bold'} text-stone-200`}>Background videos</span>
        <span className="text-xs text-stone-500 ml-auto">{selectedUrls.length}/5 selected</span>
      </div>

      <p className={`${compact ? 'text-[11px]' : 'text-xs'} text-stone-500 ${compact ? 'mt-1' : '-mt-3'}`}>
        Select 1-5 looping background videos for this batch.
      </p>

      <div className={`flex gap-2 ${compact ? 'mt-2' : ''}`}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder='Search background videos, e.g. "nature", "city"...'
          className="flex-1 rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-200 placeholder-stone-500 focus:border-brand-500 focus:outline-none"
        />
        <button
          onClick={handleSearch}
          disabled={searching || !query.trim()}
          className="rounded-lg bg-stone-700 px-4 py-2 text-sm font-medium text-stone-200 hover:bg-stone-600 disabled:opacity-50 transition shrink-0"
        >
          {searching ? '...' : 'Search'}
        </button>
      </div>

      {searchError && <p className="text-xs text-red-400 mt-2">{searchError}</p>}

      {results.length > 0 && (
        <div className={`grid gap-2 mt-3 ${compact ? 'grid-cols-3' : 'grid-cols-3'}`}>
          {results.map(v => {
            const isSelected = selectedUrls.includes(v.download_url)
            const isHovered = hoveredId === v.id
            const maxReached = selectedUrls.length >= 5 && !isSelected
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
                    autoPlay
                    muted
                    loop
                    playsInline
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
        <div className="rounded-lg border border-dashed border-stone-700 bg-stone-800/40 py-4 text-center mt-3">
          <p className="text-xs text-stone-500">Search for a background video to get started</p>
        </div>
      )}

      {selectedUrls.length > 0 && (
        <p className="text-[10px] text-stone-500 mt-2">
          {selectedUrls.length === 1
            ? '1 video selected - will loop to fill duration.'
            : `${selectedUrls.length} videos selected - will crossfade between them.`}
        </p>
      )}
    </div>
  )
}
