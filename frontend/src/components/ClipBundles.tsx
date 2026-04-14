/**
 * ClipBundles.tsx
 *
 * Collapsible panel of pre-built b-roll search term bundles for clips mode.
 * Matches the multi-select flow in TermBundles. Selected bundles load into
 * VideoClipSearch batches with each bundle capped to 3 video search terms.
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
  onLoad: (bundles: ClipBundle[]) => void
  disabled?: boolean
}

export default function ClipBundles({ onLoad, disabled }: Props) {
  const [open, setOpen] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)

  function toggle(label: string) {
    if (disabled) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  function handleLoad() {
    const bundles = CLIP_BUNDLES
      .filter(b => selected.has(b.label))
      .map(b => ({ ...b, terms: b.terms.slice(0, 3) }))
    if (bundles.length === 0) return
    onLoad(bundles)
    setSelected(new Set())
    setOpen(false)
  }

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
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {CLIP_BUNDLES.map((b, i) => (
              <label
                key={b.label}
                title={b.terms.join(' · ')}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
                  i >= INITIAL_VISIBLE && !showAll ? 'hidden' : 'flex'
                } ${
                  disabled
                    ? 'cursor-not-allowed border-stone-800 bg-stone-900 text-stone-600 opacity-50'
                    : selected.has(b.label)
                      ? 'cursor-pointer border-brand-500 bg-brand-500/10 text-brand-400'
                      : 'cursor-pointer border-stone-700 bg-stone-800 text-stone-300 hover:border-stone-500 hover:text-stone-100'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(b.label)}
                  onChange={() => toggle(b.label)}
                  disabled={disabled}
                  className="hidden"
                />
                {b.label}
              </label>
            ))}
            {!showAll && (
              <button
                onClick={() => setShowAll(true)}
                disabled={disabled}
                className="rounded-full border border-stone-700 bg-stone-800 px-3 py-1 text-xs text-stone-500 hover:text-stone-300 transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                +{CLIP_BUNDLES.length - INITIAL_VISIBLE} more
              </button>
            )}
          </div>

          {selected.size > 0 && (
            <button
              onClick={handleLoad}
              disabled={disabled}
              className="rounded-lg bg-brand-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Load {selected.size} batch{selected.size !== 1 ? 'es' : ''} -&gt;
            </button>
          )}
        </div>
      )}
    </div>
  )
}
