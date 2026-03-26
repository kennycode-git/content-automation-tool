/**
 * ClipsSettingsPanel.tsx
 *
 * Step 2 for Video Clips mode. Replaces SettingsPanel when contentMode === 'clips'.
 * Covers: resolution, colour theme, transition type + duration.
 * Does NOT include seconds_per_image (not applicable to clips).
 */

import { useRef, useState } from 'react'
import type { OverlayAlignment, OverlayColor, OverlayFont, OverlayPosition, TextOverlayConfig } from '../lib/api'

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
  max_clip_duration: 5,
  clips_per_term: 2,
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
  { value: 'midnight', label: 'Midnight' },
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
  midnight: 'bg-blue-950 ring-1 ring-cyan-900',
  dusk:    'bg-purple-900 ring-1 ring-purple-700',
}

const TRANSITIONS: { value: ClipsSettings['transition']; label: string; description: string }[] = [
  { value: 'cut',        label: 'Cut',           description: 'Hard cut between clips' },
  { value: 'fade_black', label: 'Fade to Black',  description: 'Each clip fades out, next fades in' },
  { value: 'crossfade',  label: 'Crossfade',      description: 'Clips dissolve into each other' },
]

// ── Overlay constants (mirrors BatchEditor) ────────────────────────────────────

const OVERLAY_FONT_GROUPS: { category: string; fonts: { value: OverlayFont; label: string }[] }[] = [
  {
    category: 'Serif',
    fonts: [
      { value: 'garamond',    label: 'Garamond' },
      { value: 'cormorant',   label: 'Cormorant' },
      { value: 'playfair',    label: 'Playfair' },
      { value: 'crimson',     label: 'Crimson' },
      { value: 'philosopher', label: 'Philosopher' },
      { value: 'lora',        label: 'Lora' },
    ],
  },
  {
    category: 'Sans',
    fonts: [
      { value: 'outfit',  label: 'Outfit' },
      { value: 'raleway', label: 'Raleway' },
      { value: 'josefin', label: 'Josefin' },
      { value: 'inter',   label: 'Inter' },
    ],
  },
  {
    category: 'Display',
    fonts: [
      { value: 'cinzel',      label: 'Cinzel' },
      { value: 'cinzel_deco', label: 'Cinzel Deco' },
      { value: 'uncial',      label: 'Uncial' },
    ],
  },
  {
    category: 'Mono',
    fonts: [
      { value: 'jetbrains',  label: 'JetBrains' },
      { value: 'space_mono', label: 'Space Mono' },
    ],
  },
]

const OVERLAY_COLORS: { value: OverlayColor; label: string; dot: string }[] = [
  { value: 'white', label: 'White',  dot: 'bg-white ring-1 ring-stone-500' },
  { value: 'cream', label: 'Cream',  dot: 'bg-amber-50 ring-1 ring-stone-500' },
  { value: 'gold',  label: 'Yellow', dot: 'bg-yellow-300' },
  { value: 'black', label: 'Black',  dot: 'bg-stone-900 ring-1 ring-stone-500' },
]

const OVERLAY_POSITIONS: { value: OverlayPosition; arrow: string }[][] = [
  [
    { value: 'top-left',    arrow: '↖' },
    { value: 'top-center',  arrow: '↑' },
    { value: 'top-right',   arrow: '↗' },
  ],
  [
    { value: 'middle-left',   arrow: '←' },
    { value: 'middle-center', arrow: '·' },
    { value: 'middle-right',  arrow: '→' },
  ],
  [
    { value: 'bottom-left',   arrow: '↙' },
    { value: 'bottom-center', arrow: '↓' },
    { value: 'bottom-right',  arrow: '↘' },
  ],
]

