/**
 * OnboardingTour.tsx
 *
 * Spotlight-style first-use tour.
 * - Shows once per browser (localStorage flag: cogito_tour_seen).
 * - Can be re-triggered by calling the exported startTour() or via the ? button.
 * - Uses CSS box-shadow spread to create a spotlight cutout around the target element.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

export const TOUR_STORAGE_KEY = 'cogito_tour_seen'

interface TourStep {
  target: string
  title: string
  description: React.ReactNode
  onEnter?: () => void
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
  onOpenPrompt: () => void
  onOpenVariants: () => void
}

export default function OnboardingTour({ active, onClose, onOpenPrompt, onOpenVariants }: Props) {
  const [stepIdx, setStepIdx] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const animFrame = useRef<number>(0)

  const STEPS: TourStep[] = useMemo(() => [
    {
      target: 'batch-editor',
      title: 'Step 1 — Search terms',
      description: 'Add your search terms here — each card becomes a separate video. Give each batch a title so your outputs are easy to identify. Add multiple batches to generate several videos in one run.',
    },
    {
      target: 'batch-editor',
      title: 'Step 2 — Classic text mode',
      description: (
        <>
          Switch to <strong className="text-stone-200">Classic text</strong> mode for a faster, power-user workflow. You can use AI to generate a full batch list in the correct format in seconds.{' '}
          <button
            onClick={onOpenPrompt}
            className="text-brand-400 underline hover:text-brand-300 transition"
          >
            Copy example prompt →
          </button>
        </>
      ),
    },
    {
      target: 'theme-selector',
      title: 'Step 3 — Colour themes',
      description: 'Choose a visual style for your video. Hover the eye icon next to each theme to preview it. Dark Tones and Low Exposure work best for white text overlays.',
    },
    {
      target: 'advanced-btn',
      title: 'Step 4 — Advanced settings',
      description: (
        <>
          Click <strong className="text-stone-200">⚙</strong> to open advanced options. Change the <strong className="text-stone-200">image source</strong> (Unsplash, Pexels, or both), and add <strong className="text-stone-200">accent images</strong> — branded photos in blue, red, or gold sprinkled into ~20% of your frames for a signature look.
        </>
      ),
    },
    {
      target: 'variants-btn',
      title: 'Step 5 — Colour variants',
      onEnter: onOpenVariants,
      description: 'Generate the same video in multiple colour styles at once — perfect for A/B testing before posting. Select which themes you want below, then hit Generate variants.',
    },
    {
      target: 'gen-dropdown',
      title: 'Step 6 — Preview before generating',
      description: 'Click ▾ then "Preview images first →" to browse and curate your images before spending a credit on the full render.',
    },
    {
      target: 'generate-btn',
      title: 'Step 7 — Generate',
      description: 'Hit Generate to create your video. Each render uses 1 credit. Watch it build in real-time in the panel on the right.',
    },
  ], [onOpenPrompt, onOpenVariants])

  const step = STEPS[stepIdx]

  // Track target element position (handles scroll/resize)
  useLayoutEffect(() => {
    if (!active) return
    function update() {
      setRect(getTargetRect(step.target))
      animFrame.current = requestAnimationFrame(update)
    }
    animFrame.current = requestAnimationFrame(update)
    return () => cancelAnimationFrame(animFrame.current)
  }, [active, step.target])

  const handleClose = useCallback(() => {
    localStorage.setItem(TOUR_STORAGE_KEY, 'true')
    onClose()
  }, [onClose])

  const handleNext = useCallback(() => {
    if (stepIdx < STEPS.length - 1) {
      setStepIdx(i => i + 1)
    } else {
      handleClose()
    }
  }, [stepIdx, STEPS.length, handleClose])

  const handlePrev = useCallback(() => {
    setStepIdx(i => Math.max(0, i - 1))
  }, [])

  // Reset step index when tour opens
  useEffect(() => {
    if (active) setStepIdx(0)
  }, [active])

  // Call onEnter when a step becomes active
  useEffect(() => {
    if (active) {
      STEPS[stepIdx]?.onEnter?.()
    }
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
