/**
 * BatchEditor.tsx
 *
 * Dual-mode batch editor:
 * - Classic text mode: # Title delimited textarea (use # Batch Name as a section header)
 * - Visual mode: per-batch cards with individual textareas + optional image upload
 *
 * Each # block becomes a separate job when submitted.
 * classicText is persisted to localStorage so it survives page refresh.
 * Visual mode cards support a per-batch style popover (theme + accent override).
 */

import { useEffect, useRef, useState } from 'react'
import { uploadImages } from '../lib/api'
import type { CustomGradeParams } from './SettingsPanel'
import { THEME_GRADE_DEFAULTS } from './SettingsPanel'
import type { TextOverlayConfig, OverlayFont, OverlayColor, OverlayPosition, OverlayAlignment } from '../lib/api'

export type { TextOverlayConfig }

const STORAGE_KEY = 'cogito_classic_text'
const DEFAULT_CLASSIC_TEXT =
  '# Stoicism\nmarble statue philosophy\nancient greece\nstoic stone\n\n# Existentialism\nmeditation silence\nminimalist monk'

export interface BatchOutput {
  title: string | null
  terms: string[]
  uploaded_image_paths?: string[]
  color_theme?: string                   // undefined = inherit global
  custom_grade_params?: CustomGradeParams
  accent_folder_override?: string | null // undefined = inherit global, null = explicit none
  text_overlay?: TextOverlayConfig | null
}

interface VisualBatch {
  title: string
  terms: string
  colorTheme?: string                    // undefined = inherit global
  customGradeParams?: CustomGradeParams
  accentFolder?: string | null           // undefined = inherit global, null = explicit none
  textOverlay?: TextOverlayConfig | null
}

interface PendingBundle {
  title: string | null
  terms: string[]
  colorTheme?: string
  customGradeParams?: CustomGradeParams
  accentFolder?: string | null
}

interface Props {
  onBatchesChange: (batches: BatchOutput[]) => void
  pendingReuse?: { title: string | null; terms: string[] } | null
  onReuseHandled?: () => void
  pendingBundles?: PendingBundle[] | null
  onBundlesHandled?: () => void
  onOpenPrompt?: () => void
}

// ── Style popover constants ────────────────────────────────────────────────────

const BATCH_THEME_OPTIONS: { value: string | undefined; label: string; shortLabel: string; dot: string }[] = [
  { value: undefined,   label: 'Global (default)', shortLabel: 'Global',   dot: 'bg-stone-600 opacity-50' },
  { value: 'none',      label: 'Natural',           shortLabel: 'Natural',  dot: 'bg-stone-400' },
  { value: 'dark',      label: 'Dark Tones',         shortLabel: 'Dark',     dot: 'bg-stone-900 ring-1 ring-stone-600' },
  { value: 'sepia',     label: 'Sepia',              shortLabel: 'Sepia',    dot: 'bg-amber-800' },
  { value: 'warm',      label: 'Amber',              shortLabel: 'Amber',    dot: 'bg-amber-500' },
  { value: 'low_exp',   label: 'Low Exposure',        shortLabel: 'Low Exp',  dot: 'bg-stone-950 ring-1 ring-stone-700' },
  { value: 'grey',      label: 'Silver',             shortLabel: 'Silver',   dot: 'bg-slate-400' },
  { value: 'blue',      label: 'Cobalt',             shortLabel: 'Cobalt',   dot: 'bg-blue-500' },
  { value: 'red',       label: 'Crimson',            shortLabel: 'Crimson',  dot: 'bg-red-500' },
  { value: 'bw',        label: 'Monochrome',         shortLabel: 'Mono',     dot: 'bg-white ring-1 ring-stone-500' },
  { value: 'mocha',     label: 'Mocha',              shortLabel: 'Mocha',    dot: 'bg-amber-950' },
  { value: 'noir',      label: 'Noir',               shortLabel: 'Noir',     dot: 'bg-stone-900 ring-1 ring-amber-900' },
  { value: 'midnight',  label: 'Midnight',           shortLabel: 'Midnight', dot: 'bg-blue-950 ring-1 ring-cyan-900' },
  { value: 'dusk',      label: 'Dusk',               shortLabel: 'Dusk',     dot: 'bg-purple-900 ring-1 ring-purple-700' },
  { value: 'custom',    label: 'Custom',             shortLabel: 'Custom',   dot: 'bg-violet-600' },
]

