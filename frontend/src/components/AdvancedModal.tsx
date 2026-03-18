/**
 * AdvancedModal.tsx
 *
 * Centered modal for advanced settings: saved presets, extractor model,
 * image source, accent images, max images per query, allow repeats.
 */

import { useState } from 'react'
import PresetManager from './PresetManager'
import type { VideoSettings } from './SettingsPanel'

const ACCENT_OPTIONS = [
  { value: null,   label: 'None', dot: 'bg-stone-600' },
  { value: 'blue', label: 'Blue', dot: 'bg-blue-500' },
  { value: 'red',  label: 'Red',  dot: 'bg-red-500' },
  { value: 'gold', label: 'Gold', dot: 'bg-amber-400' },
]

const PHILOSOPHER_OPTIONS = [
  { value: 'marcus_aurelius', label: 'Marcus Aurelius' },
  { value: 'seneca',          label: 'Seneca' },
  { value: 'epictetus',       label: 'Epictetus' },
  { value: 'nietzsche',       label: 'Nietzsche' },
  { value: 'socrates',        label: 'Socrates' },
  { value: 'aristotle',       label: 'Aristotle' },
]

interface Props {
  settings: VideoSettings
  imageSource: 'auto' | 'unsplash' | 'pexels' | 'both'
  uploadedOnly: boolean
  accentFolder: string | null
  philosopher: string | null
  gradePhilosopher: boolean
  onSettingsChange: (s: VideoSettings) => void
  onImageSourceChange: (v: 'auto' | 'unsplash' | 'pexels' | 'both') => void
  onUploadedOnlyChange: (v: boolean) => void
  onAccentFolderChange: (v: string | null) => void
  onPhilosopherChange: (v: string | null) => void
  onGradePhilosopherChange: (v: boolean) => void
  onPresetApplied: (name: string) => void
  onClose: () => void
}

export default function AdvancedModal({
  settings,
  imageSource,
  uploadedOnly,
  accentFolder,
  philosopher,
  gradePhilosopher,
  onSettingsChange,
  onImageSourceChange,
  onUploadedOnlyChange,
  onAccentFolderChange,
  onPhilosopherChange,
  onGradePhilosopherChange,
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
            currentSettings={settings}
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

        {/* Uploaded images only */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={uploadedOnly}
            onChange={e => onUploadedOnlyChange(e.target.checked)}
            className="accent-brand-500"
          />
          <span className="text-sm text-stone-300">Use uploaded images only</span>
        </label>

        {/* Accent images */}
        <div>
          <p className="text-xs text-stone-400 mb-2">
            Accent images{' '}
            <span className="text-stone-600">(~20% of frames, ungraded)</span>
          </p>
          <div className="grid grid-cols-4 gap-2">
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
            <span className="text-xs font-mono text-stone-300">{settings.max_per_query}</span>
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

        {/* Allow repeats */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.allow_repeats}
            onChange={e => update({ allow_repeats: e.target.checked })}
            className="accent-brand-500"
          />
          <span className="text-sm text-stone-300">Allow image repeats</span>
        </label>

        <hr className="border-stone-800" />

        {/* Select Philosopher — coming soon */}
        <div className="group/phil relative cursor-not-allowed select-none">
          <div className="pointer-events-none absolute bottom-full left-0 mb-2 w-60 rounded-lg border border-stone-600 bg-stone-900 px-3 py-2.5 shadow-xl opacity-0 group-hover/phil:opacity-100 transition-opacity z-50">
            <p className="text-xs font-semibold text-white mb-1">Philosopher Image Inserts</p>
            <p className="text-xs text-stone-300 leading-relaxed">Automatically inserts HD portrait images of your chosen philosopher into the video carousel alongside your search results.</p>
          </div>
          <div className="opacity-50">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-xs text-stone-400">Select philosopher</p>
              <span className="text-[9px] font-semibold tracking-wide bg-stone-800 text-stone-600 border border-stone-700/60 px-1.5 py-0.5 rounded-full">Soon</span>
            </div>
            <div className="grid grid-cols-3 gap-2 pointer-events-none">
              {PHILOSOPHER_OPTIONS.map(opt => (
                <div key={opt.value} className="flex items-center justify-center px-2 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-xs text-stone-500 text-center">
                  {opt.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
