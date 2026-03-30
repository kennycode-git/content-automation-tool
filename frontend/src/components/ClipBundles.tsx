/**
 * ClipBundles.tsx
 *
 * Collapsible panel of pre-built b-roll search term bundles for clips mode.
 * Matches the style of TermBundles. Clicking a bundle loads its terms (up to 3)
 * directly into the VideoClipSearch slots.
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

const INITIAL_VISIBLE = 4

interface Props {
  onLoad: (terms: string[]) => void
  disabled?: boolean
}

export default function ClipBundles({ onLoad, disabled }: Props) {
  const [open, setOpen] = useState(true)
  const [showAll, setShowAll] = useState(false)

  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-xs font-semibold text-stone-300 hover:text-stone-100 transition"
      >
        <span className="rounded bg-stone-700 px-1.5 py-0.5 text-stone-400 text-[10px]">
          {open ? '▲' : '▼'}
        </span>
        B-roll bundles
      </button>

      {open && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2">
            {CLIP_BUNDLES.map((b, i) => (
              <button
                key={b.label}
                onClick={() => onLoad(b.terms.slice(0, 3))}
                disabled={disabled}
                title={b.terms.join(' · ')}
                className={`rounded-full border px-3 py-1 text-xs transition
                  border-stone-700 bg-stone-800 text-stone-300
                  hover:border-stone-500 hover:text-stone-100
                  disabled:opacity-40 disabled:cursor-not-allowed
                  ${i >= INITIAL_VISIBLE && !showAll ? 'hidden' : ''}`}
              >
                {b.label}
              </button>
            ))}
            {!showAll && (
              <button
                onClick={() => setShowAll(true)}
                className="rounded-full border border-stone-700 bg-stone-800 px-3 py-1 text-xs text-stone-500 hover:text-stone-300 transition"
              >
                +{CLIP_BUNDLES.length - INITIAL_VISIBLE} more
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
