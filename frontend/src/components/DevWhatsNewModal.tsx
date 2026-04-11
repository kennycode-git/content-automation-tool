import { useEffect, useState } from 'react'

export const DEV_WHATS_NEW_VERSION = '09/04/2026'
export const DEV_WHATS_NEW_STORAGE_KEY = `passiveclip_dev_whats_new_seen_${DEV_WHATS_NEW_VERSION}`

export interface DevWhatsNewCard {
  id: string
  title: string
  description: string
  href: string
  badge?: string
}

interface Props {
  open: boolean
  cards: DevWhatsNewCard[]
  onClose: () => void
  onOpenLink: (href: string) => void
}

export default function DevWhatsNewModal({ open, cards, onClose, onOpenLink }: Props) {
  const [expandedNext, setExpandedNext] = useState<'scheduling' | 'ai' | null>(null)

  useEffect(() => {
    if (!open) return
    const originalBodyOverflow = document.body.style.overflow
    const originalHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = originalBodyOverflow
      document.documentElement.style.overflow = originalHtmlOverflow
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[220] flex items-start justify-center overflow-y-auto overscroll-contain bg-black/80 px-3 py-4 sm:items-center sm:px-4 sm:py-6"
      onClick={onClose}
    >
      <div
        className="my-0 max-h-[calc(100dvh-2rem)] w-full max-w-5xl overflow-y-auto overscroll-contain rounded-[24px] border border-stone-700 bg-[radial-gradient(circle_at_top,_rgba(217,132,39,0.16),_transparent_38%),linear-gradient(180deg,_rgba(28,25,23,0.98),_rgba(18,16,14,0.98))] p-4 shadow-[0_32px_120px_rgba(0,0,0,0.55)] sm:my-auto sm:rounded-[28px] sm:p-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky -top-4 z-10 -mx-4 -mt-4 mb-4 flex items-start justify-between gap-4 border-b border-stone-800/70 bg-stone-900/95 px-4 py-4 backdrop-blur sm:static sm:m-0 sm:mb-0 sm:border-b-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-0">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-500/25 bg-brand-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-300">
              Updates
              <span className="text-stone-500">{DEV_WHATS_NEW_VERSION}</span>
            </div>
            <h2 className="text-xl font-semibold text-stone-100 sm:text-3xl">What&apos;s new in PassiveClip</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-400 sm:text-[15px]">
              We&apos;ve shipped a fresh batch of workflow fixes and upgrades across previews, layered editing, and the image tools.
              Jump straight into the parts you want to test.
            </p>
          </div>

          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-stone-700 bg-stone-900/70 text-stone-400 transition hover:border-stone-500 hover:text-stone-100"
            aria-label="Close updates modal"
          >
            X
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:mt-6 md:grid-cols-2 xl:grid-cols-3">
          {cards.map(card => (
            <button
              key={card.id}
              onClick={() => onOpenLink(card.href)}
              className="group rounded-2xl border border-stone-700 bg-stone-900/70 p-4 text-left transition hover:border-brand-500/40 hover:bg-stone-900"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-stone-100">{card.title}</h3>
                {card.badge && (
                  <span className="rounded-full border border-brand-500/20 bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-300">
                    {card.badge}
                  </span>
                )}
              </div>
              <p className="min-h-[52px] text-xs leading-5 text-stone-400">{card.description}</p>
              <div className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-brand-300 transition group-hover:text-brand-200">
                Try it
                <span aria-hidden="true">-&gt;</span>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-brand-500/20 bg-[linear-gradient(180deg,_rgba(217,132,39,0.14),_rgba(120,53,15,0.12))] p-4 sm:mt-6 sm:p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-300">What&apos;s next</p>
          <h3 className="mt-1 text-lg font-semibold text-stone-100">In the next update</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-orange-100/70">
            Here&apos;s what we&apos;re actively working towards.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <button
              onClick={() => setExpandedNext(v => v === 'scheduling' ? null : 'scheduling')}
              className="rounded-2xl border border-orange-300/15 bg-stone-950/30 p-4 text-left transition hover:border-orange-300/30"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-stone-100">Scheduling</p>
                  <p className="mt-1 text-xs text-orange-100/65">Planned once external platform approval is fully in place.</p>
                </div>
                <span className="text-brand-300">{expandedNext === 'scheduling' ? '-' : '+'}</span>
              </div>
              {expandedNext === 'scheduling' && (
                <p className="mt-3 text-xs leading-5 text-stone-300">
                  We&apos;re preparing the scheduling workflow so users can connect accounts and publish with confidence once the remaining platform permissions are approved.
                </p>
              )}
            </button>

            <button
              onClick={() => setExpandedNext(v => v === 'ai' ? null : 'ai')}
              className="rounded-2xl border border-orange-300/15 bg-stone-950/30 p-4 text-left transition hover:border-orange-300/30"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-stone-100">AI integration</p>
                  <p className="mt-1 text-xs text-orange-100/65">Faster searchable generation and smarter setup help.</p>
                </div>
                <span className="text-brand-300">{expandedNext === 'ai' ? '-' : '+'}</span>
              </div>
              {expandedNext === 'ai' && (
                <p className="mt-3 text-xs leading-5 text-stone-300">
                  We&apos;re aiming to make search-term creation much quicker with AI-assisted searchables, guided prompting, and faster workflow suggestions across the app.
                </p>
              )}
            </button>
          </div>
        </div>

        <div className="sticky -bottom-4 -mx-4 mt-4 flex flex-col gap-3 border-t border-stone-800 bg-stone-900/95 px-4 py-4 text-xs text-stone-500 backdrop-blur sm:static sm:mx-0 sm:mt-6 sm:flex-row sm:items-center sm:justify-between sm:bg-transparent sm:px-0 sm:pb-0 sm:backdrop-blur-0">
          <p>This modal only appears once per update unless you reopen it from the navbar.</p>
          <button
            onClick={onClose}
            className="rounded-lg border border-stone-700 px-3 py-2 text-stone-300 transition hover:border-stone-500 hover:text-stone-100"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
