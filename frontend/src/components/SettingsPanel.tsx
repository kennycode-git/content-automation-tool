/**
 * SettingsPanel.tsx
 *
 * Video generation settings: resolution, timing, colour theme, presets.
 */

import { useState } from 'react'

export interface CustomGradeParams {
  brightness: number
  contrast: number
  saturation: number
  exposure: number
  warmth: number
  tint: number
  hue_shift: number
}

export const DEFAULT_CUSTOM_PARAMS: CustomGradeParams = {
  brightness: 1.0, contrast: 1.0, saturation: 1.0,
  exposure: 1.0, warmth: 0.0, tint: 0.0, hue_shift: 0,
}

export interface VideoSettings {
  resolution: string
  seconds_per_image: number
  total_seconds: number
  fps: number
  allow_repeats: boolean
  color_theme: string
  max_per_query: number
  custom_grade_params?: CustomGradeParams
}

const COLOR_THEMES = [
  { value: 'none',    label: 'Natural' },
  { value: 'dark',    label: 'Dark Tones' },
  { value: 'sepia',   label: 'Sepia' },
  { value: 'warm',    label: 'Amber' },
  { value: 'low_exp', label: 'Low Exposure' },
  { value: 'grey',    label: 'Silver' },
  { value: 'blue',    label: 'Cobalt' },
  { value: 'red',     label: 'Crimson' },
  { value: 'bw',      label: 'Monochrome' },
  { value: 'custom',  label: 'Create Your Own' },
]

const THEME_DOT: Record<string, string> = {
  none:    'bg-stone-400',
  dark:    'bg-stone-900 ring-1 ring-stone-600',
  sepia:   'bg-amber-800',
  warm:    'bg-amber-500',
  low_exp: 'bg-stone-950 ring-1 ring-stone-700',
  grey:    'bg-slate-400',
  blue:    'bg-blue-500',
  red:     'bg-red-500',
  bw:      'bg-white ring-1 ring-stone-500',
  custom:  'bg-stone-600',
}

const PRESETS = [
  { label: 'Fast',      seconds_per_image: 0.08, total_seconds: 10 },
  { label: 'Standard',  seconds_per_image: 0.13, total_seconds: 11 },
  { label: 'Cinematic', seconds_per_image: 0.21, total_seconds: 12 },
]

