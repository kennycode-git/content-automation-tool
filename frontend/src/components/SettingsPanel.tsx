/**
 * SettingsPanel.tsx
 *
 * Video generation settings: resolution, timing, colour theme, presets.
 */

export interface VideoSettings {
  resolution: string
  seconds_per_image: number
  total_seconds: number
  fps: number
  allow_repeats: boolean
  color_theme: string
  max_per_query: number
}

const COLOR_THEMES = [
  { value: 'dark', label: 'Dark Tones' },
  { value: 'none', label: 'Natural' },
  { value: 'warm', label: 'Amber & Earth' },
  { value: 'grey', label: 'Silver & Slate' },
  { value: 'blue', label: 'Cobalt & Mist' },
  { value: 'red',  label: 'Crimson & Rose' },
  { value: 'bw',   label: 'Monochrome' },
]

const PRESETS = [
  { label: 'Fast',      seconds_per_image: 0.08, total_seconds: 10 },
  { label: 'Standard',  seconds_per_image: 0.13, total_seconds: 11 },
  { label: 'Cinematic', seconds_per_image: 0.21, total_seconds: 12 },
]

interface Props {
  settings: VideoSettings
  onChange: (s: VideoSettings) => void
  onPresetApplied?: (name: string) => void
}

function InfoIcon({ tip }: { tip: string }) {
  return (
    <span className="group relative inline-flex items-center">
      <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-stone-600 text-stone-500 text-[9px] font-bold cursor-help leading-none select-none">
        i
      </span>
      <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 w-56 rounded-lg bg-stone-700 border border-stone-600 px-2.5 py-2 text-xs text-stone-200 opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-normal shadow-lg">
        {tip}
      </span>
    </span>
  )
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs text-stone-400">
          {label}
          {hint && <InfoIcon tip={hint} />}
        </span>
        <span className="text-xs font-mono text-stone-300">
          {value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-brand-500"
      />
    </div>
  )
}

import PresetManager from './PresetManager'

export default function SettingsPanel({ settings, onChange, onPresetApplied }: Props) {
  function update(patch: Partial<VideoSettings>) {
    onChange({ ...settings, ...patch })
  }

  const imageCount = Math.ceil(settings.total_seconds / settings.seconds_per_image)
  const activePreset = PRESETS.find(
    p => p.seconds_per_image === settings.seconds_per_image && p.total_seconds === settings.total_seconds
  )

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs text-stone-400">Custom presets</p>
        <PresetManager
          currentSettings={settings}
          onApply={(s, name) => { onChange({ ...settings, ...s }); onPresetApplied?.(name) }}
        />
      </div>
      <hr className="border-stone-800" />
      <div>
        <label className="mb-1 block text-xs text-stone-400">Resolution</label>
        <select
          value={settings.resolution}
          onChange={e => update({ resolution: e.target.value })}
          className="w-full rounded-lg border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-100 focus:outline-none focus:border-brand-500"
        >
          <option value="1080x1920">1080×1920 (TikTok portrait)</option>
          <option value="1920x1080">1920×1080 (Landscape)</option>
          <option value="1080x1080">1080×1080 (Square)</option>
        </select>
      </div>

      {/* Presets */}
      <div>
        <span className="mb-1.5 block text-xs text-stone-400">Presets</span>
        <div className="flex gap-2">
          {PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => update({ seconds_per_image: p.seconds_per_image, total_seconds: p.total_seconds })}
              className={`rounded-full px-2.5 py-0.5 text-xs border transition ${
                activePreset?.label === p.label
                  ? 'border-brand-500 text-brand-400'
                  : 'border-stone-700 text-stone-500 hover:border-stone-500 hover:text-stone-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <Slider
        label="Seconds per image"
        hint="0.08–0.20s recommended for optimal viewer engagement"
        value={settings.seconds_per_image}
        min={0.05} max={1.0} step={0.01} unit="s"
        onChange={v => update({ seconds_per_image: v })}
      />
      <Slider
        label="Total duration"
        value={settings.total_seconds}
        min={5} max={60} step={0.5} unit="s"
        onChange={v => update({ total_seconds: v })}
      />
      {/* Live image estimate */}
      <p className="text-xs text-stone-600">
        ~{imageCount} images needed · {settings.seconds_per_image}s each · {settings.total_seconds}s total
      </p>

      <div>
        <div className="mb-1 flex items-center gap-1">
          <label className="text-xs text-stone-400">Colour theme</label>
          <InfoIcon tip="Biases search toward this colour theme and applies automatic colour grading.
                         Recommend 'Dark Tones' or 'Monochrome' for most visible white overlay text." />
        </div>
        <select
          value={settings.color_theme}
          onChange={e => update({ color_theme: e.target.value })}
          className="w-full rounded-lg border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm text-stone-100 focus:outline-none focus:border-brand-500"
        >
          {COLOR_THEMES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

    </div>
  )
}
