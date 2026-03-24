/**
 * ClipsSettingsPanel.tsx
 *
 * Step 2 for Video Clips mode. Replaces SettingsPanel when contentMode === 'clips'.
 * Covers: resolution, colour theme, transition type + duration.
 * Does NOT include seconds_per_image (not applicable to clips).
 */

import { useState } from 'react'
import type { TextOverlayConfig } from '../lib/api'

export interface ClipsSettings {
  resolution: string
  fps: number
  color_theme: string
  transition: 'cut' | 'fade_black' | 'crossfade'
  transition_duration: number
  max_clip_duration: number
  clips_per_term: number
  text_overlay: TextOverlayConfig
}

export const DEFAULT_CLIPS_SETTINGS: ClipsSettings = {
  resolution: '1080x1920',
  fps: 30,
  color_theme: 'none',
  transition: 'cut',
  transition_duration: 0.5,
  max_clip_duration: 10,
  clips_per_term: 5,
  text_overlay: {
    enabled: false,
    text: '',
    font: 'garamond',
    color: 'white',
    background_box: false,
    position: 'bottom-center',
    alignment: 'center',
    font_size_pct: 0.045,
  },
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
  { value: 'mocha',   label: 'Mocha' },
  { value: 'noir',    label: 'Noir' },
  { value: 'abyss',   label: 'Abyss' },
  { value: 'dusk',    label: 'Dusk' },
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
  mocha:   'bg-amber-950',
  noir:    'bg-stone-900 ring-1 ring-amber-900',
  abyss:   'bg-blue-950 ring-1 ring-cyan-900',
  dusk:    'bg-purple-900 ring-1 ring-purple-700',
}

const OVERLAY_FONTS = [
  { value: 'garamond',    label: 'Garamond',    group: 'Serif' },
  { value: 'playfair',    label: 'Playfair',    group: 'Serif' },
  { value: 'lora',        label: 'Lora',        group: 'Serif' },
  { value: 'outfit',      label: 'Outfit',      group: 'Sans' },
  { value: 'raleway',     label: 'Raleway',     group: 'Sans' },
  { value: 'cinzel',      label: 'Cinzel',      group: 'Display' },
  { value: 'jetbrains',   label: 'JetBrains',   group: 'Mono' },
]

const OVERLAY_COLORS = [
  { value: 'white',  label: 'White',  hex: '#ffffff' },
  { value: 'cream',  label: 'Cream',  hex: '#f5f0e8' },
  { value: 'gold',   label: 'Gold',   hex: '#f5e317' },
  { value: 'black',  label: 'Black',  hex: '#000000' },
]

