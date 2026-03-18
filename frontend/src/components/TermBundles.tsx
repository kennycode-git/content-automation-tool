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

export const BUNDLES: Bundle[] = [
  {
    label: 'Buddhism',
    terms: [
      'golden buddha statue temple warm candlelight serene ancient',
      'lotus flower still dark pond reflection dawn peaceful',
      'tibetan prayer flags mountain wind high altitude golden',
      'monk orange robe walking misty temple path serene',
      'incense smoke curling dark shrine warm glowing altar',
      'stone buddha face moss covered ancient forest peaceful',
      'mandala intricate golden sand warm ceremonial spiritual pattern',
      'tibetan monastery cliff edge dramatic mountain warm morning',
      'meditation cushion dark quiet room candlelight warm stillness',
      'cherry blossom falling warm soft petals impermanence beauty',
    ],
  },
  {
    label: 'Stoic Philosophy',
    terms: [
      'marble roman bust dark museum shadows weathered emperor',
      'ancient stone sculpture dark moss covered philosopher contemplating',
      'crumbling greek column dark ruins overgrown atmospheric decay',
      'weathered parchment scroll dark aged brown text faded',
      'lone figure mountain dark fog shrouded stoic standing',
      'roman colosseum ruins dark arches shadows dramatic abandoned',
      'bronze stoic statue dark oxidized patina weathered dignified',
      'stone amphitheater empty dark seats weathered ancient theatre',
      'dark brown leather codex stoic meditations handwritten aged',
      'charcoal roman fresco dark faded wisdom depicted wall',
    ],
  },
  {
    label: 'Dark Academia',
    terms: [
      'candlelit library shelves dark oak towering volumes leather',
      'aged leather journal dark mahogany desk brass lamp',
      'spiral staircase stone dark tower ascending shadows atmospheric',
      'ink quill writing dark ebony desk parchment brown',
      'dusty bookshelf antique dark walnut shelves volumes stacked',
      'ivy covered stone dark university building gothic architecture',
      'dark brown study room fireplace crackling shadows dancing',
      'vintage typewriter dark mechanical keys shadowed circled black',
      'leather armchair cracked dark reading corner lamp bronze',
      'charcoal sketch anatomical dark parchment scientific illustration aged',
    ],
  },
  {
    label: 'Eastern Philosophy',
    terms: [
      'misty mountain peak dark fog zen monastery silhouette',
      'bamboo forest dense dark shadows green filtered morning',
      'ancient temple stone dark steps moss covered weathered',
      'koi pond dark reflection meditation rocks still water',
      'solitary monk silhouette dark walking meditation temple grounds',
      'japanese torii gate dark fog shrouded atmospheric sacred',
      'zen garden raked dark sand stones minimal shadows',
      'bonsai tree gnarled dark ancient pot weathered ceramic',
      'incense smoke rising dark meditation room atmospheric coiling',
      'dark wood zen temple interior minimal candlelit austere',
    ],
  },
  {
    label: 'Shadow',
    terms: [
      'dark forest mist dark shadows dense overgrown atmospheric',
      'candlelight flickering darkness dark cathedral shadows dancing eerie',
      'gothic cathedral interior dark vaulted arches shadows towering',
      'rain soaked cobblestone dark street lamplight reflecting wet',
      'dramatic storm clouds dark sky brooding ominous gathering',
      'lone crow perched dark bare tree branches skeletal',
      'gargoyle stone weathered dark cathedral guardian grotesque watching',
      'wrought iron gate dark twisted rusted atmospheric entrance',
      'crypt stone vault dark coffin shadows eternal resting',
      'moonlight filtering branches dark cemetery atmospheric shadows casting',
    ],
  },
  {
    label: 'Existentialism',
    terms: [
      'solitary figure walking dark empty road vanishing horizon',
      'person window dark rain reflection isolated contemplating atmospheric',
      'abandoned building interior dark decay peeling walls desolate',
      'vast empty desert dark landscape dunes shadows isolation',
      'silhouette cliff edge dark abyss gazing vertiginous standing',
      'long corridor dark vanishing shadows perspective atmospheric empty',
      'solitary bench empty dark park fog atmospheric isolated',
      'figure mirror dark reflection confronting self fragmented identity',
      'empty chair dark room single window light streaming',
      'lone footprints sand dark beach waves erasing impermanence',
    ],
  },
  {
    label: 'Psychology',
    terms: [
      'human brain scan dark blue neon glowing neural abstract',
      'silhouette figure dark cracked mirror fragmented reflection identity',
      'maze dark corridor blue lit walls atmospheric endless labyrinth',
      'tangled wire dark blue abstract mind thoughts complex neural',
      'lone figure dark vast empty space blue mist floating',
      'hand reaching dark water blue ripple underwater surreal reaching',
      'clock face melting dark surreal time perception distorted blue',
      'staircase dark spiral descending blue shadows infinite looping',
      'window dark room blue moonlight figure observing contemplative still',
      'ancient inkblot dark symmetrical blue test pattern psychological abstract',
    ],
  },
  {
    label: 'Nature as Philosophy',
    terms: [
      'waves crashing dark rocky shore dramatic atmospheric spray',
      'dead tree winter dark fog bare branches skeletal',
      'frost morning dark empty field atmospheric crystals glistening',
      'river flowing dark ancient rocks moss covered weathered',
      'single candle burning dark empty room shadows flickering',
      'moss covered stone dark forest atmospheric green carpeted',
      'lightning strike dark stormy sky dramatic power unleashing',
      'volcanic rock dark formations weathered lava ancient cooled',
      'tidal pool dark rocks reflective still mysterious depths',
      'willow tree dark weeping pond reflection atmospheric drooping',
    ],
  },
]

interface Props {
  onLoad: (bundles: { title: string | null; terms: string[] }[]) => void
}

const INITIAL_VISIBLE = 3

export default function TermBundles({ onLoad }: Props) {
  const [open, setOpen] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)

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
            {BUNDLES.map((b, i) => (
              <label
                key={b.label}
                className={`flex items-center gap-1.5 cursor-pointer rounded-full border px-3 py-1 text-xs transition ${
                  i >= INITIAL_VISIBLE && !showAll ? 'hidden' : 'flex'
                } ${
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
            {!showAll && (
              <button
                onClick={() => setShowAll(true)}
                className="flex items-center rounded-full border border-stone-700 bg-stone-800 px-3 py-1 text-xs text-stone-500 hover:text-stone-300 transition"
              >
                +{BUNDLES.length - INITIAL_VISIBLE} more
              </button>
            )}
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
