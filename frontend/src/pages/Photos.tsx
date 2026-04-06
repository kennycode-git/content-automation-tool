/**
 * Photos.tsx
 *
 * Photo extraction tool: search Pexels, apply colour grade,
 * preview a grid of images, then download individually or all at once.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { stagePreview } from '../lib/api'
import type { PreviewImageItem } from '../lib/api'
import AppNavbar from '../components/AppNavbar'
import TermBundles from '../components/TermBundles'
import PromptModal from '../components/PromptModal'

interface Props {
  session: Session
}

// Module-level cache — persists state across navigation within the same session
interface PhotosState {
  searchText: string
  imageCount: number
  resolution: string
  colorTheme: string
  images: PreviewImageItem[]
  savedPaths: string[]
}
let _cache: PhotosState | null = null

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

const RESOLUTIONS = [
  { value: '1080x1920', label: '1080×1920 (Portrait)' },
  { value: '1920x1080', label: '1920×1080 (Landscape)' },
  { value: '1080x1080', label: '1080×1080 (Square)' },
]

export default function Photos({ session }: Props) {
  const [searchText, setSearchText] = useState(() => _cache?.searchText ?? '')
  const [imageCount, setImageCount] = useState(() => _cache?.imageCount ?? 30)
  const [resolution, setResolution] = useState(() => _cache?.resolution ?? '1080x1920')
  const [colorTheme, setColorTheme] = useState(() => _cache?.colorTheme ?? 'none')
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [images, setImages] = useState<PreviewImageItem[]>(() => _cache?.images ?? [])
  const [savedPaths, setSavedPaths] = useState<Set<string>>(() => new Set(_cache?.savedPaths ?? []))
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  // Keep a ref that always mirrors current state, then flush to cache on unmount
  const stateRef = useRef({ searchText, imageCount, resolution, colorTheme, images, savedPaths })
  stateRef.current = { searchText, imageCount, resolution, colorTheme, images, savedPaths }

  useEffect(() => {
    return () => {
      const s = stateRef.current
      _cache = { searchText: s.searchText, imageCount: s.imageCount, resolution: s.resolution, colorTheme: s.colorTheme, images: s.images, savedPaths: [...s.savedPaths] }
    }
  }, [])

  function getSearchTerms(): string[] {
    return searchText.split('\n').map(l => l.trim()).filter(Boolean)
  }

  const handleExtract = useCallback(async () => {
    const terms = getSearchTerms()
    if (terms.length === 0) { setError('Enter at least one search term.'); return }
    setError(null)
    setImages([])
    setSavedPaths(new Set())
    setExtracting(true)
    const abort = new AbortController()
    abortRef.current = abort

    try {
      // need_total = int(total_seconds / seconds_per_image) + 10
      // With seconds_per_image=1 and total_seconds=imageCount-10 → need_total≈imageCount
      const res = await stagePreview({
        batches: [{ search_terms: terms, batch_title: null }],
        resolution,
        seconds_per_image: 1.0,
        total_seconds: Math.max(1, imageCount - 10),
        max_per_query: Math.max(1, Math.ceil(imageCount / terms.length)),
        color_theme: colorTheme,
        image_source: 'pexels',
      }, abort.signal)
      setImages(res.batches[0]?.images ?? [])
    } catch (e: unknown) {
      if ((e as { name?: string }).name !== 'AbortError') {
        setError(e instanceof Error ? e.message : 'Extraction failed.')
      }
    } finally {
      abortRef.current = null
      setExtracting(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, imageCount, resolution, colorTheme])

  function handleDelete(storagePath: string) {
    setImages(prev => prev.filter(img => img.storage_path !== storagePath))
  }

  async function handleDownloadAll() {
    if (images.length === 0) return
    setDownloadingAll(true)
    setDownloadProgress(0)
    try {
      if ('showDirectoryPicker' in window) {
        // Modern File System Access API — user picks a folder
        const dirHandle = await (window as Window & { showDirectoryPicker(): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker()
        for (let i = 0; i < images.length; i++) {
          const res = await fetch(images[i].signed_url)
          const blob = await res.blob()
          const filename = `image_${String(i + 1).padStart(3, '0')}.jpg`
          const fileHandle = await dirHandle.getFileHandle(filename, { create: true })
          const writable = await fileHandle.createWritable()
          await writable.write(blob)
          await writable.close()
          setDownloadProgress(i + 1)
          setSavedPaths(prev => new Set([...prev, images[i].storage_path]))
        }
      } else {
        // Fallback: trigger individual anchor downloads with a small delay
        for (let i = 0; i < images.length; i++) {
          const a = document.createElement('a')
          a.href = images[i].signed_url
          a.download = `image_${String(i + 1).padStart(3, '0')}.jpg`
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          setDownloadProgress(i + 1)
          setSavedPaths(prev => new Set([...prev, images[i].storage_path]))
          await new Promise(r => setTimeout(r, 150))
        }
      }
    } catch (e: unknown) {
      if ((e as { name?: string }).name !== 'AbortError') {
        setError('Download failed. Please try again.')
      }
    } finally {
      setDownloadingAll(false)
      setDownloadProgress(0)
    }
  }

  const [enlargedIdx, setEnlargedIdx] = useState<number | null>(null)
  const [showPromptModal, setShowPromptModal] = useState(false)

  async function handleDownloadOne(img: PreviewImageItem, i: number) {
    try {
      const res = await fetch(img.signed_url)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `image_${String(i + 1).padStart(3, '0')}.jpg`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setSavedPaths(prev => new Set([...prev, img.storage_path]))
    } catch {
      setError('Download failed. Please try again.')
    }
  }

  const hasResults = images.length > 0

  return (
    <div className="min-h-screen bg-stone-950">
      <AppNavbar session={session} activeTool="photos" />

      <div className="mx-auto w-full max-w-[1500px] px-4 py-8 xl:max-w-[1680px] 2xl:max-w-[1840px]">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)] xl:gap-8">

          {/* Left: Settings */}
          <div className="lg:col-span-1">
            <div className="rounded-2xl border border-stone-800 bg-stone-900 p-6 space-y-5 sticky top-6">

              {/* Quick-start bundles */}
              <div>
                <TermBundles
                  onLoad={bundles => {
                    const lines = bundles.flatMap(b => b.terms).join('\n')
                    setSearchText(prev => prev.trim() ? prev.trimEnd() + '\n' + lines : lines)
                  }}
                />
              </div>

              <hr className="border-stone-800" />

              {/* Search terms */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-sm font-semibold text-stone-200">Search terms</label>
                  <button
                    onClick={() => setShowPromptModal(true)}
                    className="flex items-center gap-1 text-xs text-stone-500 hover:text-brand-400 transition"
                    title="Get search terms using AI"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.347a3.75 3.75 0 01-5.304 0l-.356-.356a5 5 0 010-7.072z" />
                    </svg>
                    Get terms with AI
                  </button>
                </div>
                <p className="text-xs text-stone-500 mb-2">One search term per line</p>
                <textarea
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  rows={6}
                  placeholder={"marble roman bust\nancient stone ruins\nstoic philosopher"}
                  className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 font-mono text-xs text-stone-100 placeholder-stone-600 focus:border-brand-500 focus:outline-none resize-none"
                />
              </div>

              {/* Images per batch slider */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-stone-400">Images per batch</label>
                  <span className="text-xs font-mono text-stone-300">{imageCount}</span>
                </div>
                <input
                  type="range"
                  min={5} max={100} step={5}
                  value={imageCount}
                  onChange={e => setImageCount(parseInt(e.target.value))}
                  className="w-full accent-brand-500"
                />
                <div className="flex justify-between text-[10px] text-stone-600 mt-0.5">
                  <span>5</span>
                  <span>100</span>
                </div>
              </div>

              <hr className="border-stone-800" />

              {/* Resolution */}
              <div>
                <label className="mb-1 block text-xs text-stone-400">Resolution</label>
                <select
                  value={resolution}
                  onChange={e => setResolution(e.target.value)}
                  className="w-full rounded-lg border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-100 focus:outline-none focus:border-brand-500"
                >
                  {RESOLUTIONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              {/* Colour theme */}
              <div>
                <label className="mb-1 block text-xs text-stone-400">Colour theme</label>
                <select
                  value={colorTheme}
                  onChange={e => setColorTheme(e.target.value)}
                  className="w-full rounded-lg border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-100 focus:outline-none focus:border-brand-500"
                >
                  {COLOR_THEMES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {error && (
                <div className="rounded-xl bg-red-950 px-3 py-2.5 text-xs text-red-400">{error}</div>
              )}

              <button
                onClick={handleExtract}
                disabled={extracting}
                className="w-full rounded-xl bg-brand-500 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition"
              >
                {extracting ? 'Extracting…' : 'Extract images'}
              </button>

              {extracting && (
                <button
                  onClick={() => abortRef.current?.abort()}
                  className="w-full text-xs text-stone-600 hover:text-red-400 transition text-center"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          {/* Right: Results */}
          <div className="lg:col-span-1 min-w-0">
            {/* Header row when results exist */}
            {hasResults && (
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm text-stone-400">
                  {images.length} image{images.length !== 1 ? 's' : ''}
                  {savedPaths.size > 0 && (
                    <span className="text-stone-600"> · {savedPaths.size} saved</span>
                  )}
                </span>
                <button
                  onClick={handleDownloadAll}
                  disabled={downloadingAll}
                  className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition"
                >
                  {downloadingAll
                    ? `Saving ${downloadProgress}/${images.length}…`
                    : `Download all (${images.length})`}
                </button>
              </div>
            )}

            {/* Download-all progress bar */}
            {downloadingAll && (
              <div className="mb-4 h-1.5 w-full rounded-full bg-stone-800 overflow-hidden">
                <div
                  className="h-1.5 rounded-full bg-brand-500 transition-all"
                  style={{ width: `${(downloadProgress / images.length) * 100}%` }}
                />
              </div>
            )}

            {/* Loading state */}
            {extracting && (
              <div className="rounded-xl border border-stone-700 bg-stone-900 p-10 text-center">
                <p className="text-sm text-stone-400 mb-4">Fetching and grading images…</p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-700">
                  <div className="h-1.5 w-2/3 rounded-full bg-brand-500 animate-pulse" />
                </div>
              </div>
            )}

            {/* Empty state */}
            {!extracting && !hasResults && (
              <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-14 text-center">
                <p className="text-sm text-stone-600">Extracted images will appear here</p>
                <p className="text-xs text-stone-700 mt-1">Hover over images to download or remove them</p>
              </div>
            )}

            {/* Image grid */}
            {hasResults && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {images.map((img, i) => (
                  <div
                    key={img.storage_path}
                    className="relative group rounded-lg overflow-hidden border border-stone-800 bg-stone-900"
                    style={{ aspectRatio: resolution === '1920x1080' ? '16/9' : resolution === '1080x1080' ? '1/1' : '9/16' }}
                  >
                    <img
                      src={img.signed_url}
                      alt={`Image ${i + 1}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all duration-150" />
                    <div className="absolute inset-0 flex items-end justify-between p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <button
                        onClick={() => handleDownloadOne(img, i)}
                        className="rounded-md bg-brand-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 transition"
                      >
                        ↓ Save
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEnlargedIdx(i)}
                          className="rounded-md bg-stone-900/80 px-2 py-1 text-xs text-stone-300 hover:text-white hover:bg-stone-800 transition"
                          title="Enlarge"
                        >
                          ⤢
                        </button>
                        <button
                          onClick={() => handleDelete(img.storage_path)}
                          className="rounded-md bg-stone-900/80 px-2 py-1 text-xs text-stone-400 hover:text-red-400 hover:bg-stone-900 transition"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    {/* Saved indicator */}
                    {savedPaths.has(img.storage_path) && (
                      <div className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center shadow">
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                    {/* Image number */}
                    <div className="absolute top-1.5 right-1.5 text-[10px] font-mono text-stone-500 bg-stone-900/60 px-1 rounded">
                      {i + 1}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Lightbox */}
      {enlargedIdx !== null && images[enlargedIdx] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setEnlargedIdx(null)}
        >
          <img
            src={images[enlargedIdx].signed_url}
            alt=""
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          {/* Prev */}
          {enlargedIdx > 0 && (
            <button
              onClick={e => { e.stopPropagation(); setEnlargedIdx(enlargedIdx - 1) }}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-stone-900/80 border border-stone-700 flex items-center justify-center text-stone-300 hover:text-white hover:bg-stone-800 transition"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
            </button>
          )}
          {/* Next */}
          {enlargedIdx < images.length - 1 && (
            <button
              onClick={e => { e.stopPropagation(); setEnlargedIdx(enlargedIdx + 1) }}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-stone-900/80 border border-stone-700 flex items-center justify-center text-stone-300 hover:text-white hover:bg-stone-800 transition"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
            </button>
          )}
          {/* Close + download */}
          <div className="absolute top-4 right-4 flex items-center gap-2">
            <button
              onClick={e => { e.stopPropagation(); handleDownloadOne(images[enlargedIdx], enlargedIdx) }}
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 transition"
            >
              ↓ Save
            </button>
            <button
              onClick={() => setEnlargedIdx(null)}
              className="w-8 h-8 rounded-full bg-stone-900/80 border border-stone-700 flex items-center justify-center text-stone-400 hover:text-white transition"
            >
              ✕
            </button>
          </div>
          {/* Counter */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-stone-500 font-mono">
            {enlargedIdx + 1} / {images.length}
          </div>
        </div>
      )}
      {showPromptModal && <PromptModal onClose={() => setShowPromptModal(false)} />}
    </div>
  )
}
