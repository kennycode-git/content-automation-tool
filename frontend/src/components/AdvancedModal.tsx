/**
 * AdvancedModal.tsx
 *
 * Centered modal for advanced settings: saved presets, extractor model,
 * image source, accent images, max images per query, allow repeats.
 */

import { useEffect, useRef, useState } from 'react'
import PresetManager from './PresetManager'
import type { VideoSettings } from './SettingsPanel'
import { listUserPhilosophers, createUserPhilosopher, deleteUserPhilosopher, uploadPhilosopherImages } from '../lib/api'
import type { UserPhilosopher } from '../lib/api'

const ACCENT_OPTIONS = [
  { value: null,     label: 'None',   dot: 'bg-stone-600' },
  { value: 'blue',   label: 'Blue',   dot: 'bg-blue-500' },
  { value: 'red',    label: 'Red',    dot: 'bg-red-500' },
  { value: 'gold',   label: 'Gold',   dot: 'bg-amber-400' },
  { value: 'purple', label: 'Purple', dot: 'bg-purple-500' },
]

interface Props {
  settings: VideoSettings
  imageSource: 'auto' | 'unsplash' | 'pexels' | 'both'
  accentFolder: string | null
  autoMaxPerQuery: number
  onSettingsChange: (s: VideoSettings) => void
  onImageSourceChange: (v: 'auto' | 'unsplash' | 'pexels' | 'both') => void
  onAccentFolderChange: (v: string | null) => void
  onPresetApplied: (name: string) => void
  onClose: () => void
}

