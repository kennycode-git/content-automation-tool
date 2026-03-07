/**
 * TermBundles.tsx
 *
 * Collapsible panel of pre-built search term bundles.
 * Supports multi-select — check any bundles then click "Load N batches" to
 * append them all at once. Mode-aware: classic text mode appends # blocks,
 * visual mode adds cards.
 */

import { useState } from 'react'

interface Bundle {
  label: string
  terms: string[]
}

const BUNDLES: Bundle[] = [
  {
    label: 'Stoic Philosophy',
    terms: [
      'marble roman bust',
      'ancient stone sculpture',
      'crumbling greek architecture',
      'weathered parchment scroll',
      'lone figure mountain fog',
      'roman colosseum ruins',
    ],
  },
  {
    label: 'Dark Academia',
    terms: [
      'candlelit library books',
      'aged leather journal desk',
      'spiral staircase stone tower',
      'ink quill writing desk',
      'dusty antique bookshelf',
      'ivy covered stone building',
    ],
  },
  {
    label: 'Eastern Philosophy',
    terms: [
      'misty mountain zen',
      'bamboo forest morning light',
      'ancient temple stone steps',
      'koi pond reflection meditation',
      'solitary monk silhouette',
      'japanese torii gate fog',
    ],
  },
  {
    label: 'Gothic / Shadow',
    terms: [
      'dark forest shadow mist',
      'candlelight flickering darkness',
      'gothic cathedral interior',
      'rain soaked cobblestone street',
      'dramatic storm clouds sky',
      'lone crow bare tree',
    ],
  },
  {
    label: 'Existentialism',
    terms: [
      'solitary figure empty road',
      'person window rain reflection',
      'abandoned building decay',
      'vast empty desert landscape',
      'silhouette cliff edge sunset',
      'long corridor darkness end',
    ],
  },
  {
    label: 'Ancient Wisdom',
    terms: [
      'egyptian hieroglyph stone wall',
      'ancient manuscript text',
      'weathered compass map table',
      'hourglass sand antique',
      'celestial star map aged',
      'philosopher bust museum light',
    ],
  },
  {
    label: 'Nature as Philosophy',
    terms: [
      'waves crashing rocky shore',
      'dead tree winter fog',
      'frost morning empty field',
      'river flowing ancient rocks',
      'single candle dark room',
      'moss covered stone forest',
    ],
  },
]

interface Props {
  onLoad: (bundles: { title: string | null; terms: string[] }[]) => void
}

export default function TermBundles({ onLoad }: Props) {
  const [open, setOpen] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function toggle(label: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  function handleLoad() {
    const bundles = BUNDLES
      .filter(b => selected.has(b.label))
      .map(b => ({ title: b.label, terms: b.terms }))
    if (bundles.length === 0) return
    onLoad(bundles)
    setSelected(new Set())
    setOpen(false)
  }

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-xs font-semibold text-stone-300 hover:text-stone-100 transition"
      >
        <span className="rounded bg-stone-700 px-1.5 py-0.5 text-stone-400 text-[10px]">
          {open ? '▲' : '▼'}
        </span>
        Quick-start bundles
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {BUNDLES.map(b => (
              <label
                key={b.label}
                className={`flex items-center gap-1.5 cursor-pointer rounded-full border px-3 py-1 text-xs transition ${
                  selected.has(b.label)
                    ? 'border-brand-500 bg-brand-500/10 text-brand-400'
                    : 'border-stone-700 bg-stone-800 text-stone-300 hover:border-stone-500 hover:text-stone-100'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(b.label)}
                  onChange={() => toggle(b.label)}
                  className="hidden"
                />
                {b.label}
              </label>
            ))}
          </div>

          {selected.size > 0 && (
            <button
              onClick={handleLoad}
              className="rounded-lg bg-brand-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 transition"
            >
              Load {selected.size} batch{selected.size !== 1 ? 'es' : ''} →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