// Themes with an available preview video in /theme-previews/
const THEMES_WITH_PREVIEW_VIDEO = new Set([
  'dark', 'sepia', 'warm', 'low_exp', 'grey', 'blue', 'red', 'bw', 'midnight', 'dusk',
])

const BATCH_ACCENT_OPTIONS: { value: string | null | undefined; label: string; dot: string }[] = [
  { value: undefined, label: 'Global', dot: 'bg-stone-600 opacity-50' },
  { value: null,      label: 'None',   dot: 'bg-stone-500' },
  { value: 'blue',    label: 'Blue',   dot: 'bg-blue-500' },
  { value: 'red',     label: 'Red',    dot: 'bg-red-500' },
  { value: 'gold',    label: 'Gold',   dot: 'bg-amber-400' },
]

const DEFAULT_GRADE: CustomGradeParams = {
  brightness: 1.0, contrast: 1.0, saturation: 1.0,
  exposure: 1.0, warmth: 0.0, tint: 0.0, hue_shift: 0,
}

function gradeToFilter(p: CustomGradeParams): string {
  const hue = p.hue_shift + (p.warmth * -12) + (p.tint * 8)
  const parts = [
    `brightness(${(p.brightness * p.exposure).toFixed(3)})`,
    `contrast(${p.contrast.toFixed(3)})`,
    `saturate(${p.saturation.toFixed(3)})`,
    `hue-rotate(${hue.toFixed(1)}deg)`,
  ]
  if (p.warmth > 0) parts.push(`sepia(${(p.warmth * 0.4).toFixed(3)})`)
  return parts.join(' ')
}

const CUSTOM_SLIDERS: { key: keyof CustomGradeParams; label: string; min: number; max: number; step: number; unit: string }[] = [
  { key: 'brightness', label: 'Brightness', min: 0,    max: 2,   step: 0.05, unit: '' },
  { key: 'contrast',   label: 'Contrast',   min: 0,    max: 2,   step: 0.05, unit: '' },
  { key: 'saturation', label: 'Saturation', min: 0,    max: 2,   step: 0.05, unit: '' },
  { key: 'exposure',   label: 'Exposure',   min: 0.5,  max: 1.5, step: 0.05, unit: '' },
  { key: 'warmth',     label: 'Warmth',     min: -1,   max: 1,   step: 0.05, unit: '' },
  { key: 'tint',       label: 'Tint',       min: -1,   max: 1,   step: 0.05, unit: '' },
  { key: 'hue_shift',  label: 'Hue Shift',  min: -180, max: 180, step: 1,    unit: '°' },
]

const PHILOSOPHER_NAMES = ['Marcus Aurelius', 'Seneca', 'Nietzsche', 'Socrates', 'Aristotle', 'Epictetus']

const DEFAULT_OVERLAY: TextOverlayConfig = {
  enabled: true,
  text: '',
  font: 'garamond',
  color: 'white',
  background_box: false,
  alignment: 'center',
  position: 'bottom-center',
  font_size_pct: 0.045,
}

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
  { value: 'white', label: 'White', dot: 'bg-white ring-1 ring-stone-500' },
  { value: 'cream', label: 'Cream', dot: 'bg-amber-50 ring-1 ring-stone-500' },
  { value: 'gold',  label: 'Yellow', dot: 'bg-yellow-300' },
  { value: 'black', label: 'Black', dot: 'bg-stone-900 ring-1 ring-stone-500' },
]

// 3×3 grid: [row][col] → { value, arrow }
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

const OVERLAY_PRESETS_KEY = 'cogito_overlay_presets'

type OverlayPreset = {
  id: string
  name: string
  settings: Omit<TextOverlayConfig, 'text' | 'enabled'>
}

// ── Overlay preview helpers ────────────────────────────────────────────────────

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