const OVERLAY_ALIGNMENTS: { value: OverlayAlignment; label: string }[] = [
  { value: 'left',   label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right',  label: 'Right' },
]

const FONT_CSS_FAMILY: Record<OverlayFont, string> = {
  garamond:    'Georgia, "Times New Roman", serif',
  cormorant:   '"Palatino Linotype", Georgia, serif',
  playfair:    '"Palatino Linotype", Georgia, serif',
  crimson:     'Georgia, serif',
  philosopher: 'Georgia, serif',
  lora:        'Georgia, serif',
  outfit:      'system-ui, -apple-system, sans-serif',
  raleway:     'system-ui, -apple-system, sans-serif',
  josefin:     'system-ui, -apple-system, sans-serif',
  inter:       'system-ui, -apple-system, sans-serif',
  cinzel:      '"Times New Roman", serif',
  cinzel_deco: '"Times New Roman", serif',
  uncial:      'Georgia, serif',
  jetbrains:   '"Courier New", Courier, monospace',
  space_mono:  '"Courier New", Courier, monospace',
}

const POSITION_FLEX: Record<OverlayPosition, { items: string; justify: string }> = {
  'top-left':      { items: 'flex-start', justify: 'flex-start' },
  'top-center':    { items: 'flex-start', justify: 'center' },
  'top-right':     { items: 'flex-start', justify: 'flex-end' },
  'middle-left':   { items: 'center',     justify: 'flex-start' },
  'middle-center': { items: 'center',     justify: 'center' },
  'middle-right':  { items: 'center',     justify: 'flex-end' },
  'bottom-left':   { items: 'flex-end',   justify: 'flex-start' },
  'bottom-center': { items: 'flex-end',   justify: 'center' },
  'bottom-right':  { items: 'flex-end',   justify: 'flex-end' },
}

const OVERLAY_PRESETS_KEY = 'cogito_overlay_presets'

type OverlayPreset = {
  id: string
  name: string
  settings: Omit<TextOverlayConfig, 'text' | 'enabled'>
}

function overlayColorHex(ov: TextOverlayConfig): string {
  if (ov.color === 'custom') return ov.custom_color ?? '#ffffff'
  const map: Record<string, string> = { white: '#ffffff', cream: '#f5f0e8', gold: '#f5e317', black: '#000000' }
  return map[ov.color] ?? '#ffffff'
}

function OverlayPreview({ ov }: { ov: TextOverlayConfig }) {
  const [enlarged, setEnlarged] = useState(false)
  const [previewH, setPreviewH] = useState(200)
  const dragStartRef = useRef<{ y: number; h: number } | null>(null)

  const pos = POSITION_FLEX[ov.position as OverlayPosition] ?? POSITION_FLEX['bottom-center']
  const color = overlayColorHex(ov)
  const fontFamily = FONT_CSS_FAMILY[ov.font as OverlayFont] ?? 'Georgia, serif'
  const displayText = ov.text.trim() || 'Preview text'

  function PreviewBox({ h, w }: { h: number; w: number }) {
    const fontSize = Math.max(3, Math.round(h * (ov.font_size_pct ?? 0.045)))
    const margin = Math.round(h * 0.05)
    return (
      <div
        style={{
          width: w, height: h,
          background: '#0e0e0e',
          borderRadius: 4,
          overflow: 'hidden',
          display: 'flex',
          alignItems: pos.items,
          justifyContent: pos.justify,
          border: '1px solid #333',
          flexShrink: 0,
          padding: margin,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            color, fontFamily, fontSize,
            lineHeight: 1.25,
            textAlign: (ov.alignment ?? 'center') as CanvasTextAlign,
            width: 'fit-content',
            maxWidth: '100%',
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
            ...(ov.background_box
              ? { background: 'rgba(0,0,0,0.55)', padding: '1px 3px', borderRadius: 2 }
              : {}),
          }}
        >
          {displayText}
        </div>
      </div>
    )
  }

  function onDragHandlePointerDown(e: React.PointerEvent) {
    e.preventDefault()
    dragStartRef.current = { y: e.clientY, h: previewH }
    const onMove = (me: PointerEvent) => {
      if (!dragStartRef.current) return
      const delta = me.clientY - dragStartRef.current.y
      setPreviewH(Math.min(520, Math.max(120, dragStartRef.current.h + delta)))
    }
    const onUp = () => {
      dragStartRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="flex justify-center my-2">
      <div className="relative group">
        <PreviewBox h={previewH} w={113} />
        <button
          onClick={() => setEnlarged(true)}
          className="absolute bottom-6 right-1.5 w-6 h-6 rounded bg-black/60 flex items-center justify-center
                     opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
          title="Expand preview"
        >
          <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6.5" cy="6.5" r="4" />
            <path d="M11 11l3 3" strokeLinecap="round" />
            <path d="M5 6.5h3M6.5 5v3" strokeLinecap="round" />
          </svg>
        </button>
        <div
          onPointerDown={onDragHandlePointerDown}
          className="absolute bottom-0 left-0 right-0 h-5 flex items-center justify-center cursor-ns-resize select-none"
          title="Drag to resize"
        >
          <div className="w-8 h-1 rounded-full bg-stone-600 group-hover:bg-stone-400 transition-colors" />
        </div>
      </div>

      {enlarged && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75"
          onClick={() => setEnlarged(false)}
        >
          <div className="relative" onClick={e => e.stopPropagation()}>
            <PreviewBox h={540} w={304} />
            <button
              onClick={() => setEnlarged(false)}
              className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center
                         text-white hover:bg-black/90 transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </button>
            <p className="text-center text-[10px] text-stone-600 mt-2">Click outside to close</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

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

  const [overlayPresets, setOverlayPresets] = useState<OverlayPreset[]>(() => {
    try { return JSON.parse(localStorage.getItem(OVERLAY_PRESETS_KEY) || '[]') } catch { return [] }
  })
  const [savingPreset, setSavingPreset] = useState(false)
  const [presetName, setPresetName] = useState('')

  function saveOverlayPreset(ov: TextOverlayConfig) {
    const name = presetName.trim() || 'Preset'
    const { text: _t, enabled: _e, ...ovSettings } = ov
    const preset: OverlayPreset = { id: crypto.randomUUID(), name, settings: ovSettings }
    const updated = [...overlayPresets, preset]
    setOverlayPresets(updated)
    try { localStorage.setItem(OVERLAY_PRESETS_KEY, JSON.stringify(updated)) } catch { /* ignore */ }
    setSavingPreset(false)
    setPresetName('')
  }

  function deleteOverlayPreset(id: string) {
    const updated = overlayPresets.filter(p => p.id !== id)
    setOverlayPresets(updated)
    try { localStorage.setItem(OVERLAY_PRESETS_KEY, JSON.stringify(updated)) } catch { /* ignore */ }
  }

  const setOv = (patch: Partial<TextOverlayConfig>) =>
    set('text_overlay', { ...settings.text_overlay, ...patch })

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
          max="5"
          step="1"
          value={settings.clips_per_term}
          onChange={e => set('clips_per_term', parseInt(e.target.value))}
          className="w-full accent-brand-500"
        />
        <div className="flex justify-between text-[10px] text-stone-600 mt-0.5">
          <span>1</span>
          <span>5</span>
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
          max="10"
          step="1"
          value={settings.max_clip_duration}
          onChange={e => set('max_clip_duration', parseInt(e.target.value))}
          className="w-full accent-brand-500"
        />
        <div className="flex justify-between text-[10px] text-stone-600 mt-0.5">
          <span>3s</span>
          <span>10s</span>
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
            onClick={() => setOv({ enabled: !settings.text_overlay.enabled })}
            className={`relative w-8 h-4 rounded-full transition-colors ${settings.text_overlay.enabled ? 'bg-brand-500' : 'bg-stone-700'}`}
          >
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${settings.text_overlay.enabled ? 'left-4' : 'left-0.5'}`} />
          </button>
        </div>

        {settings.text_overlay.enabled && (() => {
          const ov = settings.text_overlay
          return (
            <div className="space-y-2.5">

              {/* Style presets */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[9px] font-semibold tracking-widest uppercase text-stone-600">Style presets</p>
                  {!savingPreset && (
                    <button
                      onClick={() => setSavingPreset(true)}
                      className="text-[9px] text-stone-500 hover:text-stone-300 transition"
                    >
                      + Save current
                    </button>
                  )}
                </div>
                {savingPreset && (
                  <div className="flex gap-1 mb-1">
                    <input
                      type="text"
                      value={presetName}
                      onChange={e => setPresetName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveOverlayPreset(ov)
                        if (e.key === 'Escape') { setSavingPreset(false); setPresetName('') }
                      }}
                      placeholder="Preset name…"
                      autoFocus
                      className="flex-1 rounded border border-stone-700 bg-stone-800 px-2 py-0.5 text-[10px] text-stone-100 placeholder-stone-600 focus:border-brand-500 focus:outline-none"
                    />
                    <button
                      onClick={() => saveOverlayPreset(ov)}
                      className="rounded bg-stone-700 px-2 py-0.5 text-[10px] text-stone-200 hover:bg-stone-600 transition"
                    >Save</button>
                    <button
                      onClick={() => { setSavingPreset(false); setPresetName('') }}
                      className="rounded bg-stone-800 px-2 py-0.5 text-[10px] text-stone-500 hover:text-stone-300 transition"
                    >✕</button>
                  </div>
                )}
                {overlayPresets.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {overlayPresets.map(preset => (
                      <div key={preset.id} className="group flex items-center gap-0.5">
                        <button
                          onClick={() => setOv({ ...preset.settings })}
                          className="rounded bg-stone-800 border border-stone-700 px-2 py-0.5 text-[10px] text-stone-300 hover:text-stone-100 hover:border-stone-500 transition"
                        >
                          {preset.name}
                        </button>
                        <button
                          onClick={() => deleteOverlayPreset(preset.id)}
                          className="hidden group-hover:flex items-center justify-center w-3.5 h-3.5 rounded-full bg-stone-700 text-stone-500 hover:bg-stone-600 hover:text-stone-300 text-[8px] transition"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
                {overlayPresets.length === 0 && !savingPreset && (
                  <p className="text-[9px] text-stone-700 italic">No presets saved yet</p>
                )}
              </div>

              {/* Text input */}
              <textarea
                rows={2}
                value={ov.text}
                onChange={e => setOv({ text: e.target.value.slice(0, 200) })}
                placeholder="Type overlay text…"
                className="w-full rounded-lg border border-stone-700 bg-stone-800 px-2.5 py-1.5 text-xs text-stone-100 placeholder-stone-600 focus:border-brand-500 focus:outline-none resize-none"
              />

              {/* Live preview */}
              <OverlayPreview ov={ov} />

              {/* Font */}
              <div>
                <p className="mb-1.5 text-[9px] font-semibold tracking-widest uppercase text-stone-600">Font</p>
                <div className="space-y-1.5">
                  {OVERLAY_FONT_GROUPS.map(group => (
                    <div key={group.category}>
                      <p className="mb-0.5 text-[8px] tracking-widest uppercase text-stone-700">{group.category}</p>
                      <div className="flex flex-wrap gap-1">
                        {group.fonts.map(f => (
                          <button
                            key={f.value}
                            onClick={() => setOv({ font: f.value })}
                            className={`rounded px-2 py-0.5 text-[10px] transition ${
                              ov.font === f.value
                                ? 'bg-stone-600 text-stone-100'
                                : 'bg-stone-800 text-stone-400 hover:text-stone-200'
                            }`}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Colour */}
              <div>
                <p className="mb-1 text-[9px] font-semibold tracking-widest uppercase text-stone-600">Colour</p>
                <div className="flex flex-wrap gap-1">
                  {OVERLAY_COLORS.map(c => (
                    <button
                      key={c.value}
                      onClick={() => setOv({ color: c.value })}
                      className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] transition ${
                        ov.color === c.value
                          ? 'bg-stone-600 text-stone-100'
                          : 'bg-stone-800 text-stone-400 hover:text-stone-200'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} />
                      {c.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setOv({ color: 'custom' })}
                    className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] transition ${
                      ov.color === 'custom'
                        ? 'bg-stone-600 text-stone-100'
                        : 'bg-stone-800 text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    🎨
                  </button>
                </div>
                {ov.color === 'custom' && (
                  <input
                    type="color"
                    value={ov.custom_color ?? '#ffffff'}
                    onChange={e => setOv({ custom_color: e.target.value })}
                    className="mt-1.5 h-7 w-full rounded cursor-pointer bg-stone-800 border border-stone-700"
                  />
                )}
              </div>

              {/* Background box */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ov.background_box}
                  onChange={e => setOv({ background_box: e.target.checked })}
                  className="rounded border-stone-600 bg-stone-800 accent-brand-500"
                />
                <span className="text-[10px] text-stone-400">Background box</span>
              </label>

              {/* Position grid */}
              <div>
                <p className="mb-1 text-[9px] font-semibold tracking-widest uppercase text-stone-600">Position</p>
                <div className="grid grid-cols-3 gap-0.5">
                  {OVERLAY_POSITIONS.flat().map(pos => (
                    <button
                      key={pos.value}
                      onClick={() => setOv({ position: pos.value })}
                      className={`flex items-center justify-center rounded py-1.5 text-xs transition ${
                        ov.position === pos.value
                          ? 'bg-stone-600 text-stone-100'
                          : 'bg-stone-800 text-stone-500 hover:text-stone-200'
                      }`}
                    >
                      {pos.arrow}
                    </button>
                  ))}
                </div>
              </div>

              {/* Alignment */}
              <div>
                <p className="mb-1 text-[9px] font-semibold tracking-widest uppercase text-stone-600">Alignment</p>
                <div className="flex gap-1">
                  {OVERLAY_ALIGNMENTS.map(a => (
                    <button
                      key={a.value}
                      onClick={() => setOv({ alignment: a.value })}
                      className={`flex-1 rounded px-1.5 py-1 text-[10px] transition ${
                        ov.alignment === a.value
                          ? 'bg-stone-600 text-stone-100'
                          : 'bg-stone-800 text-stone-400 hover:text-stone-200'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Font size */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-[9px] font-semibold tracking-widest uppercase text-stone-600">Size</p>
                  <span className="text-[10px] font-mono text-stone-300">
                    {Math.round((ov.font_size_pct ?? 0.045) * 1000) / 10}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.01}
                  max={0.12}
                  step={0.002}
                  value={ov.font_size_pct ?? 0.045}
                  onChange={e => setOv({ font_size_pct: parseFloat(e.target.value) })}
                  className="w-full accent-brand-500"
                />
              </div>

            </div>
          )
        })()}
      </div>
    </div>
  )
}