const OVERLAY_POSITIONS = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]

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

      {/* Clips per search term */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="font-medium text-stone-400 uppercase tracking-wide">Clips per search</span>
          <span className="text-stone-200 font-medium">{settings.clips_per_term}</span>
        </div>
        <input
          type="range"
          min="1"
          max="10"
          step="1"
          value={settings.clips_per_term}
          onChange={e => set('clips_per_term', parseInt(e.target.value))}
          className="w-full accent-brand-500"
        />
        <div className="flex justify-between text-[10px] text-stone-600 mt-0.5">
          <span>1</span>
          <span>10</span>
        </div>
      </div>

      {/* Max clip duration */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="font-medium text-stone-400 uppercase tracking-wide">Max clip duration</span>
          <span className="text-stone-200 font-medium">{settings.max_clip_duration}s</span>
        </div>
        <input
          type="range"
          min="3"
          max="15"
          step="1"
          value={settings.max_clip_duration}
          onChange={e => set('max_clip_duration', parseInt(e.target.value))}
          className="w-full accent-brand-500"
        />
        <div className="flex justify-between text-[10px] text-stone-600 mt-0.5">
          <span>3s</span>
          <span>15s</span>
        </div>
        <p className="text-xs text-stone-500 mt-1">
          Each clip is capped at this length. Shorter = smaller file size.
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
            {settings.transition === 'crossfade' && settings.transition_duration >= settings.max_clip_duration / 2 && (
              <p className="text-[10px] text-amber-500/80 mt-1">
                Crossfade ({settings.transition_duration}s) is ≥ half the max clip duration ({settings.max_clip_duration}s) — reduce transition or increase clip duration.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Text overlay */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-stone-400 uppercase tracking-wide">Text overlay</label>
          <button
            onClick={() => set('text_overlay', { ...settings.text_overlay, enabled: !settings.text_overlay.enabled })}
            className={`relative w-8 h-4 rounded-full transition-colors ${settings.text_overlay.enabled ? 'bg-brand-500' : 'bg-stone-700'}`}
          >
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${settings.text_overlay.enabled ? 'left-4' : 'left-0.5'}`} />
          </button>
        </div>

        {settings.text_overlay.enabled && (
          <div className="space-y-3">
            <textarea
              value={settings.text_overlay.text}
              onChange={e => set('text_overlay', { ...settings.text_overlay, text: e.target.value.slice(0, 200) })}
              placeholder="Text to burn into the video…"
              rows={3}
              className="w-full bg-stone-800 border border-stone-700 rounded px-3 py-2 text-sm text-stone-100
                         placeholder-stone-500 focus:outline-none focus:border-brand-500 resize-none"
            />
            <div className="flex justify-end">
              <span className="text-[10px] text-stone-600">{settings.text_overlay.text.length}/200</span>
            </div>

            {/* Font */}
            <div>
              <label className="text-[10px] text-stone-500 uppercase tracking-wide block mb-1">Font</label>
              <select
                value={settings.text_overlay.font}
                onChange={e => set('text_overlay', { ...settings.text_overlay, font: e.target.value })}
                className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-xs text-stone-100
                           focus:outline-none focus:border-brand-500"
              >
                {OVERLAY_FONTS.map(f => (
                  <option key={f.value} value={f.value}>{f.label} ({f.group})</option>
                ))}
              </select>
            </div>

            {/* Color */}
            <div>
              <label className="text-[10px] text-stone-500 uppercase tracking-wide block mb-1">Colour</label>
              <div className="flex gap-1.5">
                {OVERLAY_COLORS.map(c => (
                  <button
                    key={c.value}
                    onClick={() => set('text_overlay', { ...settings.text_overlay, color: c.value })}
                    title={c.label}
                    className={`flex-1 py-1.5 rounded text-[10px] font-medium border transition
                      ${settings.text_overlay.color === c.value ? 'border-brand-500' : 'border-stone-700'}`}
                    style={{ color: c.hex, background: c.value === 'white' || c.value === 'cream' ? '#1c1917' : undefined }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Position */}
            <div>
              <label className="text-[10px] text-stone-500 uppercase tracking-wide block mb-1">Position</label>
              <div className="grid grid-cols-3 gap-1">
                {OVERLAY_POSITIONS.map(pos => (
                  <button
                    key={pos}
                    onClick={() => set('text_overlay', { ...settings.text_overlay, position: pos })}
                    className={`h-5 rounded transition ${settings.text_overlay.position === pos ? 'bg-brand-500' : 'bg-stone-800 hover:bg-stone-700'}`}
                    title={pos.replace('-', ' ')}
                  />
                ))}
              </div>
            </div>

            {/* Background box + size */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-stone-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.text_overlay.background_box}
                  onChange={e => set('text_overlay', { ...settings.text_overlay, background_box: e.target.checked })}
                  className="accent-brand-500"
                />
                Background box
              </label>
              <div className="flex items-center gap-2 text-xs text-stone-400">
                <span>Size</span>
                <input
                  type="range"
                  min="1"
                  max="12"
                  step="0.2"
                  value={Math.round(settings.text_overlay.font_size_pct * 1000) / 10}
                  onChange={e => set('text_overlay', { ...settings.text_overlay, font_size_pct: parseFloat(e.target.value) / 100 })}
                  className="w-20 accent-brand-500"
                />
                <span className="text-stone-200 w-8 text-right">{(settings.text_overlay.font_size_pct * 100).toFixed(1)}%</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