const POSITION_FLEX: Record<OverlayPosition, { items: string; justify: string; textAlign: string }> = {
  'top-left':      { items: 'flex-start', justify: 'flex-start',  textAlign: 'left' },
  'top-center':    { items: 'flex-start', justify: 'center',      textAlign: 'center' },
  'top-right':     { items: 'flex-start', justify: 'flex-end',    textAlign: 'right' },
  'middle-left':   { items: 'center',     justify: 'flex-start',  textAlign: 'left' },
  'middle-center': { items: 'center',     justify: 'center',      textAlign: 'center' },
  'middle-right':  { items: 'center',     justify: 'flex-end',    textAlign: 'right' },
  'bottom-left':   { items: 'flex-end',   justify: 'flex-start',  textAlign: 'left' },
  'bottom-center': { items: 'flex-end',   justify: 'center',      textAlign: 'center' },
  'bottom-right':  { items: 'flex-end',   justify: 'flex-end',    textAlign: 'right' },
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
        {/* Magnify button */}
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
        {/* Drag handle */}
        <div
          onPointerDown={onDragHandlePointerDown}
          className="absolute bottom-0 left-0 right-0 h-5 flex items-center justify-center cursor-ns-resize select-none"
          title="Drag to resize"
        >
          <div className="w-8 h-1 rounded-full bg-stone-600 group-hover:bg-stone-400 transition-colors" />
        </div>
      </div>

      {/* Enlarged overlay */}
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

// ── Sub-components ─────────────────────────────────────────────────────────────

function AdjustIcon() {
  return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
    </svg>
  )
}

