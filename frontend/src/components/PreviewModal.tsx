/**
 * PreviewModal.tsx
 *
 * Full-screen modal for reviewing and curating staged images before rendering.
 * Users can remove unwanted images and add their own via file picker or drag-drop.
 *
 * objectURLs created for locally-added files are tracked and revoked on unmount
 * to prevent memory leaks.
 */

import { useEffect, useRef, useState } from 'react'
import type { PreviewBatchResult } from '../lib/api'
import { uploadImages } from '../lib/api'

export interface ConfirmedBatch {
  batch_title: string | null
  search_terms: string[]
  images: Array<{ storage_path: string; display_url: string }>
}

interface CuratedImage {
  id: string              // stable key for React reconciliation
  storage_path: string    // '' while upload is pending
  display_url: string     // objectURL (user-added) or signed_url (staged)
  uploading?: boolean
  upload_failed?: boolean
}

interface CuratedBatch {
  batch_title: string | null
  search_terms: string[]
  images: CuratedImage[]
}

interface Props {
  batches: PreviewBatchResult[]
  onConfirm: (batches: ConfirmedBatch[]) => void
  onCancel: () => void
}

export default function PreviewModal({ batches, onConfirm, onCancel }: Props) {
  const [curatedBatches, setCuratedBatches] = useState<CuratedBatch[]>(() =>
    batches.map(b => ({
      batch_title: b.batch_title,
      search_terms: b.search_terms,
      images: b.images.map(img => ({
        id: crypto.randomUUID(),
        storage_path: img.storage_path,
        display_url: img.signed_url,
      })),
    }))
  )
  const [activeTab, setActiveTab] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const objectURLsRef = useRef<string[]>([])

  // Clear selection when switching tabs
  useEffect(() => {
    setSelectedIds(new Set())
  }, [activeTab])

  // Revoke all objectURLs on unmount
  useEffect(() => {
    return () => {
      for (const url of objectURLsRef.current) {
        URL.revokeObjectURL(url)
      }
    }
  }, [])

  function removeImage(batchIdx: number, imageId: string) {
    setCuratedBatches(prev =>
      prev.map((b, i) =>
        i === batchIdx ? { ...b, images: b.images.filter(img => img.id !== imageId) } : b
      )
    )
    setSelectedIds(prev => { const next = new Set(prev); next.delete(imageId); return next })
  }

  function removeSelected(batchIdx: number) {
    setCuratedBatches(prev =>
      prev.map((b, i) =>
        i === batchIdx ? { ...b, images: b.images.filter(img => !selectedIds.has(img.id)) } : b
      )
    )
    setSelectedIds(new Set())
  }

  function toggleSelect(imageId: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(imageId)) next.delete(imageId)
      else next.add(imageId)
      return next
    })
  }

  function toggleSelectAll(batchIdx: number) {
    const batch = curatedBatches[batchIdx]
    if (!batch) return
    const allIds = batch.images.map(img => img.id)
    const allSelected = allIds.every(id => selectedIds.has(id))
    setSelectedIds(allSelected ? new Set() : new Set(allIds))
  }

  async function addFiles(batchIdx: number, files: File[]) {
    if (files.length === 0) return

    // Create immediate placeholders with objectURLs
    const placeholders: CuratedImage[] = files.map(f => {
      const objectURL = URL.createObjectURL(f)
      objectURLsRef.current.push(objectURL)
      return {
        id: crypto.randomUUID(),
        storage_path: '',
        display_url: objectURL,
        uploading: true,
      }
    })

    setCuratedBatches(prev =>
      prev.map((b, i) =>
        i === batchIdx ? { ...b, images: [...b.images, ...placeholders] } : b
      )
    )

    // Upload in background
    try {
      const { paths } = await uploadImages(files)
      // Match uploaded paths back to placeholders by index
      setCuratedBatches(prev =>
        prev.map((b, i) => {
          if (i !== batchIdx) return b
          const images = b.images.map(img => {
            const placeholderIdx = placeholders.findIndex(p => p.id === img.id)
            if (placeholderIdx === -1) return img
            const path = paths[placeholderIdx]
            if (!path) return { ...img, uploading: false, upload_failed: true }
            return { ...img, storage_path: path, uploading: false }
          })
          return { ...b, images }
        })
      )
    } catch {
      // Mark all placeholders as failed
      setCuratedBatches(prev =>
        prev.map((b, i) => {
          if (i !== batchIdx) return b
          const failedIds = new Set(placeholders.map(p => p.id))
          const images = b.images.map(img =>
            failedIds.has(img.id) ? { ...img, uploading: false, upload_failed: true } : img
          )
          return { ...b, images }
        })
      )
    }
  }

  function handleFileInput(batchIdx: number, e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    addFiles(batchIdx, files)
  }

  function handleDrop(batchIdx: number, e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.type.startsWith('image/')
    )
    addFiles(batchIdx, files)
  }

  const anyUploading = curatedBatches.some(b => b.images.some(img => img.uploading))

  function handleConfirm() {
    const clean: ConfirmedBatch[] = curatedBatches
      .map(b => ({
        batch_title: b.batch_title,
        search_terms: b.search_terms,
        images: b.images
          .filter(img => !img.upload_failed && img.storage_path !== '')
          .map(img => ({ storage_path: img.storage_path, display_url: img.display_url })),
      }))
      .filter(b => b.images.length > 0)
    onConfirm(clean)
  }

  const batch = curatedBatches[activeTab] ?? curatedBatches[0]
  const renderBatchCount = curatedBatches.filter(b =>
    b.images.some(img => !img.upload_failed && img.storage_path !== '')
  ).length

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-stone-950/95 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-stone-800 bg-stone-900 px-6 py-4 shrink-0">
        <h2 className="text-base font-semibold text-stone-200">Preview & Select</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="rounded-lg border border-stone-700 px-4 py-1.5 text-sm text-stone-400 hover:border-stone-500 hover:text-stone-200 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={anyUploading || renderBatchCount === 0}
            className="rounded-lg bg-brand-500 px-5 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40 transition"
          >
            {anyUploading
              ? 'Uploading…'
              : renderBatchCount === 1
                ? 'Render 1 batch →'
                : `Render ${renderBatchCount} batches →`}
          </button>
        </div>
      </div>

      {/* Batch tabs (only when >1 batch) */}
      {curatedBatches.length > 1 && (
        <div className="flex gap-1 border-b border-stone-800 bg-stone-900 px-6 pt-2 shrink-0 overflow-x-auto">
          {curatedBatches.map((b, i) => (
            <button
              key={i}
              onClick={() => setActiveTab(i)}
              className={`shrink-0 rounded-t-lg px-4 py-2 text-xs font-medium transition ${
                i === activeTab
                  ? 'bg-brand-500 text-white'
                  : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              {b.batch_title ?? `Batch ${i + 1}`}
              <span className="ml-1.5 opacity-60">({b.images.length})</span>
            </button>
          ))}
        </div>
      )}

      {/* Controls bar — flush below header/tabs, outside scroll area */}
      <div className="shrink-0 border-b border-stone-800 bg-stone-900/80 px-6 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-xs text-stone-500">
            {batch.images.length} image{batch.images.length !== 1 ? 's' : ''}
            {batch.images.some(img => img.uploading) && (
              <span className="ml-2 text-brand-400">Uploading…</span>
            )}
          </span>
          {batch.images.length > 0 && (
            <button
              onClick={() => toggleSelectAll(activeTab)}
              className="text-xs text-stone-500 hover:text-stone-300 transition"
            >
              {batch.images.every(img => selectedIds.has(img.id)) ? 'Deselect all' : 'Select all'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={() => removeSelected(activeTab)}
              className="rounded-lg bg-red-900 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-800 transition"
            >
              Delete {selectedIds.size} selected
            </button>
          )}
          <label className="cursor-pointer rounded-lg border border-stone-700 px-3 py-1.5 text-xs text-stone-400 hover:border-stone-500 hover:text-stone-200 transition">
            + Add images
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={e => handleFileInput(activeTab, e)}
            />
          </label>
        </div>
      </div>

      {/* Main area */}
      <div
        className={`relative flex-1 overflow-y-auto p-6 transition ${
          dragOver ? 'ring-2 ring-inset ring-brand-500' : ''
        }`}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => handleDrop(activeTab, e)}
      >
        {/* Drag-over overlay */}
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-brand-500 bg-brand-500/5">
            <span className="text-sm font-medium text-brand-400">Drop images to add</span>
          </div>
        )}

        {batch.images.length === 0 ? (
          <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-stone-700">
            <p className="text-sm text-stone-600">No images yet. Add some or cancel.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {batch.images.map(img => {
              const isSelected = selectedIds.has(img.id)
              return (
                <div
                  key={img.id}
                  onClick={() => toggleSelect(img.id)}
                  className={`group relative aspect-[9/16] cursor-pointer overflow-hidden rounded-lg bg-stone-800 transition ${
                    isSelected ? 'ring-2 ring-brand-400 ring-offset-1 ring-offset-stone-950' : ''
                  }`}
                >
                  <img
                    src={img.display_url}
                    alt=""
                    className={`h-full w-full object-cover transition ${isSelected ? 'brightness-75' : ''}`}
                    loading="lazy"
                  />
                  {/* Selection checkmark */}
                  {isSelected && (
                    <div className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-500">
                      <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  )}
                  {/* Upload pending overlay */}
                  {img.uploading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-stone-900/70">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-400 border-t-transparent" />
                    </div>
                  )}
                  {/* Upload failed overlay */}
                  {img.upload_failed && (
                    <div className="absolute inset-0 flex items-center justify-center bg-red-950/80">
                      <span className="text-xs text-red-400">Failed</span>
                    </div>
                  )}
                  {/* Single remove button — stops propagation so it doesn't toggle selection */}
                  <button
                    onClick={e => { e.stopPropagation(); removeImage(activeTab, img.id) }}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-stone-900/80 text-stone-400 opacity-0 transition hover:bg-red-900 hover:text-red-300 group-hover:opacity-100"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
