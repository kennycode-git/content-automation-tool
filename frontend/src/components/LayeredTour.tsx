/**
 * LayeredTour.tsx
 *
 * Spotlight-style tour for the Layered rendering mode.
 * Mirrors the OnboardingTour mechanics — spotlight cutout via box-shadow,
 * rAF position tracking, keyboard nav — but tailored to the Layered tab.
 *
 * Auto-shown on first visit to the Layered tab (localStorage flag).
 * Re-triggerable via the persistent "Take a tour" button in Dashboard.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

export const LAYERED_TOUR_KEY = 'cogito_layered_tour_seen'

interface TourStep {
  target: string
  title: string
  description: React.ReactNode
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

function getTargetRect(target: string): Rect | null {
  const el = document.querySelector(`[data-tour="${target}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

interface Props {
  active: boolean
  onClose: () => void
}

export default function LayeredTour({ active, onClose }: Props) {
  const [stepIdx, setStepIdx] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const animFrame = useRef<number>(0)

  const STEPS: TourStep[] = useMemo(() => [
    {
      target: 'batch-editor',
      title: 'Step 1 — Foreground image terms',
      description: (
        <>
          Add <strong className="text-stone-200">search terms</strong> for the photos that will animate over your background video.
          Each batch card becomes a separate layered video render. Give each one a descriptive title.
        </>
      ),
    },
    {
      target: 'theme-selector',
      title: 'Step 2 — Video settings & colour theme',
      description: (
        <>
          Set <strong className="text-stone-200">resolution</strong>, <strong className="text-stone-200">duration</strong> and
          <strong className="text-stone-200"> colour theme</strong> for the final composite.
          The theme grades whichever layers you select in the Grade Target control below.
        </>
      ),
    },
    {
      target: 'layered-bg-search',
      title: 'Step 3 — Background video',
      description: (
        <>
          Search Pexels for a <strong className="text-stone-200">looping background video</strong>.
          Try <em className="text-stone-300">"nature"</em>, <em className="text-stone-300">"ocean"</em>,
          <em className="text-stone-300"> "city lights"</em> or <em className="text-stone-300">"abstract"</em>.
          Select up to 5 — multiple videos crossfade together.
        </>
      ),
    },
    {
      target: 'layered-opacity',
      title: 'Opacity & image speed',
      description: (
        <>
          <strong className="text-stone-200">Opacity</strong> controls how visible the image layer is over the background video —
          Medium (55%) balances both layers well. The <strong className="text-stone-200">seconds per image</strong> slider
          above controls how fast images cycle.
        </>
      ),
    },
    {
      target: 'layered-grade-target',
      title: 'Colour grade target',
      description: (
        <>
          Choose where your colour theme is applied —
          <strong className="text-stone-200"> Foreground</strong> grades the images only,
          <strong className="text-stone-200"> Background</strong> grades the video only, and
          <strong className="text-stone-200"> Both</strong> gives the most unified, cinematic look.
        </>
      ),
    },
    {
      target: 'layered-generate',
      title: 'Generate',
      description: (
        <>
          Hit <strong className="text-stone-200">Generate Layered</strong> to render.
          The pipeline downloads your background video, composites the image slideshow over it
          with your opacity and grade settings, and produces a single MP4. Each render uses 1 credit.
        </>
      ),
    },
  ], [])

  const step = STEPS[stepIdx]

  // Track target element position
  useLayoutEffect(() => {
    if (!active || !step) return
    function update() {
      setRect(getTargetRect(step.target))
      animFrame.current = requestAnimationFrame(update)
    }
    animFrame.current = requestAnimationFrame(update)
    return () => cancelAnimationFrame(animFrame.current)
  }, [active, step])

  const handleClose = useCallback(() => {
    localStorage.setItem(LAYERED_TOUR_KEY, 'true')
    onClose()
  }, [onClose])

  const handleNext = useCallback(() => {
    if (stepIdx < STEPS.length - 1) setStepIdx(i => i + 1)
    else handleClose()
  }, [stepIdx, STEPS.length, handleClose])

  const handlePrev = useCallback(() => {
    setStepIdx(i => Math.max(0, i - 1))
  }, [])

  // Reset step when tour opens
  useEffect(() => {
    if (active) setStepIdx(0)
  }, [active])

  // Scroll target into view on each step
  useEffect(() => {
    if (!active) return
    const el = document.querySelector(`[data-tour="${step?.target}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [stepIdx, active]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard nav
  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose()
      if (e.key === 'ArrowRight' || e.key === 'Enter') handleNext()
      if (e.key === 'ArrowLeft') handlePrev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, handleClose, handleNext, handlePrev])

  if (!active) return null

  // Spotlight geometry
  const PAD = 10
  const spotTop    = (rect?.top    ?? 0) - PAD
  const spotLeft   = (rect?.left   ?? 0) - PAD
  const spotWidth  = (rect?.width  ?? 0) + PAD * 2
  const spotHeight = (rect?.height ?? 0) + PAD * 2

  if (!rect) return (
    <div className="fixed inset-0 z-[199]" style={{ background: 'transparent' }} onClick={handleClose} />
  )

  const tooltipWidth = 320
  const tooltipHeight = 300
  const margin = 16
  const rawLeft = Math.max(margin, Math.min(spotLeft, window.innerWidth - tooltipWidth - margin))
  const belowTop = spotTop + spotHeight + 16
  const fitsBelow = belowTop + tooltipHeight < window.innerHeight - margin
  let tooltipTop = fitsBelow ? belowTop : spotTop - tooltipHeight - 16
  tooltipTop = Math.max(margin, Math.min(tooltipTop, window.innerHeight - tooltipHeight - margin))

  return (
    <>
      {/* Click-away overlay */}
      <div
        className="fixed inset-0 z-[199]"
        style={{ background: 'transparent' }}
        onClick={handleClose}
      />

      {/* Spotlight */}
      <div
        className="fixed z-[200] rounded-xl pointer-events-none"
        style={{
          top: spotTop,
          left: spotLeft,
          width: spotWidth,
          height: spotHeight,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.72)',
          transition: 'top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease',
        }}
      />

      {/* Tooltip card */}
      <div
        className="fixed z-[201] w-80 rounded-xl border border-stone-600 bg-stone-800 shadow-2xl p-4"
        style={{
          top: tooltipTop,
          left: rawLeft,
          transition: 'top 0.25s ease, left 0.25s ease',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Progress dots */}
        <div className="flex items-center gap-1.5 mb-3">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === stepIdx ? 'w-4 bg-brand-500' : 'w-1.5 bg-stone-600'}`}
            />
          ))}
          <span className="ml-auto text-xs text-stone-500">{stepIdx + 1} / {STEPS.length}</span>
        </div>

        <h3 className="text-sm font-semibold text-stone-100 mb-1">{step.title}</h3>
        <div className="text-xs text-stone-400 leading-relaxed">{step.description}</div>

        <div className="flex items-center justify-between mt-4">
          <button
            onClick={handleClose}
            className="text-xs text-stone-600 hover:text-stone-400 transition"
          >
            Skip tour
          </button>
          <div className="flex gap-2">
            {stepIdx > 0 && (
              <button
                onClick={handlePrev}
                className="rounded-lg border border-stone-700 px-3 py-1.5 text-xs text-stone-400 hover:text-stone-200 hover:border-stone-500 transition"
              >
                ← Back
              </button>
            )}
            <button
              onClick={handleNext}
              className="rounded-lg bg-brand-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 transition"
            >
              {stepIdx < STEPS.length - 1 ? 'Next →' : 'Done ✓'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