function BatchStylePopover({
  batch,
  onChange,
  onClose,
  onApplyOverlayToAll,
}: {
  batch: VisualBatch
  onChange: (patch: Partial<VisualBatch>) => void
  onClose: () => void
  onApplyOverlayToAll?: (overlay: TextOverlayConfig) => void
}) {
  const params = batch.customGradeParams ?? DEFAULT_GRADE
  const [hoveredPreview, setHoveredPreview] = useState<{ type: 'theme' | 'accent'; value: string } | null>(null)
  const [fineTuneOpen, setFineTuneOpen] = useState(batch.colorTheme === 'custom')
  const [overlayPresets, setOverlayPresets] = useState<OverlayPreset[]>(() => {
    try { return JSON.parse(localStorage.getItem(OVERLAY_PRESETS_KEY) || '[]') } catch { return [] }
  })
  const [savingPreset, setSavingPreset] = useState(false)
  const [presetName, setPresetName] = useState('')

  function saveOverlayPreset(ov: TextOverlayConfig) {
    const name = presetName.trim() || 'Preset'
    const { text: _t, enabled: _e, ...settings } = ov
    const preset: OverlayPreset = { id: crypto.randomUUID(), name, settings }
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

  return (
    <>
      {/* Click-away overlay */}
      <div className="fixed inset-0 z-20" onClick={onClose} />

      {/* Popover panel */}
      <div className="absolute top-full left-0 mt-1 z-30 w-72 rounded-xl border border-stone-700 bg-stone-900 shadow-2xl">

        {/* Hover preview — right of popover on desktop, fixed bottom-right on mobile */}
        {hoveredPreview && (
          <div className="fixed bottom-4 right-4 sm:absolute sm:bottom-auto sm:right-auto sm:left-full sm:top-1/2 sm:-translate-y-1/2 sm:ml-2 w-28 rounded-lg border border-stone-600 bg-stone-900 shadow-xl overflow-hidden z-50 pointer-events-none">
            <div className="relative w-full bg-stone-950" style={{ aspectRatio: '9/16' }}>
              <video
                key={`${hoveredPreview.type}-${hoveredPreview.value}`}
                src={hoveredPreview.type === 'theme'
                  ? `/theme-previews/${hoveredPreview.value}.mp4`
                  : `/accent-previews/${hoveredPreview.value}.mp4`}
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                className="absolute inset-0 w-full h-full object-cover"
              />
            </div>
          </div>
        )}

        <div className="p-3 space-y-3">

          {/* Theme */}
          <div>
            <p className="mb-2 text-[10px] font-semibold tracking-widest uppercase text-stone-500">Colour theme</p>
            <div className="grid grid-cols-2 gap-1">
              {BATCH_THEME_OPTIONS.map(opt => {
                const isSelected = batch.colorTheme === opt.value
                const hasPreview = opt.value !== undefined && THEMES_WITH_PREVIEW_VIDEO.has(opt.value)
                return (
                  <button
                    key={opt.value ?? '_global'}
                    onClick={() => onChange({
                      colorTheme: opt.value,
                      customGradeParams: opt.value === 'custom'
                        ? (batch.customGradeParams ?? DEFAULT_GRADE)
                        : undefined,
                    })}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-left transition ${
                      isSelected
                        ? 'bg-stone-700 text-stone-100 ring-1 ring-stone-500'
                        : 'bg-stone-800 text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${opt.dot}`} />
                    <span className="flex-1">{opt.label}</span>
                    {hasPreview && (
                      <span
                        className={`shrink-0 transition-colors ${hoveredPreview?.type === 'theme' && hoveredPreview.value === opt.value ? 'text-stone-200' : 'text-stone-600 hover:text-stone-400'}`}
                        onMouseEnter={e => { e.stopPropagation(); setHoveredPreview({ type: 'theme', value: opt.value! }) }}
                        onMouseLeave={() => setHoveredPreview(null)}
                        onClick={e => e.stopPropagation()}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Fine-tune grade — collapsible, available for any selected theme */}
            {batch.colorTheme !== undefined && batch.colorTheme !== 'none' && (
              <div className="mt-2 pt-2 border-t border-stone-800">
                <button
                  onClick={() => setFineTuneOpen(o => !o)}
                  className="flex items-center justify-between w-full text-left"
                >
                  <span className="text-[10px] font-semibold tracking-widest uppercase text-stone-500">
                    {batch.colorTheme === 'custom' ? 'Grade settings' : 'Fine-tune grade'}
                  </span>
                  <svg className={`w-3 h-3 text-stone-600 transition-transform ${fineTuneOpen ? 'rotate-180' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {fineTuneOpen && (() => {
                  const isCustom = batch.colorTheme === 'custom'
                  const gradeParams = isCustom
                    ? (batch.customGradeParams ?? DEFAULT_GRADE)
                    : (batch.customGradeParams ?? THEME_GRADE_DEFAULTS[batch.colorTheme!] ?? DEFAULT_GRADE)
                  return (
                    <div className="mt-2 space-y-2">
                      {!isCustom && (
                        <p className="text-[9px] text-stone-600 italic">
                          Starting from {BATCH_THEME_OPTIONS.find(o => o.value === batch.colorTheme)?.label ?? ''} defaults — adjusting switches to Custom grade
                        </p>
                      )}
                      <div className="flex items-start gap-2">
                        <video
                          src="/theme-previews/eastern-philosophy.mp4"
                          autoPlay muted loop playsInline
                          className="w-12 rounded-md shrink-0 object-cover"
                          style={{ aspectRatio: '9/16', filter: gradeToFilter(gradeParams) }}
                        />
                        <div className="flex-1 space-y-1.5">
                          {CUSTOM_SLIDERS.map(s => (
                            <div key={s.key}>
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[9px] text-stone-400">{s.label}</span>
                                <span className="text-[9px] font-mono text-stone-300">
                                  {gradeParams[s.key].toFixed(s.step < 1 ? 2 : 0)}{s.unit}
                                </span>
                              </div>
                              <input
                                type="range"
                                min={s.min}
                                max={s.max}
                                step={s.step}
                                value={gradeParams[s.key]}
                                onChange={e => onChange({
                                  colorTheme: 'custom',
                                  customGradeParams: { ...gradeParams, [s.key]: parseFloat(e.target.value) },
                                })}
                                className="w-full accent-violet-500"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                      {!isCustom && (
                        <button
                          onClick={() => onChange({ colorTheme: 'custom', customGradeParams: THEME_GRADE_DEFAULTS[batch.colorTheme!] ?? DEFAULT_GRADE })}
                          className="text-[9px] text-violet-400 hover:text-violet-300 transition"
                        >
                          Use as Custom grade →
                        </button>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}
          </div>

          <hr className="border-stone-800" />

          {/* Accent */}
          <div>
            <p className="mb-2 text-[10px] font-semibold tracking-widest uppercase text-stone-500">Accent images</p>
            <div className="flex flex-wrap gap-1.5">
              {BATCH_ACCENT_OPTIONS.map(opt => {
                const key = opt.value === undefined ? '_global' : opt.value === null ? '_none' : opt.value
                const isSelected = batch.accentFolder === opt.value
                const hasPreview = typeof opt.value === 'string'
                return (
                  <button
                    key={key}
                    onClick={() => onChange({ accentFolder: opt.value })}
                    onMouseEnter={hasPreview ? () => setHoveredPreview({ type: 'accent', value: opt.value as string }) : undefined}
                    onMouseLeave={hasPreview ? () => setHoveredPreview(null) : undefined}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition ${
                      isSelected
                        ? 'bg-stone-700 text-stone-100 ring-1 ring-stone-500'
                        : 'bg-stone-800 text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${opt.dot}`} />
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          <hr className="border-stone-800" />

          {/* Philosopher — coming soon */}
          <div className="opacity-40 pointer-events-none select-none">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-[10px] font-semibold tracking-widest uppercase text-stone-500">Philosopher</p>
              <span className="text-[9px] font-semibold bg-stone-800 text-stone-500 border border-stone-700/60 px-1.5 py-0.5 rounded-full">Soon</span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {PHILOSOPHER_NAMES.map(name => (
                <div
                  key={name}
                  className="flex items-center justify-center px-2 py-1.5 rounded-lg border border-stone-700 bg-stone-800/60 text-[10px] text-stone-500 text-center leading-tight"
                >
                  {name}
                </div>
              ))}
            </div>
          </div>

          <hr className="border-stone-800" />

          {/* Text overlay */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold tracking-widest uppercase text-stone-500">Text overlay</p>
              <button
                onClick={() => {
                  const current = batch.textOverlay
                  if (!current) {
                    onChange({ textOverlay: { ...DEFAULT_OVERLAY, enabled: true } })
                  } else {
                    onChange({ textOverlay: { ...current, enabled: !current.enabled } })
                  }
                }}
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                  batch.textOverlay?.enabled ? 'bg-brand-500' : 'bg-stone-700'
                }`}
              >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  batch.textOverlay?.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                }`} />
              </button>
            </div>

            {batch.textOverlay?.enabled && (() => {
              const ov = batch.textOverlay!
              return (
                <div className="space-y-2.5">

                  {/* Presets */}
                  {(overlayPresets.length > 0 || true) && (
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
                                onClick={() => onChange({ textOverlay: { ...ov, ...preset.settings } })}
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
                  )}

                  {/* Text input */}
                  <textarea
                    rows={2}
                    value={ov.text}
                    onChange={e => onChange({ textOverlay: { ...ov, text: e.target.value } })}
                    placeholder="Type overlay text…"
                    maxLength={200}
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
                                onClick={() => onChange({ textOverlay: { ...ov, font: f.value } })}
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
                          onClick={() => onChange({ textOverlay: { ...ov, color: c.value } })}
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
                        onClick={() => onChange({ textOverlay: { ...ov, color: 'custom' } })}
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
                        onChange={e => onChange({ textOverlay: { ...ov, custom_color: e.target.value } })}
                        className="mt-1.5 h-7 w-full rounded cursor-pointer bg-stone-800 border border-stone-700"
                      />
                    )}
                  </div>

                  {/* Background box */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ov.background_box}
                      onChange={e => onChange({ textOverlay: { ...ov, background_box: e.target.checked } })}
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
                          onClick={() => onChange({ textOverlay: { ...ov, position: pos.value } })}
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
                          onClick={() => onChange({ textOverlay: { ...ov, alignment: a.value } })}
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
                      onChange={e => onChange({ textOverlay: { ...ov, font_size_pct: parseFloat(e.target.value) } })}
                      className="w-full accent-brand-500"
                    />
                  </div>

                  {/* Apply overlay to all batches */}
                  {onApplyOverlayToAll && (
                    <button
                      onClick={() => onApplyOverlayToAll(ov)}
                      className="w-full rounded-lg border border-stone-700 px-2 py-1.5 text-[10px] text-stone-400 hover:border-stone-500 hover:text-stone-200 transition"
                    >
                      Apply overlay to all batches
                    </button>
                  )}
                </div>
              )
            })()}
          </div>

        </div>
      </div>
    </>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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

// ── Main component ─────────────────────────────────────────────────────────────

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
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [openPopover, setOpenPopover] = useState<number | null>(null)

  function visualToBatchOutputs(vBatches: VisualBatch[], paths: Record<number, string[]>): BatchOutput[] {
    return vBatches.map((b, i) => ({
      title: b.title.trim() || null,
      terms: parseBatchText(b.terms),
      uploaded_image_paths: paths[i] ?? [],
      color_theme: b.colorTheme,
      custom_grade_params: b.customGradeParams,
      accent_folder_override: b.accentFolder,
      text_overlay: b.textOverlay,
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
        colorTheme: b.colorTheme,
        customGradeParams: b.customGradeParams,
        accentFolder: b.accentFolder,
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

  function handleBatchOverride(idx: number, patch: Partial<VisualBatch>) {
    const updated = batches.map((b, i) => (i === idx ? { ...b, ...patch } : b))
    setBatches(updated)
    onBatchesChange(visualToBatchOutputs(updated, uploadedPaths))
  }

  function handleApplyOverlayToAll(overlay: TextOverlayConfig) {
    const updated = batches.map(b => ({ ...b, textOverlay: overlay }))
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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-y-1.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-stone-300">Search terms</h2>
          {onOpenPrompt && (
            <button
              onClick={onOpenPrompt}
              className="flex items-center gap-1 text-xs text-stone-500 hover:text-brand-400 transition ml-2"
              title="Get search terms using AI"
            >
              <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.347a3.75 3.75 0 01-5.304 0l-.356-.356a5 5 0 010-7.072z" />
              </svg>
              <span>Get terms with AI</span>
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
            One search term per line. Use <code className="font-mono text-stone-500"># Batch Title</code> to start a new batch. Each batch becomes a separate video.
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
          {batches.map((batch, idx) => {
            const themeOpt = BATCH_THEME_OPTIONS.find(o => o.value === batch.colorTheme)
            const hasThemeOverride = batch.colorTheme !== undefined
            const hasAccentOverride = batch.accentFolder !== undefined
            const hasTextOverlay = !!(batch.textOverlay?.enabled && batch.textOverlay.text.trim())
            const hasOverride = hasThemeOverride || hasAccentOverride || hasTextOverlay

            return (
              <div
                key={idx}
                className={`rounded-xl border bg-stone-800 p-3 transition-colors ${dragOverIdx === idx ? 'border-brand-500/60 bg-stone-800/80' : 'border-stone-700'}`}
                onDragOver={e => { e.preventDefault(); setDragOverIdx(idx) }}
                onDragEnter={e => { e.preventDefault(); setDragOverIdx(idx) }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverIdx(null) }}
                onDrop={e => { e.preventDefault(); setDragOverIdx(null); handleFileUpload(idx, e.dataTransfer.files) }}
              >
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

                {/* Bottom row: style override button + image upload */}
                <div className="mt-2 flex flex-wrap items-center gap-2">

                  {/* Per-batch style trigger */}
                  <div className="relative">
                    <button
                      data-tour={idx === 0 ? 'batch-style-btn' : undefined}
                      onClick={() => setOpenPopover(p => p === idx ? null : idx)}
                      className={`flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs transition ${
                        hasOverride
                          ? 'border-stone-600 bg-stone-700/60 text-stone-300 hover:border-stone-500'
                          : 'border-stone-700 text-stone-500 hover:border-stone-600 hover:text-stone-400'
                      }`}
                    >
                      {hasThemeOverride ? (
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${themeOpt?.dot ?? 'bg-stone-500'}`} />
                      ) : (
                        <AdjustIcon />
                      )}
                      <span>
                        {hasThemeOverride
                          ? themeOpt?.shortLabel ?? 'Custom'
                          : 'Style'}
                        {hasAccentOverride && (
                          <span className="text-stone-500 ml-1">
                            · {BATCH_ACCENT_OPTIONS.find(o => o.value === batch.accentFolder)?.label ?? 'accent'}
                          </span>
                        )}
                        {hasTextOverlay && (
                          <span className="text-stone-500 ml-1">· Text</span>
                        )}
                      </span>
                    </button>

                    {openPopover === idx && (
                      <BatchStylePopover
                        batch={batch}
                        onChange={patch => handleBatchOverride(idx, patch)}
                        onClose={() => setOpenPopover(null)}
                        onApplyOverlayToAll={batches.length > 1 ? handleApplyOverlayToAll : undefined}
                      />
                    )}
                  </div>

                  {/* Image upload */}
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
                    uploadedPaths[idx].map((path, pi) => (
                      <span key={pi} className="flex items-center gap-1 rounded border border-stone-700 bg-stone-900 px-2 py-0.5 text-xs text-stone-400">
                        <span className="max-w-[120px] truncate">{path.split('/').pop()}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const next = { ...uploadedPaths, [idx]: uploadedPaths[idx].filter((_, i) => i !== pi) }
                            setUploadedPaths(next)
                            onBatchesChange(visualToBatchOutputs(batches, next))
                          }}
                          className="text-stone-600 hover:text-red-400 transition-colors leading-none"
                        >✕</button>
                      </span>
                    ))
                  )}
                </div>
              </div>
            )
          })}
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
