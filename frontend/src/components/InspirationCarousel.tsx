/**
 * InspirationCarousel.tsx
 *
 * Horizontal strip of style cards — big video previews, minimal text.
 * Hover a card to reveal "Use this style" overlay.
 */

import { useRef, useState } from 'react'
import { BUNDLES } from './TermBundles'

interface Preset {
  id: string
  label: string
  theme: string
  bundleLabel: string
  gradient: string
  accentFolder?: string | null
}

const PRESETS: Preset[] = [
  {
    id: 'dark-academia',
    label: 'Dark Academia',
    theme: 'dark',
    bundleLabel: 'Dark Academia',
    gradient: 'from-stone-900 via-amber-950 to-stone-950',
  },
  {
    id: 'stoic-philosophy',
    label: 'Stoic Philosophy',
    theme: 'bw',
    bundleLabel: 'Stoic Philosophy',
    gradient: 'from-stone-950 via-stone-800 to-stone-950',
    accentFolder: 'gold',
  },
  {
    id: 'eastern-philosophy',
    label: 'Eastern Philosophy',
    theme: 'none',
    bundleLabel: 'Eastern Philosophy',
    gradient: 'from-stone-950 via-emerald-950 to-stone-900',
  },
  {
    id: 'existentialism',
    label: 'Existentialism',
    theme: 'low_exp',
    bundleLabel: 'Existentialism',
    gradient: 'from-stone-950 via-slate-950 to-stone-900',
  },
  {
    id: 'psychology',
    label: 'Psychology',
    theme: 'blue',
    bundleLabel: 'Psychology',
    gradient: 'from-blue-950 via-stone-950 to-blue-950',
  },
  {
    id: 'shadow',
    label: 'Shadow',
    theme: 'dark',
    bundleLabel: 'Gothic / Shadow',
    gradient: 'from-stone-950 via-slate-900 to-stone-950',
  },
  {
    id: 'nature-philosophy',
    label: 'Nature as Philosophy',
    theme: 'sepia',
    bundleLabel: 'Nature as Philosophy',
    gradient: 'from-stone-900 via-stone-800 to-stone-950',
  },
]

interface Props {
  onApply: (theme: string, bundles: { title: string | null; terms: string[] }[], accentFolder?: string | null) => void
  onHide?: () => void
}

export default function InspirationCarousel({ onApply, onHide }: Props) {
  const [dismissed, setDismissed] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  if (dismissed) return null

  function handleClose() {
    setDismissed(true)
    onHide?.()
  }

  function handleApply(preset: Preset) {
    const bundle = BUNDLES.find(b => b.label === preset.bundleLabel)
    onApply(preset.theme, bundle ? [{ title: bundle.label, terms: bundle.terms }] : [], preset.accentFolder ?? null)
  }

  function scroll(dir: 'left' | 'right') {
    if (!scrollRef.current) return
    scrollRef.current.scrollBy({ left: dir === 'right' ? 280 : -280, behavior: 'smooth' })
  }

  return (
    <div className="border-b border-stone-800 bg-stone-950">
      {/* Card strip */}
      <div className="relative">
        <button
          onClick={() => scroll('left')}
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-stone-900/90 border border-stone-700 flex items-center justify-center text-stone-400 hover:text-stone-100 hover:bg-stone-800 transition shadow-lg"
          aria-label="Scroll left"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          onClick={() => scroll('right')}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-stone-900/90 border border-stone-700 flex items-center justify-center text-stone-400 hover:text-stone-100 hover:bg-stone-800 transition shadow-lg"
          aria-label="Scroll right"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto scroll-smooth px-10 pt-6 pb-2 scrollbar-none"
          style={{ scrollbarWidth: 'none' }}
        >
          {PRESETS.map(preset => (
            <StyleCard key={preset.id} preset={preset} onApply={handleApply} />
          ))}
        </div>
      </div>

      {/* Dismiss bar */}
      <div className="flex items-center justify-end gap-3 px-4 pb-2.5">
        <button
          onClick={handleClose}
          className="flex items-center gap-1.5 rounded-lg border border-stone-700 bg-stone-900 px-3 py-1 text-xs text-stone-400 hover:border-stone-500 hover:text-stone-200 transition"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          Dismiss
        </button>
      </div>
    </div>
  )
}

function StyleCard({ preset, onApply }: { preset: Preset; onApply: (p: Preset) => void }) {
  const [failed, setFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  function handleMouseEnter() {
    videoRef.current?.play()
  }

  function handleMouseLeave() {
    const v = videoRef.current
    if (!v) return
    v.pause()
  }

  return (
    <div
      className="group relative shrink-0 w-44 cursor-pointer rounded-xl overflow-hidden border border-stone-800 hover:border-stone-600 transition-colors"
      onClick={() => onApply(preset)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Video / gradient fallback */}
      <div className="relative w-full aspect-[3/4] bg-stone-900">
        {!failed && (
          <video
            ref={videoRef}
            src={`/theme-previews/${preset.id}.mp4`}
            muted
            loop
            playsInline
            preload="metadata"
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setFailed(true)}
            onLoadedMetadata={e => {
              const v = e.currentTarget
              if (v.duration) v.currentTime = Math.random() * v.duration
            }}
          />
        )}
        <div className={`absolute inset-0 bg-gradient-to-br ${preset.gradient} ${failed ? '' : 'opacity-0'}`} />

        {/* Hover label — no overlay, just text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-[11px] font-semibold text-white"
            style={{ textShadow: '0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7)' }}
          >
            Use this style →
          </span>
        </div>
      </div>

      {/* Label */}
      <div className="px-2.5 py-2 bg-stone-900">
        <p className="text-xs font-semibold text-stone-200 truncate">{preset.label}</p>
        <ThemePill theme={preset.theme} />
      </div>
    </div>
  )
}

const THEME_LABELS: Record<string, string> = {
  none: 'Natural', dark: 'Dark', sepia: 'Sepia', warm: 'Amber',
  low_exp: 'Low Exp', grey: 'Silver', blue: 'Cobalt', red: 'Crimson', bw: 'Mono',
}

const THEME_DOT: Record<string, string> = {
  none: 'bg-stone-400', dark: 'bg-stone-900 ring-1 ring-stone-600', sepia: 'bg-amber-800',
  warm: 'bg-amber-600', low_exp: 'bg-stone-950 ring-1 ring-stone-700', grey: 'bg-stone-500',
  blue: 'bg-blue-700', red: 'bg-red-800', bw: 'bg-stone-100',
}

function ThemePill({ theme }: { theme: string }) {
  return (
    <span className="mt-1 inline-flex items-center gap-1">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${THEME_DOT[theme] ?? 'bg-stone-500'}`} />
      <span className="text-[10px] text-stone-500">{THEME_LABELS[theme] ?? theme}</span>
    </span>
  )
}