function UserPhilosopherManager() {
  const [philosophers, setPhilosophers] = useState<UserPhilosopher[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    listUserPhilosophers().then(data => { setPhilosophers(data); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const created = await createUserPhilosopher(newName.trim())
      setPhilosophers(prev => [...prev, created])
      setNewName('')
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(key: string) {
    await deleteUserPhilosopher(key)
    setPhilosophers(prev => prev.filter(p => p.key !== key))
  }

  async function handleUpload(key: string, files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(prev => ({ ...prev, [key]: true }))
    try {
      const result = await uploadPhilosopherImages(key, Array.from(files))
      setPhilosophers(prev => prev.map(p => p.key === key ? { ...p, image_count: p.image_count + result.uploaded } : p))
    } catch { /* ignore */ } finally {
      setUploading(prev => ({ ...prev, [key]: false }))
    }
  }

  return (
    <div>
      <p className="text-xs text-stone-400 mb-2">My philosophers</p>
      {loading ? (
        <p className="text-[10px] text-stone-600">Loading…</p>
      ) : (
        <div className="space-y-1.5">
          {philosophers.map(p => (
            <div key={p.key} className="flex items-center gap-2 bg-stone-800 rounded-lg px-2.5 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-stone-200 truncate">{p.name}</p>
                <p className="text-[9px] text-stone-500">{p.image_count} image{p.image_count !== 1 ? 's' : ''}</p>
              </div>
              <button
                onClick={() => fileInputRefs.current[p.key]?.click()}
                disabled={uploading[p.key]}
                className="text-[10px] text-stone-400 hover:text-stone-200 transition disabled:opacity-40"
                title="Upload images"
              >
                {uploading[p.key] ? '…' : '↑'}
              </button>
              <input
                ref={el => { fileInputRefs.current[p.key] = el }}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={e => handleUpload(p.key, e.target.files)}
              />
              <button
                onClick={() => handleDelete(p.key)}
                className="text-[10px] text-stone-600 hover:text-red-400 transition"
                title="Delete"
              >✕</button>
            </div>
          ))}
          {philosophers.length === 0 && (
            <p className="text-[10px] text-stone-600 italic">No custom philosophers yet.</p>
          )}
          {/* Create new */}
          <div className="flex gap-1.5 pt-1">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="New philosopher name…"
              maxLength={50}
              className="flex-1 bg-stone-800 border border-stone-700 rounded-lg px-2 py-1.5 text-[11px] text-stone-200 focus:outline-none focus:border-stone-500"
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="px-2.5 py-1.5 rounded-lg bg-stone-700 text-[11px] text-stone-200 hover:bg-stone-600 transition disabled:opacity-40"
            >
              {creating ? '…' : 'Add'}
            </button>
          </div>
          {createError && <p className="text-[10px] text-red-400">{createError}</p>}
        </div>
      )}
    </div>
  )
}

export default function AdvancedModal({
  settings,
  imageSource,
  accentFolder,
  autoMaxPerQuery,
  onSettingsChange,
  onImageSourceChange,
  onAccentFolderChange,
  onPresetApplied,
  onClose,
}: Props) {
  const [hoveredAccent, setHoveredAccent] = useState<string | null>(null)

  function update(patch: Partial<VideoSettings>) {
    onSettingsChange({ ...settings, ...patch })
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-stone-700 bg-stone-900 p-6 space-y-5 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-200">Advanced settings</h2>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-200">✕</button>
        </div>

        {/* Saved presets */}
        <div>
          <p className="mb-2 text-xs text-stone-400">Custom presets</p>
          <PresetManager
            currentSettings={settings as unknown as Record<string, unknown>}
            onApply={(s, name) => { onSettingsChange({ ...settings, ...s }); onPresetApplied(name) }}
          />
        </div>

        {/* Extractor model */}
        <hr className="border-stone-800" />
        <div>
          <p className="mb-2 text-xs text-stone-400">Extractor model</p>
          <select
            value={imageSource}
            onChange={e => onImageSourceChange(e.target.value as 'auto' | 'unsplash' | 'pexels' | 'both')}
            className="w-full rounded-lg border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-100 focus:outline-none focus:border-brand-500"
          >
            <option value="auto">Auto (recommended)</option>
            <option value="unsplash">Unsplash</option>
            <option value="pexels">Pexels</option>
          </select>
        </div>

        {/* Accent images */}
        <div>
          <p className="text-xs text-stone-400 mb-2">
            Accent images{' '}
            <span className="text-stone-600">(~20% of frames, ungraded)</span>
          </p>
          <div className="grid grid-cols-5 gap-2">
            {ACCENT_OPTIONS.map(opt => (
              <div
                key={opt.value ?? 'none'}
                className="relative"
                onMouseEnter={() => opt.value && setHoveredAccent(opt.value)}
                onMouseLeave={() => setHoveredAccent(null)}
              >
                <button
                  onClick={() => onAccentFolderChange(opt.value)}
                  className={`w-full flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-lg border text-xs transition ${
                    accentFolder === opt.value
                      ? 'border-brand-500 bg-brand-500/10 text-stone-100'
                      : 'border-stone-700 bg-stone-800 text-stone-400 hover:border-stone-500 hover:text-stone-200'
                  }`}
                >
                  <span className={`w-3 h-3 rounded-full flex-shrink-0 ${opt.dot}`} />
                  {opt.label}
                </button>

                {/* Eye-hover preview popup */}
                {opt.value && hoveredAccent === opt.value && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-28 rounded-lg border border-stone-600 bg-stone-900 shadow-xl overflow-hidden z-50 pointer-events-none">
                    <div className="relative w-full aspect-[9/16] bg-stone-950 flex items-center justify-center">
                      <video
                        key={opt.value}
                        src={`/accent-previews/${opt.value}.mp4`}
                        autoPlay
                        muted
                        loop
                        playsInline
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      <span className="text-xs text-stone-600 select-none">Preview</span>
                    </div>
                    <div className="px-2 py-1.5 text-xs text-stone-400 border-t border-stone-700">
                      {opt.label} accent
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Max images per query */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-stone-400">Max images per query</span>
            <div className="flex items-center gap-2">
              {settings.max_per_query === autoMaxPerQuery ? (
                <span className="text-[10px] text-amber-500/80 bg-amber-500/10 px-1.5 py-0.5 rounded">Auto</span>
              ) : (
                <button
                  onClick={() => update({ max_per_query: autoMaxPerQuery })}
                  className="text-[10px] text-stone-500 hover:text-amber-400 transition"
                  title={`Reset to auto (${autoMaxPerQuery})`}
                >
                  Reset to auto ({autoMaxPerQuery})
                </button>
              )}
              <span className="text-xs font-mono text-stone-300">{settings.max_per_query}</span>
            </div>
          </div>
          <input
            type="range"
            min={1}
            max={30}
            step={1}
            value={settings.max_per_query}
            onChange={e => update({ max_per_query: parseInt(e.target.value) })}
            className="w-full accent-brand-500"
          />
        </div>

        <hr className="border-stone-800" />

        {/* My Philosophers */}
        <div>
          <UserPhilosopherManager />
        </div>
      </div>
    </div>
  )
}
