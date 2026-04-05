import { useEffect, useRef, useState } from 'react'

interface Props {
  items: string[]
  align?: 'left' | 'right'
}

export default function JobMetaPopover({ items, align = 'right' }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target
      if (rootRef.current && target instanceof Node && !rootRef.current.contains(target)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <div
      ref={rootRef}
      className="relative flex-shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-stone-700 bg-stone-800 text-stone-400 transition hover:border-stone-500 hover:text-stone-200"
        aria-label="Show job metadata"
        aria-expanded={open}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
          <circle cx="10" cy="10" r="7" />
          <line x1="10" y1="8" x2="10" y2="13" />
          <circle cx="10" cy="5.5" r="0.75" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute top-full z-50 mt-2 w-60 rounded-xl border border-stone-700 bg-stone-900 p-3 shadow-2xl ${
            align === 'left' ? 'left-0' : 'right-0'
          }`}
        >
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-stone-500">Metadata</p>
          <div className="flex flex-wrap gap-1.5">
            {items.map(item => (
              <span key={item} className="rounded-md bg-stone-800 px-2 py-1 text-xs text-stone-300">
                {item}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
