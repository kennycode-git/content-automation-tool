/**
 * ClipsSettingsPanel.tsx
 *
 * Step 2 for Video Clips mode. Replaces SettingsPanel when contentMode === 'clips'.
 * Covers: resolution, colour theme, transition type + duration.
 * Does NOT include seconds_per_image (not applicable to clips).
 */

import { useState } from 'react'

export interface ClipsSettings {
  resolution: string
  fps: number
  color_theme: string
  transition: 'cut' | 'fade_black' | 'crossfade'
  transition_duration: number
}

export const DEFAULT_CLIPS_SETTINGS: ClipsSettings = {
  resolution: '1080x1920',
  fps: 30,
  color_theme: 'none',
  transition: 'cut',
  transition_duration: 0.5,
}

const RESOLUTIONS = [
  { value: '1080x1920', label: 'TikTok / Reels (9:16)' },
  { value: '1920x1080', label: 'Landscape (16:9)' },
  { value: '1080x1080', label: 'Square (1:1)' },
]

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
}

const TRANSITIONS: { value: ClipsSettings['transition']; label: string; description: string }[] = [
  { value: 'cut',        label: 'Cut',           description: 'Hard cut between clips' },
  { value: 'fade_black', label: 'Fade to Black',  description: 'Each clip fades out, next fades in' },
  { value: 'crossfade',  label: 'Crossfade',      description: 'Clips dissolve into each other' },
]

interface Props {
  settings: ClipsSettings
  onChange: (s: ClipsSettings) => void
}

function ThemeDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const selected = COLOR_THEMES.find(t => t.value === value) ?? COLOR_THEMES[0]

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-stone-800 border border-stone-700
                   rounded text-sm text-stone-100 hover:border-stone-500 transition-colors text-left"
      >
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${THEME_DOT[selected.value] ?? 'bg-stone-400'}`} />
        <span className="flex-1">{selected.label}</span>
        <svg className={`w-3.5 h-3.5 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`}
             viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-stone-800 border border-stone-700
                          rounded shadow-xl overflow-hidden">
            {COLOR_THEMES.map(t => (
              <button
                key={t.value}
                onClick={() => { onChange(t.value); setOpen(false) }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-stone-700
                            transition-colors ${t.value === value ? 'bg-stone-750 text-brand-400' : 'text-stone-100'}`}
              >
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${THEME_DOT[t.value] ?? 'bg-stone-400'}`} />
                {t.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function ClipsSettingsPanel({ settings, onChange }: Props) {
  const set = <K extends keyof ClipsSettings>(key: K, val: ClipsSettings[K]) =>
    onChange({ ...settings, [key]: val })

  return (
    <div className="space-y-5">
      {/* Resolution */}
      <div>
        <label className="block text-xs font-medium text-stone-400 uppercase tracking-wide mb-2">
          Resolution
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          {RESOLUTIONS.map(r => (
            <button
              key={r.value}
              onClick={() => set('resolution', r.value)}
              className={`px-2 py-2 rounded text-xs font-medium transition-colors leading-tight text-center
                ${settings.resolution === r.value
                  ? 'bg-brand-600 text-white'
                  : 'bg-stone-800 text-stone-300 hover:bg-stone-700'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Colour theme */}
      <div>
        <label className="block text-xs font-medium text-stone-400 uppercase tracking-wide mb-2">
          Colour Grade
        </label>
        <ThemeDropdown value={settings.color_theme} onChange={v => set('color_theme', v)} />
        <p className="text-xs text-stone-500 mt-1.5">
          Applied to all clips via video filters during render.
        </p>
      </div>

      {/* Transition */}
      <div>
        <label className="block text-xs font-medium text-stone-400 uppercase tracking-wide mb-2">
          Transition
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          {TRANSITIONS.map(t => (
            <button
              key={t.value}
              onClick={() => set('transition', t.value)}
              title={t.description}
              className={`px-2 py-2 rounded text-xs font-medium transition-colors leading-tight text-center
                ${settings.transition === t.value
                  ? 'bg-brand-600 text-white'
                  : 'bg-stone-800 text-stone-300 hover:bg-stone-700'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {settings.transition !== 'cut' && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-stone-400 mb-1">
              <span>Transition duration</span>
              <span className="text-stone-200 font-medium">{settings.transition_duration.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min="0.2"
              max="2.0"
              step="0.1"
              value={settings.transition_duration}
              onChange={e => set('transition_duration', parseFloat(e.target.value))}
              className="w-full accent-brand-500"
            />
            <div className="flex justify-between text-[10px] text-stone-600 mt-0.5">
              <span>0.2s</span>
              <span>2.0s</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
