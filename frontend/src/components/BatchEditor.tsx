/**
 * BatchEditor.tsx
 *
 * Dual-mode batch editor:
 * - Classic text mode: # Title delimited textarea (use # Batch Name as a section header)
 * - Visual mode: per-batch cards with individual textareas + optional image upload
 *
 * Each # block becomes a separate job when submitted.
 * classicText is persisted to localStorage so it survives page refresh.
 */

import { useEffect, useRef, useState } from 'react'
import { uploadImages } from '../lib/api'

const STORAGE_KEY = 'cogito_classic_text'
const DEFAULT_CLASSIC_TEXT =
  '# Stoicism\nmarble statue philosophy\nancient greece\nstoic stone\n\n# Existentialism\nmeditation silence\nminimalist monk'

export interface BatchOutput {
  title: string | null
  terms: string[]
  uploaded_image_paths?: string[]
}

interface VisualBatch {
  title: string
  terms: string
}

interface Props {
  onBatchesChange: (batches: BatchOutput[]) => void
  pendingReuse?: { title: string | null; terms: string[] } | null
  onReuseHandled?: () => void
  pendingBundles?: { title: string | null; terms: string[] }[] | null
  onBundlesHandled?: () => void
  onOpenPrompt?: () => void
}

function parseBatchText(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
}

function parseClassicIntoBatches(text: string): BatchOutput[] {
  const lines = text.split('\n')
  const batches: BatchOutput[] = []
  let title: string | null = null
  let terms: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#')) {
      if (terms.length > 0) batches.push({ title, terms })
      title = trimmed.slice(1).trim() || null
      terms = []
    } else if (trimmed) {
      terms.push(trimmed)
    }
  }
  if (terms.length > 0) batches.push({ title, terms })
  return batches
}

