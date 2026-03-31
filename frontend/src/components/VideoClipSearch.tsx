import { useRef } from 'react'

interface Props {
  terms: string[]
  onTermsChange: (terms: string[]) => void
  disabled?: boolean
}

export default function VideoClipSearch({ terms, onTermsChange, disabled }: Props) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const updateTerm = (idx: number, val: string) => {
    const next = [...terms]
    next[idx] = val
    onTermsChange(next)
  }

  const addTerm = () => {
    if (terms.length >= 3) return
    onTermsChange([...terms, ''])
    setTimeout(() => inputRefs.current[terms.length]?.focus(), 50)
  }

  const removeTerm = (idx: number) => {
    if (terms.length <= 1) return
    const next = terms.filter((_, i) => i !== idx)
    onTermsChange(next)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === 'Enter' && idx === terms.length - 1 && terms.length < 3) {
      e.preventDefault()
      addTerm()
    }
  }

  return (
    <div className="space-y-2">
      {terms.map((term, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <span className="text-stone-500 text-sm w-5 shrink-0 text-right">{idx + 1}.</span>
          <input
            ref={el => { inputRefs.current[idx] = el }}
            type="text"
            value={term}
            onChange={e => updateTerm(idx, e.target.value)}
            onKeyDown={e => handleKeyDown(e, idx)}
            placeholder={idx === 0 ? 'e.g. stoic philosopher walking' : 'e.g. ancient ruins sunset'}
            disabled={disabled}
            className="flex-1 bg-stone-800 border border-stone-700 rounded px-3 py-2 text-sm text-stone-100
                       placeholder-stone-500 focus:outline-none focus:border-brand-500
                       disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {terms.length > 1 && (
            <button
              onClick={() => removeTerm(idx)}
              disabled={disabled}
              className="text-stone-500 hover:text-stone-300 disabled:opacity-40 p-1 rounded
                         transition-colors shrink-0"
              title="Remove term"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 8h8" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      ))}

      {terms.length < 3 && (
        <button
          onClick={addTerm}
          disabled={disabled}
          className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-200
                     disabled:opacity-40 disabled:cursor-not-allowed transition-colors mt-1"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 4v8M4 8h8" strokeLinecap="round"/>
          </svg>
          Add search term
          <span className="text-stone-600">({terms.length}/3)</span>
        </button>
      )}
    </div>
  )
}
