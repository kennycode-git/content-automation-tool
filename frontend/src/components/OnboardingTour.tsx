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
  isFirstVisit: boolean
  onClose: () => void
  onOpenPrompt: () => void
  onOpenVariants: () => void
}

export default function OnboardingTour({ active, isFirstVisit, onClose, onOpenPrompt, onOpenVariants }: Props) {
  // -1 = welcome screen (first visit only), 0+ = spotlight steps
  const [stepIdx, setStepIdx] = useState<number>(() => isFirstVisit ? -1 : 0)
  const [rect, setRect] = useState<Rect | null>(null)
  const animFrame = useRef<number>(0)

  const STEPS: TourStep[] = useMemo(() => [
    {
      target: 'batch-editor',
      title: 'Search terms',
      description: 'Add your search terms here. Each card becomes a separate video. Give each batch a title so your outputs are easy to identify, and add multiple batches to generate several videos in one run.',
    },
    {
      target: 'batch-editor',
      title: 'Classic text mode',
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
      title: 'Video settings',
      description: (
        <>
          Set your <strong className="text-stone-200">resolution</strong> and <strong className="text-stone-200">timing</strong>. For TikTok & Reels use <strong className="text-stone-200">1080×1920</strong> (portrait). Adjust <strong className="text-stone-200">seconds per image</strong> to control how fast images cut, and <strong className="text-stone-200">total duration</strong> to set the overall video length.
        </>
      ),
    },
    {
      target: 'theme-selector',
      title: 'Colour themes',
      description: 'Choose a visual style for your video. Hover the eye icon next to each theme to preview it. Dark Tones and Low Exposure work best for white text overlays.',
    },
    {
      target: 'batch-style-btn',
      title: 'Per-batch style',
      description: (
        <>
          Each batch card has a <strong className="text-stone-200">Style</strong> button. Override the colour theme or accent images for that video independently, without changing global settings.
        </>
      ),
    },
    {
      target: 'batch-style-btn',
      title: 'Text overlays',
      description: 'Burn a caption into the footage. Pick the font, colour, size and position. Save your favourite settings as a preset to apply across batches in one click.',
    },
    {
      target: 'advanced-btn',
      title: 'Advanced settings',
      description: (
        <>
          Click <strong className="text-stone-200">⚙</strong> to open advanced options. Change the <strong className="text-stone-200">image source</strong> (Unsplash, Pexels, or both), and add <strong className="text-stone-200">accent images</strong>: branded photos in blue, red, or gold sprinkled into ~20% of your frames for a signature look.
        </>
      ),
    },
    {
      target: 'variants-btn',
      title: 'Colour variants',
      onEnter: onOpenVariants,
      description: 'Generate the same video in multiple colour styles at once, perfect for A/B testing before posting. Select which themes you want below, then hit Generate variants.',
    },
    {
      target: 'gen-dropdown',
      title: 'Preview before generating',
      description: 'Click ▾ then "Preview images first →" to browse and curate your images before spending a credit on the full render.',
    },
    {
      target: 'generate-btn',
      title: 'Generate',
      description: 'Hit Generate to create your video. Each render uses 1 credit. Watch it build in real-time in the panel on the right.',
    },
  ], [onOpenPrompt, onOpenVariants])

  const step = stepIdx >= 0 ? STEPS[stepIdx] : null

  // Track target element position (handles scroll/resize)
  useLayoutEffect(() => {
    if (!active || !step) return
    function update() {
      setRect(getTargetRect(step!.target))
      animFrame.current = requestAnimationFrame(update)
    }
    animFrame.current = requestAnimationFrame(update)
    return () => cancelAnimationFrame(animFrame.current)
  }, [active, step])

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
    if (active) setStepIdx(isFirstVisit ? -1 : 0)
  }, [active, isFirstVisit])

  // Call onEnter when a step becomes active + scroll target into view
  useEffect(() => {
    if (!active || stepIdx < 0) return
    STEPS[stepIdx]?.onEnter?.()
    const el = document.querySelector(`[data-tour="${STEPS[stepIdx].target}"]`)
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

  // ── Welcome screen (step -1, first visit only) ──────────────────────────────
  if (stepIdx === -1) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 px-4">
        <div
          className="w-full max-w-md rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl p-8"
          onClick={e => e.stopPropagation()}
        >
          <img src="/logo%20w%20text.png" alt="PassiveClip" className="mx-auto mb-5 h-14 w-auto" />

          <h2 className="text-center text-lg font-semibold text-stone-100 mb-2">
            Welcome to PassiveClip
          </h2>
          <p className="text-center text-sm text-stone-400 mb-6 leading-relaxed">
            Turn search terms into short-form videos in seconds. No editing required.
            Just add your topics, pick a visual style, and hit Generate.
          </p>

          <ul className="space-y-3 mb-8">
            {[
              { icon: '🔍', label: 'Add search terms', detail: 'Each batch of terms becomes one video' },
              { icon: '🎨', label: 'Choose a colour theme', detail: 'Dark, sepia, monochrome and more' },
              { icon: '⚡', label: 'Generate & download', detail: 'Your MP4 is ready in under a minute' },
            ].map(({ icon, label, detail }) => (
              <li key={label} className="flex items-start gap-3">
                <span className="mt-0.5 text-base leading-none">{icon}</span>
                <span className="text-sm text-stone-300">
                  <strong className="text-stone-100">{label}</strong>
                  <span className="text-stone-500">: {detail}</span>
                </span>
              </li>
            ))}
          </ul>

          <a
            href="https://www.passiveclip.com/tutorial"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full rounded-lg border border-stone-700 py-2.5 text-sm text-stone-400 hover:text-stone-200 hover:border-stone-500 transition mb-3"
          >
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-500 shrink-0">
              <svg className="w-2.5 h-2.5 ml-0.5" viewBox="0 0 10 12" fill="white"><path d="M0 0l10 6-10 6z"/></svg>
            </span>
            Watch tutorial (2 min)
          </a>

          <div className="flex gap-3">
            <button
              onClick={handleClose}
              className="flex-1 rounded-lg border border-stone-700 py-2.5 text-sm text-stone-400 hover:text-stone-200 hover:border-stone-500 transition"
            >
              Skip
            </button>
            <button
              onClick={() => setStepIdx(0)}
              className="flex-1 rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition"
            >
              Show me around →
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Spotlight tour (steps 0–6) ───────────────────────────────────────────────
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

        <h3 className="text-sm font-semibold text-stone-100 mb-1">{step!.title}</h3>
        <div className="text-xs text-stone-400 leading-relaxed">{step!.description}</div>

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