interface Props {
  settings: VideoSettings
  onChange: (s: VideoSettings) => void
  onPresetApplied?: (name: string) => void
  themeDisabled?: boolean
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

function SparkleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
      <path d="M12 2l1.6 4.8L18.4 8l-4.8 1.6L12 14.4l-1.6-4.8L5.6 8l4.8-1.6L12 2z" />
      <path d="M5 15l.8 2.4L8.2 18l-2.4.8L5 21l-.8-2.4L1.8 18l2.4-.8L5 15z" opacity=".6" />
      <path d="M19 2l.6 1.8 1.8.6-1.8.6L19 7l-.6-1.8L16.6 4.4l1.8-.6L19 2z" opacity=".6" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`w-3.5 h-3.5 text-stone-500 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function ThemePreviewPopup({ theme }: { theme: typeof COLOR_THEMES[number] }) {
  return (
    <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 w-36 rounded-lg border border-stone-600 bg-stone-900 shadow-xl overflow-hidden z-50 pointer-events-none">
      <div className="relative w-full aspect-[9/16] bg-stone-950 flex items-center justify-center">
        <video
          key={theme.value}
          src={`/theme-previews/${theme.value}.mp4`}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
        <span className="text-xs text-stone-600 select-none">Preview coming soon</span>
      </div>
      <div className="px-2 py-1.5 text-xs text-stone-400 border-t border-stone-700">
        {theme.label}
      </div>
    </div>
  )
}

const BANNER_VIDEOS = [
  '/theme-previews/eastern-philosophy.mp4',
  '/theme-previews/nature-philosophy.mp4',
]

function LivePreviewBanner({ params }: { params: CustomGradeParams }) {
  const cssFilter = buildCssFilter(params)
  return (
    <div className="flex gap-0.5 bg-stone-950 w-full" style={{ height: '8rem' }}>
      {BANNER_VIDEOS.map((src, i) => (
        <div key={i} className="flex-1 overflow-hidden">
          <video
            src={src}
            autoPlay
            muted
            loop
            playsInline
            style={{ filter: cssFilter, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 40%' }}
          />
        </div>
      ))}
    </div>
  )
}

const CREATIVE_PRESETS: { name: string; params: CustomGradeParams }[] = [
  { name: 'Vintage Film', params: { brightness: 0.95, contrast: 0.85, saturation: 0.70, exposure: 0.88, warmth: 0.30, tint: 0.10, hue_shift: 5 } },
  { name: 'Golden Hour',  params: { brightness: 1.05, contrast: 1.10, saturation: 1.30, exposure: 0.95, warmth: 0.55, tint: 0.05, hue_shift: 8 } },
  { name: 'Teal & Orange', params: { brightness: 1.00, contrast: 1.20, saturation: 1.40, exposure: 0.90, warmth: 0.40, tint: -0.20, hue_shift: -12 } },
  { name: 'Faded Matte',  params: { brightness: 1.10, contrast: 0.75, saturation: 0.55, exposure: 1.05, warmth: 0.10, tint: 0.05, hue_shift: 0 } },
  { name: 'Noir Shadows', params: { brightness: 0.80, contrast: 1.50, saturation: 0.20, exposure: 0.70, warmth: -0.10, tint: 0.05, hue_shift: 0 } },
  { name: 'Neon Dusk',    params: { brightness: 0.90, contrast: 1.30, saturation: 1.60, exposure: 0.75, warmth: -0.30, tint: 0.35, hue_shift: -25 } },
]

const CUSTOM_SLIDERS: { key: keyof CustomGradeParams; label: string; min: number; max: number; step: number; unit: string }[] = [
  { key: 'brightness', label: 'Brightness',  min: 0,    max: 2,   step: 0.05, unit: '' },
  { key: 'contrast',   label: 'Contrast',    min: 0,    max: 2,   step: 0.05, unit: '' },
  { key: 'saturation', label: 'Saturation',  min: 0,    max: 2,   step: 0.05, unit: '' },
  { key: 'exposure',   label: 'Exposure',    min: 0.5,  max: 1.5, step: 0.05, unit: '' },
  { key: 'warmth',     label: 'Warmth',      min: -1,   max: 1,   step: 0.05, unit: '' },
  { key: 'tint',       label: 'Tint',        min: -1,   max: 1,   step: 0.05, unit: '' },
  { key: 'hue_shift',  label: 'Hue Shift',   min: -180, max: 180, step: 1,    unit: '°' },
]

function buildCssFilter(p: CustomGradeParams): string {
  const combinedBrightness = p.brightness * p.exposure
  const parts: string[] = [
    `brightness(${combinedBrightness.toFixed(2)})`,
    `contrast(${p.contrast.toFixed(2)})`,
    `saturate(${p.saturation.toFixed(2)})`,
  ]
  if (Math.abs(p.hue_shift) > 0.5) {
    parts.push(`hue-rotate(${p.hue_shift.toFixed(0)}deg)`)
  }
  if (p.warmth > 0.01) {
    parts.push(`sepia(${(p.warmth * 0.35).toFixed(2)})`)
    parts.push(`hue-rotate(${(p.warmth * 15).toFixed(1)}deg)`)
  } else if (p.warmth < -0.01) {
    parts.push(`hue-rotate(${(p.warmth * 30).toFixed(1)}deg)`)
  }
  return parts.join(' ')
}

function CustomThemePanel({ params, onChange }: { params: CustomGradeParams; onChange: (p: CustomGradeParams) => void }) {
  return (
    <div className="mt-2 rounded-lg border border-stone-700 bg-stone-900/60 overflow-hidden">
      {/* Live preview banner — full width, landscape crop */}
      <LivePreviewBanner params={params} />

      <div className="p-3 space-y-3">
        {/* Starting points */}
        <div>
          <p className="mb-1.5 text-xs text-stone-500">Starting points</p>
          <div className="flex flex-wrap gap-1.5">
            {CREATIVE_PRESETS.map(p => (
              <button
                key={p.name}
                onClick={() => onChange(p.params)}
                className="rounded-full border border-stone-700 px-2.5 py-0.5 text-xs text-stone-400 hover:border-violet-500 hover:text-violet-300 transition"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Sliders — full width */}
        <div className="space-y-2.5">
          {CUSTOM_SLIDERS.map(s => (
            <div key={s.key}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-stone-400">{s.label}</span>
                <span className="text-xs font-mono text-stone-300">
                  {params[s.key].toFixed(s.step < 1 ? 2 : 0)}{s.unit}
                </span>
              </div>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={params[s.key]}
                onChange={e => onChange({ ...params, [s.key]: parseFloat(e.target.value) })}
                className="w-full accent-violet-500"
              />
            </div>
          ))}
        </div>

        {/* Reset */}
        <button
          onClick={() => onChange(DEFAULT_CUSTOM_PARAMS)}
          className="text-xs text-stone-600 hover:text-stone-400 transition"
        >
          Reset to neutral
        </button>
      </div>
    </div>
  )
}

function ThemeSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const selected = COLOR_THEMES.find(t => t.value === value) ?? COLOR_THEMES[0]

  return (
    <div className="relative">
      {/* Collapsed trigger */}
      <div
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-stone-700 bg-stone-800 cursor-pointer hover:bg-stone-700/50 transition-colors"
      >
        {selected.value === 'custom'
          ? <span className="w-2.5 h-2.5 flex-shrink-0 flex items-center justify-center text-fuchsia-400"><SparkleIcon /></span>
          : <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${THEME_DOT[selected.value]}`} />
        }
        <span className={`text-sm text-stone-100 ${selected.value === 'custom' ? 'italic' : ''}`}>{selected.label}</span>
        {/* Eye preview for selected theme (hidden for Natural and Create Your Own) */}
        {selected.value !== 'none' && selected.value !== 'custom' && (
          <div
            className="relative ml-1"
            onMouseEnter={e => { e.stopPropagation(); setHovered(selected.value + '_trigger') }}
            onMouseLeave={() => setHovered(null)}
          >
            <button
              onClick={e => e.stopPropagation()}
              className={`p-0.5 transition-colors ${hovered === selected.value + '_trigger' ? 'text-stone-200' : 'text-stone-500 hover:text-stone-300'}`}
              aria-label={`Preview ${selected.label}`}
            >
              <EyeIcon />
            </button>
            {hovered === selected.value + '_trigger' && <ThemePreviewPopup theme={selected} />}
          </div>
        )}
        <span className="flex-1" />
        <ChevronIcon open={open} />
      </div>

      {/* Dropdown list */}
      {open && (
        <>
          {/* Click-away overlay */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-stone-700 bg-stone-800 shadow-xl">
            {COLOR_THEMES.map(t => (
              <div
                key={t.value}
                onClick={() => { onChange(t.value); setOpen(false) }}
                className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors
                  [&:not(:first-child)]:border-t [&:not(:first-child)]:border-stone-700/50
                  ${t.value === 'custom'
                    ? value === t.value
                      ? 'bg-fuchsia-900/60 text-fuchsia-200 border-t border-fuchsia-900/40'
                      : 'text-fuchsia-400/70 hover:bg-fuchsia-900/30 hover:text-fuchsia-300'
                    : value === t.value
                      ? 'bg-stone-700 text-stone-100'
                      : 'text-stone-400 hover:bg-stone-700/40 hover:text-stone-200'
                  }`}
              >
                {t.value === 'custom'
                  ? <span className="w-2.5 h-2.5 flex-shrink-0 flex items-center justify-center text-fuchsia-400"><SparkleIcon /></span>
                  : <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${THEME_DOT[t.value]}`} />
                }
                <span className={`text-sm ${t.value === 'custom' ? 'italic' : ''}`}>{t.label}</span>
                {/* Eye icon sits right after label text (hidden for Natural and Create Your Own) */}
                {t.value !== 'none' && t.value !== 'custom' && (
                  <div
                    className="relative ml-1"
                    onMouseEnter={e => { e.stopPropagation(); setHovered(t.value) }}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <button
                      onClick={e => e.stopPropagation()}
                      className={`p-0.5 transition-colors ${hovered === t.value ? 'text-stone-200' : 'text-stone-600 hover:text-stone-400'}`}
                      aria-label={`Preview ${t.label}`}
                    >
                      <EyeIcon />
                    </button>
                    {hovered === t.value && <ThemePreviewPopup theme={t} />}
                  </div>
                )}
              </div>
            ))}

          </div>
        </>
      )}
    </div>
  )
}

