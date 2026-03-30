/**
 * ClipBundles.tsx
 *
 * Collapsible panel of pre-built b-roll search term bundles for clips mode.
 * Clicking a bundle loads its terms (up to 3) into the VideoClipSearch slots.
 */

import { useState } from 'react'

interface ClipBundle {
  label: string
  terms: string[]
}

const CLIP_BUNDLES: ClipBundle[] = [
  {
    label: 'Dark Solitude',
    terms: ['rain on window night', 'lone figure fog'],
  },
  {
    label: 'Stoic Nature',
    terms: ['ancient ruins sunset', 'rocky mountain path', 'storm clouds rolling'],
  },
  {
    label: 'Contemplation',
    terms: ['candle flame dark room', 'person silhouette window', 'hands writing journal'],
  },
  {
    label: 'Cosmic Scale',
    terms: ['night sky stars timelapse', 'milky way mountains', 'clouds moving fast'],
  },
  {
    label: 'Urban Quiet',
    terms: ['empty street rain night', 'city lights bokeh', 'train window moving'],
  },
  {
    label: 'Raw Elements',
    terms: ['ocean waves crashing rocks', 'fire flames dark', 'smoke rising slow motion'],
  },
  {
    label: 'Golden Hour',
    terms: ['sunset field alone', 'walking path golden light', 'birds flying silhouette sunset'],
  },
  {
    label: 'Cinematic Interiors',
    terms: ['library books dark', 'coffee steam morning light', 'dust particles sunlight'],
  },
  {
    label: 'Struggle & Resilience',
    terms: ['boxer training gym', 'runner alone dawn', 'hands gripping climbing'],
  },
  {
    label: 'Philosophy & Academia',
    terms: ['old book pages turning', 'marble statue closeup', 'hourglass sand falling'],
  },
]

interface Props {
  onLoad: (terms: string[]) => void
  disabled?: boolean
}

export default function ClipBundles({ onLoad, disabled }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-200
                   disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`}
          viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        B-roll bundles
        <span className="text-stone-600">({CLIP_BUNDLES.length})</span>
      </button>

      {open && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {CLIP_BUNDLES.map(bundle => (
            <button
              key={bundle.label}
              onClick={() => onLoad(bundle.terms.slice(0, 3))}
              disabled={disabled}
              className="rounded-full border border-stone-700 bg-stone-800 px-2.5 py-1
                         text-[11px] text-stone-300 hover:border-brand-500 hover:text-brand-400
                         disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={bundle.terms.join(' · ')}
            >
              {bundle.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