export default function BatchEditor({ onBatchesChange, pendingReuse, onReuseHandled, pendingBundles, onBundlesHandled, onOpenPrompt }: Props) {
  const [classicMode, setClassicMode] = useState(false)
  const [classicText, setClassicText] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_CLASSIC_TEXT }
    catch { return DEFAULT_CLASSIC_TEXT }
  })
  const [batches, setBatches] = useState<VisualBatch[]>([
    { title: 'Stoicism', terms: 'marble statue philosophy\nancient greece\nstoic stone' },
  ])
  const [uploadedPaths, setUploadedPaths] = useState<Record<number, string[]>>({})
  const [uploading, setUploading] = useState<Record<number, boolean>>({})

  function visualToBatchOutputs(vBatches: VisualBatch[], paths: Record<number, string[]>): BatchOutput[] {
    return vBatches.map((b, i) => ({
      title: b.title.trim() || null,
      terms: parseBatchText(b.terms),
      uploaded_image_paths: paths[i] ?? [],
    }))
  }

  // Emit initial batches on mount
  useEffect(() => {
    if (classicMode) {
      onBatchesChange(parseClassicIntoBatches(classicText))
    } else {
      onBatchesChange(visualToBatchOutputs(batches, uploadedPaths))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle duplicate request from parent — mode-aware
  const prevReuse = useRef<typeof pendingReuse>(null)
  useEffect(() => {
    if (!pendingReuse || pendingReuse === prevReuse.current) return
    prevReuse.current = pendingReuse
    if (!classicMode) {
      const newCard: VisualBatch = { title: pendingReuse.title ?? 'Duplicated', terms: pendingReuse.terms.join('\n') }
      const updated = [...batches, newCard]
      setBatches(updated)
      onBatchesChange(visualToBatchOutputs(updated, uploadedPaths))
    } else {
      const header = `# ${pendingReuse.title ?? 'Duplicated'}`
      const termStr = pendingReuse.terms.join('\n')
      const newBlock = `${header}\n${termStr}`
      setClassicText(newBlock)
      try { localStorage.setItem(STORAGE_KEY, newBlock) } catch { /* ignore */ }
      onBatchesChange(parseClassicIntoBatches(newBlock))
    }
    onReuseHandled?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingReuse])

  // Handle bundle load — mode-aware: appends # blocks in classic, adds cards in visual
  const prevBundles = useRef<typeof pendingBundles>(null)
  useEffect(() => {
    if (!pendingBundles || pendingBundles === prevBundles.current) return
    prevBundles.current = pendingBundles

    if (classicMode) {
      const blocks = pendingBundles.map(b =>
        `# ${b.title ?? 'Batch'}\n${b.terms.join('\n')}`
      ).join('\n\n')
      const newText = classicText.trim() ? `${classicText.trim()}\n\n${blocks}` : blocks
      setClassicText(newText)
      try { localStorage.setItem(STORAGE_KEY, newText) } catch { /* ignore */ }
      onBatchesChange(parseClassicIntoBatches(newText))
    } else {
      const newCards: VisualBatch[] = pendingBundles.map(b => ({
        title: b.title ?? 'Batch',
        terms: b.terms.join('\n'),
      }))
      const onlyEmptyBatch = batches.length === 1 && !batches[0].terms.trim()
      const updated = onlyEmptyBatch ? newCards : [...batches, ...newCards]
      setBatches(updated)
      onBatchesChange(visualToBatchOutputs(updated, uploadedPaths))
    }
    onBundlesHandled?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBundles])

  function handleClassicChange(text: string) {
    setClassicText(text)
    try { localStorage.setItem(STORAGE_KEY, text) } catch { /* ignore */ }
    onBatchesChange(parseClassicIntoBatches(text))
  }

  function handleBatchTermsChange(idx: number, terms: string) {
    const updated = batches.map((b, i) => (i === idx ? { ...b, terms } : b))
    setBatches(updated)
    onBatchesChange(visualToBatchOutputs(updated, uploadedPaths))
  }

  function handleBatchTitleChange(idx: number, title: string) {
    const updated = batches.map((b, i) => (i === idx ? { ...b, title } : b))
    setBatches(updated)
    onBatchesChange(visualToBatchOutputs(updated, uploadedPaths))
  }

  async function handleFileUpload(idx: number, files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(prev => ({ ...prev, [idx]: true }))
    try {
      const { paths } = await uploadImages(Array.from(files))
      setUploadedPaths(prev => {
        const next = { ...prev, [idx]: [...(prev[idx] ?? []), ...paths] }
        onBatchesChange(visualToBatchOutputs(batches, next))
        return next
      })
    } catch (e) {
      console.error('Image upload failed:', e)
    } finally {
      setUploading(prev => ({ ...prev, [idx]: false }))
    }
  }

  function addBatch() {
    const updated = [...batches, { title: `Batch ${batches.length + 1}`, terms: '' }]
    setBatches(updated)
    onBatchesChange(visualToBatchOutputs(updated, uploadedPaths))
  }

  function removeBatch(idx: number) {
    const updated = batches.filter((_, i) => i !== idx)
    const updatedPaths: Record<number, string[]> = {}
    updated.forEach((_, i) => {
      const origIdx = i < idx ? i : i + 1
      if (uploadedPaths[origIdx]) updatedPaths[i] = uploadedPaths[origIdx]
    })
    setBatches(updated)
    setUploadedPaths(updatedPaths)
    onBatchesChange(visualToBatchOutputs(updated, updatedPaths))
  }

  function handleClear() {
    setClassicText('')
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    setBatches([{ title: 'Batch 1', terms: '' }])
    setUploadedPaths({})
    onBatchesChange([])
  }

  function applyClassicToBatches() {
    const lines = classicText.split('\n')
    const result: VisualBatch[] = []
    let current: VisualBatch = { title: 'Batch 1', terms: '' }
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('#')) {
        if (current.terms.trim()) result.push(current)
        const title = trimmed.slice(1).trim() || `Batch ${result.length + 2}`
        current = { title, terms: '' }
      } else if (trimmed) {
        current.terms += (current.terms ? '\n' : '') + trimmed
      }
    }
    if (current.terms.trim()) result.push(current)
    const final = result.length ? result : [{ title: 'Batch 1', terms: '' }]
    setBatches(final)
    setUploadedPaths({})
    setClassicMode(false)
    onBatchesChange(visualToBatchOutputs(final, {}))
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-stone-300">Search terms</h2>
          {onOpenPrompt && (
            <button
              onClick={onOpenPrompt}
              className="flex items-center gap-1 text-xs text-stone-500 hover:text-brand-400 transition ml-2"
              title="Get search terms using AI"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.347a3.75 3.75 0 01-5.304 0l-.356-.356a5 5 0 010-7.072z" />
              </svg>
              Get terms with AI
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleClear}
            className="text-xs text-stone-600 hover:text-stone-400"
          >
            Clear
          </button>
          <button
            onClick={() => setClassicMode(m => !m)}
            className="text-xs text-brand-500 hover:underline"
          >
            {classicMode ? 'Visual editor' : 'Classic text'}
          </button>
        </div>
      </div>

      {classicMode ? (
        <div className="space-y-2">
          <textarea
            value={classicText}
            onChange={e => handleClassicChange(e.target.value)}
            rows={8}
            placeholder={"# Stoicism\nmarble statue philosophy\nancient greece\n\n# Existentialism\nmeditation silence"}
            className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 font-mono text-xs text-stone-100 placeholder-stone-600 focus:border-brand-500 focus:outline-none"
          />
          <p className="text-[11px] text-stone-600 leading-relaxed">
            One search term per line. Use <code className="font-mono text-stone-500"># Batch Title</code> to start a new batch — each batch becomes a separate video.
            Titles should be short and descriptive (e.g. <code className="font-mono text-stone-500"># stoicism_pt1</code>).
          </p>
          <button
            onClick={applyClassicToBatches}
            className="rounded-lg border border-stone-700 px-3 py-1.5 text-xs text-stone-400 hover:border-stone-500 hover:text-stone-200 transition"
          >
            Parse into visual batches →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {batches.map((batch, idx) => (
            <div key={idx} className="rounded-xl border border-stone-700 bg-stone-800 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-1 min-w-0 group">
                  <svg className="w-3 h-3 text-stone-600 group-focus-within:text-brand-500 flex-shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <input
                    value={batch.title}
                    onChange={e => handleBatchTitleChange(idx, e.target.value)}
                    className="bg-transparent text-sm font-semibold text-stone-100 focus:outline-none border-b border-dashed border-stone-600 hover:border-stone-400 focus:border-brand-500 transition-colors pb-0.5 min-w-0 w-full"
                    placeholder="Batch title…"
                  />
                </div>
                {batches.length > 1 && (
                  <button onClick={() => removeBatch(idx)} className="text-xs text-stone-600 hover:text-red-400 flex-shrink-0">
                    ✕ Remove
                  </button>
                )}
              </div>
              <textarea
                value={batch.terms}
                onChange={e => handleBatchTermsChange(idx, e.target.value)}
                rows={3}
                placeholder="one search term per line"
                className="w-full rounded-lg border border-stone-700 bg-stone-900 px-2 py-1.5 font-mono text-xs text-stone-100 placeholder-stone-600 focus:border-brand-500 focus:outline-none"
              />
              {/* Image upload */}
              <div className="mt-2 flex items-center gap-2">
                <label className="cursor-pointer rounded border border-stone-700 px-2 py-0.5 text-xs text-stone-400 hover:border-stone-500 hover:text-stone-200">
                  {uploading[idx] ? 'Uploading…' : 'Upload photos'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="hidden"
                    disabled={uploading[idx]}
                    onChange={e => handleFileUpload(idx, e.target.files)}
                  />
                </label>
                {(uploadedPaths[idx]?.length ?? 0) > 0 && (
                  <span className="text-xs text-stone-500">
                    {uploadedPaths[idx].length} photo{uploadedPaths[idx].length !== 1 ? 's' : ''} added
                  </span>
                )}
              </div>
            </div>
          ))}
          <button
            onClick={addBatch}
            className="text-xs text-brand-500 hover:underline"
          >
            + Add batch
          </button>
        </div>
      )}
    </div>
  )
}