export default function SettingsPanel({ settings, onChange, onPresetApplied, themeDisabled }: Props) {
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
        min={4} max={20} step={0.5} unit="s"
        onChange={v => update({ total_seconds: v })}
      />
      {/* Live image estimate */}
      <p className="text-xs text-stone-600">
        ~{imageCount} images needed · {settings.seconds_per_image}s each · {settings.total_seconds}s total
      </p>

      <div>
        <div className="mb-1 flex items-center gap-1">
          <label className={`text-xs ${themeDisabled ? 'text-stone-600' : 'text-stone-400'}`}>Colour theme</label>
          {themeDisabled ? (
            <InfoIcon tip="All batches have a per-batch theme set — global theme is overridden. Clear per-batch overrides to use this." />
          ) : (
            <InfoIcon tip="Biases search toward this colour theme and applies automatic colour grading.
                         Recommend 'Dark Tones' or 'Low Exposure' for most visible white overlay text." />
          )}
        </div>
        <div className={themeDisabled ? 'pointer-events-none opacity-40' : ''}>
          <ThemeSelector
            value={settings.color_theme}
            onChange={v => {
              if (v !== 'custom') {
                update({ color_theme: v, custom_grade_params: undefined })
              } else {
                update({ color_theme: 'custom', custom_grade_params: settings.custom_grade_params ?? DEFAULT_CUSTOM_PARAMS })
              }
            }}
          />
          {settings.color_theme === 'custom' && (
            <CustomThemePanel
              params={settings.custom_grade_params ?? DEFAULT_CUSTOM_PARAMS}
              onChange={p => update({ custom_grade_params: p })}
            />
          )}
        </div>
      </div>

    </div>
  )
}
