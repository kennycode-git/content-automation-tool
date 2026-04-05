import { useEffect, useState } from 'react'
import { searchBgVideos } from '../lib/api'
import type { BgVideoResult } from '../lib/api'

const FAVORITES_KEY = 'cogito_bg_video_favorites'

interface Props {
  selectedUrls: string[]
  onChange: (urls: string[]) => void
  compact?: boolean
  initialQuery?: string
  dataTourRoot?: string
  dataTourSearch?: string
  dataTourFavorites?: string
}

export default function BackgroundVideoPicker({
  selectedUrls,
  onChange,
  compact = false,
  initialQuery,
  dataTourRoot,
  dataTourSearch,
  dataTourFavorites,
}: Props) {
  const [query, setQuery] = useState(initialQuery ?? '')
  const [results, setResults] = useState<BgVideoResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [showFavorites, setShowFavorites] = useState(false)
  const [favorites, setFavorites] = useState<BgVideoResult[]>(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY)
      return raw ? JSON.parse(raw) as BgVideoResult[] : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites))
    } catch {
      // ignore localStorage issues
    }
  }, [favorites])

  useEffect(() => {
    if (initialQuery === undefined) return
    setQuery(initialQuery)
  }, [initialQuery])

  async function runSearch(nextPage: number, queryOverride?: string) {
    const q = (queryOverride ?? query).trim()
    if (!q) return
    setSearchError(null)
    setSearching(true)
    try {
      const res = await searchBgVideos(q, 9, nextPage)
      setResults(res.items)
      setPage(res.page)
      setHasMore(res.has_more)
      if (res.items.length === 0) setSearchError('No videos found. Try a different search term.')
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  async function handleSearch() {
    await runSearch(1)
  }

  useEffect(() => {
    if (!initialQuery?.trim()) return
    void runSearch(1, initialQuery)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery])

  function toggleVideo(url: string) {
    if (selectedUrls.includes(url)) {
      onChange(selectedUrls.filter(u => u !== url))
    } else if (selectedUrls.length < 5) {
      onChange([...selectedUrls, url])
    }
  }

  function isFavorite(video: BgVideoResult) {
    return favorites.some(f => f.id === video.id || f.download_url === video.download_url)
  }

  function toggleFavorite(video: BgVideoResult) {
    setFavorites(prev => {
      const exists = prev.some(f => f.id === video.id || f.download_url === video.download_url)
      if (exists) return prev.filter(f => f.id !== video.id && f.download_url !== video.download_url)
      return [video, ...prev].slice(0, 30)
    })
  }

  return (
    <div
      data-tour={dataTourRoot}
      className={compact ? 'mt-3 rounded-lg border border-stone-700 bg-stone-900/70 p-3' : 'space-y-5'}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setCollapsed(v => !v)}
          className="flex items-center gap-1.5 text-left"
          title={collapsed ? 'Expand background video picker' : 'Collapse background video picker'}
        >
          <svg
            className={`h-3 w-3 text-stone-500 transition-transform ${collapsed ? '-rotate-90' : 'rotate-0'}`}
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M3.5 5.5 8 10.5l4.5-5z" />
          </svg>
          <span className={`${compact ? 'text-xs font-semibold' : 'text-sm font-bold'} text-stone-200`}>Background videos</span>
        </button>
        <span className="text-xs text-stone-500 sm:ml-auto">{selectedUrls.length}/5 selected</span>
        {selectedUrls.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[11px] text-stone-500 hover:text-stone-300 transition"
          >
            Clear
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          <p className={`${compact ? 'text-[11px]' : 'text-xs'} text-stone-500 ${compact ? 'mt-1' : '-mt-3'}`}>
            Select 1-5 looping background videos for this batch.
          </p>

          <div data-tour={dataTourSearch} className={`flex flex-col gap-2 sm:flex-row ${compact ? 'mt-2' : ''}`}>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder='Search background videos, e.g. "nature", "city"...'
              className="min-w-0 flex-1 rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-200 placeholder-stone-500 focus:border-brand-500 focus:outline-none"
            />
            <button
              onClick={handleSearch}
              disabled={searching || !query.trim()}
              className="rounded-lg bg-stone-700 px-4 py-2 text-sm font-medium text-stone-200 hover:bg-stone-600 disabled:opacity-50 transition sm:shrink-0"
            >
              {searching ? '...' : 'Search'}
            </button>
          </div>
          <div data-tour={dataTourFavorites} className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFavorites(v => !v)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition ${
                showFavorites
                  ? 'border-amber-500/70 bg-amber-500/10 text-amber-300'
                  : 'border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200'
              }`}
            >
              <span aria-hidden="true">★</span>
              <span>Favourites</span>
              <span className="text-stone-500">({favorites.length})</span>
            </button>
          </div>
        </>
      )}

      {searchError && <p className="text-xs text-red-400 mt-2">{searchError}</p>}

      {!collapsed && showFavorites && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-stone-400">Saved favourites</p>
            {favorites.length > 0 && (
              <button
                type="button"
                onClick={() => setFavorites([])}
                className="text-[11px] text-stone-500 hover:text-red-400 transition"
              >
                Clear favourites
              </button>
            )}
          </div>
          {favorites.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {favorites.map(v => {
                const isSelected = selectedUrls.includes(v.download_url)
                const isHovered = hoveredId === `fav:${v.id}`
                const maxReached = selectedUrls.length >= 5 && !isSelected
                return (
                  <button
                    key={`fav:${v.id}`}
                    onClick={() => toggleVideo(v.download_url)}
                    onMouseEnter={() => setHoveredId(`fav:${v.id}`)}
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
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={e => {
                        e.stopPropagation()
                        toggleFavorite(v)
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          toggleFavorite(v)
                        }
                      }}
                      className="absolute left-1.5 top-1.5 z-10 rounded-full bg-black/55 px-1.5 py-1 text-[10px] text-amber-300 hover:bg-black/75"
                      title="Remove from favourites"
                    >
                      ★
                    </span>
                    {isHovered && !maxReached ? (
                      <video
                        src={v.preview_url}
                        autoPlay
                        muted
                        loop
                        playsInline
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <img
                        src={v.thumbnail}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
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
          ) : (
            <div className="rounded-lg border border-dashed border-stone-700 bg-stone-800/40 py-4 text-center">
              <p className="text-xs text-stone-500">Star a video result to save it here for quick reuse.</p>
            </div>
          )}
        </div>
      )}

      {!collapsed && results.length > 0 && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => {
                      e.stopPropagation()
                      toggleFavorite(v)
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        e.stopPropagation()
                        toggleFavorite(v)
                      }
                    }}
                    className={`absolute left-1.5 top-1.5 z-10 rounded-full bg-black/55 px-1.5 py-1 text-[10px] transition hover:bg-black/75 ${
                      isFavorite(v) ? 'text-amber-300' : 'text-stone-300'
                    }`}
                    title={isFavorite(v) ? 'Remove from favourites' : 'Save to favourites'}
                  >
                    ★
                  </span>
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

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              onClick={() => runSearch(page - 1)}
              disabled={searching || page <= 1}
              className="rounded-lg border border-stone-700 px-3 py-1.5 text-xs text-stone-400 hover:border-stone-500 hover:text-stone-200 disabled:opacity-40 transition"
            >
              Prev
            </button>
            <div className="flex flex-wrap items-center gap-1.5">
              {Array.from({ length: 5 }, (_, i) => i + 1).map(pageNum => (
                <button
                  key={pageNum}
                  onClick={() => runSearch(pageNum)}
                  disabled={searching}
                  className={`rounded-md px-2.5 py-1 text-xs transition ${
                    pageNum === page
                      ? 'bg-brand-500 text-white'
                      : 'border border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200'
                  }`}
                >
                  {pageNum}
                </button>
              ))}
            </div>
            <button
              onClick={() => runSearch(page + 1)}
              disabled={searching || !hasMore}
              className="rounded-lg border border-stone-700 px-3 py-1.5 text-xs text-stone-400 hover:border-stone-500 hover:text-stone-200 disabled:opacity-40 transition"
            >
              Next
            </button>
          </div>
        </>
      )}

      {!collapsed && results.length === 0 && !searching && !searchError && (
        <div className="rounded-lg border border-dashed border-stone-700 bg-stone-800/40 py-4 text-center mt-3">
          <p className="text-xs text-stone-500">Search for a background video to get started</p>
        </div>
      )}

      {selectedUrls.length > 0 && (
        <p className="text-[10px] text-stone-500 mt-2">
          {collapsed
            ? `${selectedUrls.length} video${selectedUrls.length === 1 ? '' : 's'} selected. Expand to change them.`
            : selectedUrls.length === 1
              ? '1 video selected - will loop to fill duration.'
              : `${selectedUrls.length} videos selected - will crossfade between them.`}
        </p>
      )}
    </div>
  )
}
