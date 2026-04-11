import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

export const TOUR_STORAGE_KEY = 'cogito_tour_seen'

export type TutorialMode = 'images' | 'clips' | 'layered'
export type TutorialPath = TutorialMode | 'all' | 'selector'

interface TourStep {
  mode: TutorialMode
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

interface Props {
  active: boolean
  isFirstVisit: boolean
  startPath: TutorialPath
  onClose: () => void
  onOpenPrompt: () => void
  onOpenVariants: () => void
  onModeChange: (mode: TutorialMode) => void
}

const MODE_INTRO: Record<TutorialMode, { title: string; body: string }> = {
  images: {
    title: 'How to batch produce image carousel videos',
    body: 'This is the quickest way to turn a list of ideas into polished image videos at scale. Build your batches, set the visual style once, then preview or generate when you are ready.',
  },
  clips: {
    title: 'How to make polished short-form videos from stock footage',
    body: 'This workflow keeps things fast but still gives you control. Drop in your terms, let PassiveClip pull strong clips, then shape the pacing and transitions into something that already feels edited for you.',
  },
  layered: {
    title: 'Make production-grade videos with layered editing',
    body: 'This is the cinematic option. Pair moving background footage with animated image sequences, tune the blend, and create something that feels far more premium without a full editing timeline.',
  },
}

function getTargetRect(target: string): Rect | null {
  const el = document.querySelector(`[data-tour="${target}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

function getScrollableParent(el: HTMLElement | null): HTMLElement | null {
  let current = el?.parentElement ?? null
  while (current) {
    const style = window.getComputedStyle(current)
    const overflowY = style.overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight) {
      return current
    }
    current = current.parentElement
  }
  return null
}

export default function VideoTutorial({
  active,
  isFirstVisit,
  startPath,
  onClose,
  onOpenPrompt,
  onOpenVariants,
  onModeChange,
}: Props) {
  const [path, setPath] = useState<TutorialPath>('selector')
  const [stepIdx, setStepIdx] = useState(0)
  const [introMode, setIntroMode] = useState<TutorialMode | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const animFrame = useRef<number>(0)

  const imageSteps: TourStep[] = useMemo(() => [
    {
      mode: 'images',
      target: 'batch-editor',
      title: 'Search terms and batches',
      description: 'Add your search terms here. Each card becomes a separate video, so you can generate several videos in one run by adding multiple batches.',
    },
    {
      mode: 'images',
      target: 'batch-editor',
      title: 'Classic text mode',
      description: (
        <>
          If you want to move faster, switch to <strong className="text-stone-200">Classic text</strong>. You can use AI to draft a full batch list in the right format.{' '}
          <button onClick={onOpenPrompt} className="text-brand-400 underline hover:text-brand-300 transition">
            Copy example prompt
          </button>
        </>
      ),
    },
    {
      mode: 'images',
      target: 'theme-selector',
      title: 'Video settings',
      description: 'Set the resolution, how long each image stays on screen, and the full video length. Portrait 1080x1920 usually works best for TikTok, Reels, and Shorts.',
    },
    {
      mode: 'images',
      target: 'theme-selector',
      title: 'Colour themes',
      description: 'Choose the overall look of the video. Dark Tones and Low Exposure work especially well if you plan to add white text overlays.',
    },
    {
      mode: 'images',
      target: 'batch-style-btn',
      title: 'Per-batch style',
      description: 'Each batch has its own Style control, so you can override theme, accent images, overlays, and more without changing the global settings.',
    },
    {
      mode: 'images',
      target: 'advanced-btn',
      title: 'Advanced settings',
      description: 'Open advanced options to change the image source, add accent images, and control how many images are gathered per search term.',
    },
    {
      mode: 'images',
      target: 'variants-btn',
      title: 'Colour variants',
      onEnter: onOpenVariants,
      description: 'If you want to compare a few looks, you can make different colour versions of the same video in one go.',
    },
    {
      mode: 'images',
      target: 'gen-dropdown',
      title: 'Preview first',
      description: 'Preview images first if you want to review and curate the image pool before spending a credit on the final render.',
    },
    {
      mode: 'images',
      target: 'generate-btn',
      title: 'Generate',
      description: 'Generate makes the final video. Each batch becomes its own render and uses 1 credit.',
    },
  ], [onOpenPrompt, onOpenVariants])

  const clipSteps: TourStep[] = useMemo(() => [
    {
      mode: 'clips',
      target: 'batch-editor',
      title: 'Clip prompts',
      description: 'Use one batch for each clip video you want to make. These search terms find stock footage rather than still images.',
    },
    {
      mode: 'clips',
      target: 'clips-resolution-theme',
      title: 'Resolution and grade',
      description: 'Set the frame size and the overall colour look for the whole edit.',
    },
    {
      mode: 'clips',
      target: 'clips-pacing',
      title: 'Clip count and duration',
      description: 'Choose how many clips to pull for each search and set the max clip duration. This changes how busy or calm the finished edit feels.',
    },
    {
      mode: 'clips',
      target: 'clips-transition',
      title: 'Transitions',
      description: 'Pick how clips move into one another. Cut feels quick. Fade or crossfade feels softer.',
    },
    {
      mode: 'clips',
      target: 'clips-generate',
      title: 'Generate or preview',
      description: 'You can generate straight away, or preview the clips first if you want to trim them, reorder them, and choose the exact shots yourself.',
    },
  ], [])

  const layeredSteps: TourStep[] = useMemo(() => [
    {
      mode: 'layered',
      target: 'layered-image-search',
      title: 'Build the layered batch',
      description: 'Start by adding the image search terms for your foreground layer. Each batch becomes its own finished layered video.',
    },
    {
      mode: 'layered',
      target: 'layered-bg-panel',
      title: 'Search the background videos',
      description: 'Right inside each layered batch, search for the background footage that will sit underneath the image sequence. You can select up to 5 videos and PassiveClip will blend between them for you.',
    },
    {
      mode: 'layered',
      target: 'layered-bg-favorites',
      title: 'Save favourites for quick reuse',
      description: 'If you find a background clip you love, save it to Favourites so it is easy to reuse on the next batch without searching again.',
    },
    {
      mode: 'layered',
      target: 'settings-presets',
      title: 'Use presets to move faster',
      description: 'This area covers saved presets and quick timing presets. It is the fastest way to reuse a look, duration, and layered setup across future videos.',
    },
    {
      mode: 'layered',
      target: 'theme-selector',
      title: 'Shape the full video settings',
      description: 'Set the resolution, seconds per image, total length, and colour grade for the final layered render here before you fine-tune the blend.',
    },
    {
      mode: 'layered',
      target: 'layered-grade-target',
      title: 'Choose what gets graded',
      description: 'You can apply the colour grade to the foreground images, the background videos, or both. That makes it easy to keep one layer natural while styling the other.',
    },
    {
      mode: 'layered',
      target: 'layered-opacity',
      title: 'Foreground image opacity',
      description: 'Use this near the end to decide how dominant the image layer should feel. Lower values let the motion underneath breathe more.',
    },
    {
      mode: 'layered',
      target: 'layered-bg-opacity',
      title: 'Background video opacity',
      description: 'This controls how present the moving background feels behind the images. It is useful when you want the footage to support the scene without overpowering it.',
    },
    {
      mode: 'layered',
      target: 'layered-generate',
      title: 'Preview and generate',
      description: 'Preview first if you want to check the image pool. When you are happy, generate the final layered video with your chosen backgrounds, presets, and opacity settings.',
    },
  ], [])

  const steps = useMemo(() => {
    if (path === 'images') return imageSteps
    if (path === 'clips') return clipSteps
    if (path === 'layered') return layeredSteps
    if (path === 'all') return [...imageSteps, ...clipSteps, ...layeredSteps]
    return []
  }, [clipSteps, imageSteps, layeredSteps, path])

  const step = path !== 'selector' ? steps[stepIdx] : null

  const scrollToCurrentTarget = useCallback((target: string) => {
    let attempts = 0
    const run = () => {
      const el = document.querySelector(`[data-tour="${target}"]`) as HTMLElement | null
      if (el) {
        const behavior = attempts === 0 ? 'auto' : 'smooth'
        const scroller = getScrollableParent(el)
        if (scroller) {
          const scrollerRect = scroller.getBoundingClientRect()
          const rect = el.getBoundingClientRect()
          const relativeTop = rect.top - scrollerRect.top + scroller.scrollTop
          const desiredTop = Math.max(0, relativeTop - Math.max(80, (scroller.clientHeight - rect.height) / 2))
          scroller.scrollTo({ top: desiredTop, behavior })
        } else {
          const rect = el.getBoundingClientRect()
          const absoluteTop = window.scrollY + rect.top
          const desiredTop = Math.max(0, absoluteTop - Math.max(120, (window.innerHeight - rect.height) / 2))
          window.scrollTo({ top: desiredTop, behavior })
          document.documentElement.scrollTo?.({ top: desiredTop, behavior })
          document.body.scrollTo?.({ top: desiredTop, behavior })
        }
      }
      attempts += 1
      if (attempts < 7) {
        window.setTimeout(run, attempts < 2 ? 120 : 260)
      }
    }
    run()
  }, [])

  useEffect(() => {
    if (!active) return
    setPath(startPath)
    setStepIdx(0)
    if (startPath === 'images' || startPath === 'clips' || startPath === 'layered') setIntroMode(startPath)
    else if (startPath === 'all') setIntroMode('images')
    else setIntroMode(null)
  }, [active, startPath])

  useLayoutEffect(() => {
    if (!active || !step || introMode) return
    const currentStep = step
    function update() {
      setRect(getTargetRect(currentStep.target))
      animFrame.current = requestAnimationFrame(update)
    }
    animFrame.current = requestAnimationFrame(update)
    return () => cancelAnimationFrame(animFrame.current)
  }, [active, introMode, step])

  const handleClose = useCallback(() => {
    localStorage.setItem(TOUR_STORAGE_KEY, 'true')
    onClose()
  }, [onClose])

  const handleNext = useCallback(() => {
    if (introMode) {
      setIntroMode(null)
      return
    }
    if (stepIdx < steps.length - 1) {
      const nextIdx = stepIdx + 1
      const nextStep = steps[nextIdx]
      setStepIdx(nextIdx)
      if (nextStep && nextStep.mode !== steps[stepIdx]?.mode) {
        setIntroMode(nextStep.mode)
      }
    } else {
      handleClose()
    }
  }, [handleClose, introMode, stepIdx, steps])

  const handlePrev = useCallback(() => {
    if (introMode) {
      const currentMode = introMode
      const firstIndexForMode = steps.findIndex(s => s.mode === currentMode)
      const prevIndex = firstIndexForMode - 1
      if (prevIndex >= 0) {
        setIntroMode(null)
        setStepIdx(prevIndex)
      }
      return
    }
    setStepIdx(i => Math.max(0, i - 1))
  }, [introMode, steps])

  useEffect(() => {
    if (!active || !step || introMode) return
    const currentStep = step
    onModeChange(currentStep.mode)
    currentStep.onEnter?.()
    const t = window.setTimeout(() => {
      scrollToCurrentTarget(currentStep.target)
    }, 120)
    return () => window.clearTimeout(t)
  }, [active, introMode, onModeChange, scrollToCurrentTarget, step])

  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose()
      if (path !== 'selector' && (e.key === 'ArrowRight' || e.key === 'Enter')) handleNext()
      if (path !== 'selector' && e.key === 'ArrowLeft') handlePrev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, handleClose, handleNext, handlePrev, path])

  if (!active) return null

  if (path === 'selector') {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 px-4">
        <div className="w-full max-w-lg rounded-2xl border border-stone-700 bg-stone-900 p-8 shadow-2xl" onClick={e => e.stopPropagation()}>
          <img src="/logo%20w%20text.png" alt="PassiveClip" className="mx-auto mb-5 h-14 w-auto" />
          <h2 className="mb-2 text-center text-lg font-semibold text-stone-100">Choose your tour</h2>
          <p className="mb-6 text-center text-sm leading-relaxed text-stone-400">
            PassiveClip can make videos from images, stock clips, or layered image and video combinations.
            Pick the workflow you want to learn first.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <button onClick={() => { setPath('images'); setIntroMode('images') }} className="rounded-xl border border-stone-700 bg-stone-800 px-4 py-4 text-left transition hover:border-stone-500 hover:bg-stone-800/80">
              <p className="text-sm font-semibold text-stone-100">Images</p>
              <p className="mt-1 text-xs text-stone-500">Turn search terms into image-based videos with themes, overlays, and accent images.</p>
            </button>
            <button onClick={() => { setPath('clips'); setIntroMode('clips') }} className="rounded-xl border border-stone-700 bg-stone-800 px-4 py-4 text-left transition hover:border-stone-500 hover:bg-stone-800/80">
              <p className="text-sm font-semibold text-stone-100">Video Clips</p>
              <p className="mt-1 text-xs text-stone-500">Search stock footage, preview clips, trim them, and turn them into a finished video.</p>
            </button>
            <button onClick={() => { setPath('layered'); setIntroMode('layered') }} className="rounded-xl border border-stone-700 bg-stone-800 px-4 py-4 text-left transition hover:border-stone-500 hover:bg-stone-800/80">
              <p className="text-sm font-semibold text-stone-100">Layered</p>
              <p className="mt-1 text-xs text-stone-500">Place animated images over one or more looping background videos.</p>
            </button>
            <button onClick={() => { setPath('all'); setIntroMode('images') }} className="rounded-xl border border-brand-500/30 bg-brand-500/10 px-4 py-4 text-left transition hover:border-brand-500/50 hover:bg-brand-500/15">
              <p className="text-sm font-semibold text-brand-300">Not sure</p>
              <p className="mt-1 text-xs text-stone-400">Show me everything so I can see what fits best.</p>
            </button>
          </div>

          <div className="mt-6 flex gap-3">
            <button onClick={handleClose} className="flex-1 rounded-lg border border-stone-700 py-2.5 text-sm text-stone-400 transition hover:border-stone-500 hover:text-stone-200">
              {isFirstVisit ? 'Skip for now' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (introMode) {
    const intro = MODE_INTRO[introMode]
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 px-4">
        <div className="w-full max-w-md rounded-2xl border border-stone-700 bg-stone-900 p-8 shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="mb-5 flex flex-col items-center">
            <img src="/logo.png" alt="" className="h-12 w-auto" />
            <img src="/just%20text.png" alt="PassiveClip" className="mt-2 h-6 w-auto" />
          </div>
          <h2 className="mb-2 text-center text-lg font-semibold text-stone-100">{intro.title}</h2>
          <p className="mb-6 text-center text-sm leading-relaxed text-stone-400">{intro.body}</p>
          <div className="flex gap-3">
            <button onClick={handleClose} className="flex-1 rounded-lg border border-stone-700 py-2.5 text-sm text-stone-400 transition hover:border-stone-500 hover:text-stone-200">
              Skip
            </button>
            <button onClick={() => setIntroMode(null)} className="flex-1 rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700">
              Start
            </button>
          </div>
        </div>
      </div>
    )
  }

  const PAD = 10
  const spotTop = (rect?.top ?? 0) - PAD
  const spotLeft = (rect?.left ?? 0) - PAD
  const spotWidth = (rect?.width ?? 0) + PAD * 2
  const spotHeight = (rect?.height ?? 0) + PAD * 2

  if (!rect) {
    return <div className="fixed inset-0 z-[199]" style={{ background: 'transparent' }} onClick={handleClose} />
  }

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
      <div className="fixed inset-0 z-[199]" style={{ background: 'transparent' }} onClick={handleClose} />

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

      <div
        className="fixed z-[201] w-80 rounded-xl border border-stone-600 bg-stone-800 p-4 shadow-2xl"
        style={{ top: tooltipTop, left: rawLeft, transition: 'top 0.25s ease, left 0.25s ease' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-1.5">
          {steps.map((_, i) => (
            <div key={i} className={`h-1.5 rounded-full transition-all ${i === stepIdx ? 'w-4 bg-brand-500' : 'w-1.5 bg-stone-600'}`} />
          ))}
          <span className="ml-auto text-xs text-stone-500">{stepIdx + 1} / {steps.length}</span>
        </div>

        <h3 className="mb-1 text-sm font-semibold text-stone-100">{step?.title}</h3>
        <div className="text-xs leading-relaxed text-stone-400">{step?.description}</div>

        <div className="mt-4 flex items-center justify-between">
          <button onClick={handleClose} className="text-xs text-stone-600 transition hover:text-stone-400">
            Skip tour
          </button>
          <div className="flex gap-2">
            {stepIdx > 0 && (
              <button onClick={handlePrev} className="rounded-lg border border-stone-700 px-3 py-1.5 text-xs text-stone-400 transition hover:border-stone-500 hover:text-stone-200">
                Back
              </button>
            )}
            <button onClick={handleNext} className="rounded-lg bg-brand-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700">
              {stepIdx < steps.length - 1 ? 'Next' : 'Done'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
