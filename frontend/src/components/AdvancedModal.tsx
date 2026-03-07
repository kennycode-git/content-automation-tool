/**
 * AdvancedModal.tsx
 *
 * Centered modal for advanced settings: saved presets, image source,
 * accent images, max images per query, allow repeats.
 */

import PresetManager from './PresetManager'
import type { VideoSettings } from './SettingsPanel'

interface Props {
  settings: VideoSettings
  uploadedOnly: boolean
  accentFolder: string | null
  onSettingsChange: (s: VideoSettings) => void
  onUploadedOnlyChange: (v: boolean) => void
  onAccentFolderChange: (v: string | null) => void
  onPresetApplied: (name: string) => void
  onClose: () => void
}

export default function AdvancedModal({
  settings,
  uploadedOnly,
  accentFolder,
  onSettingsChange,
  onUploadedOnlyChange,
  onAccentFolderChange,
  onPresetApplied,
  onClose,
}: Props) {
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

        {/* Image source */}
        <hr className="border-stone-800" />
        <div className="space-y-2">
          <p className="text-xs text-stone-400">Image source</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="image-source"
              checked={!uploadedOnly}
              onChange={() => onUploadedOnlyChange(false)}
              className="accent-brand-500"
            />
            <span className="text-sm text-stone-300">Unsplash</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="image-source"
              checked={uploadedOnly}
              onChange={() => onUploadedOnlyChange(true)}
              className="accent-brand-500"
            />
            <span className="text-sm text-stone-300">Uploaded images only</span>
          </label>
        </div>

        {/* Accent images */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={accentFolder === 'blue'}
            onChange={e => onAccentFolderChange(e.target.checked ? 'blue' : null)}
            className="accent-brand-500"
          />
          <span className="text-sm text-stone-300">
            Add blue accent images{' '}
            <span className="text-stone-600">(~20% of frames, ungraded)</span>
          </span>
        </label>

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
      </div>
    </div>
  )
}
