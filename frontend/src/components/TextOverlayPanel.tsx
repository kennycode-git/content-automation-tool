/**
 * TextOverlayPanel.tsx
 *
 * Reusable text overlay configuration UI — used by ClipsSettingsPanel and LayeredPanel.
 * Renders the full section: enabled toggle header + all controls + live preview.
 */

import { useRef, useState } from 'react'
import type { OverlayAlignment, OverlayColor, OverlayFont, OverlayPosition, TextOverlayConfig } from '../lib/api'

// ── Constants ──────────────────────────────────────────────────────────────────

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
  garamond:    '"Overlay Garamond", Georgia, "Times New Roman", serif',
  cormorant:   '"Overlay Cormorant", "Palatino Linotype", Georgia, serif',
  playfair:    '"Overlay Playfair", "Palatino Linotype", Georgia, serif',
  crimson:     '"Overlay Crimson", Georgia, serif',
  philosopher: '"Overlay Philosopher", Georgia, serif',
  lora:        '"Overlay Lora", Georgia, serif',
  outfit:      '"Overlay Outfit", system-ui, -apple-system, sans-serif',
  raleway:     '"Overlay Raleway", system-ui, -apple-system, sans-serif',
  josefin:     '"Overlay Josefin", system-ui, -apple-system, sans-serif',
  inter:       '"Overlay Inter", system-ui, -apple-system, sans-serif',
  cinzel:      '"Overlay Cinzel", "Times New Roman", serif',
  cinzel_deco: '"Overlay Cinzel Deco", "Times New Roman", serif',
  uncial:      '"Overlay Uncial", Georgia, serif',
  jetbrains:   '"Overlay JetBrains Mono", "Courier New", Courier, monospace',
  space_mono:  '"Overlay Space Mono", "Courier New", Courier, monospace',
}

const COLOR_HEX_MAP: Record<string, string> = {
  white: '#ffffff',
  cream: '#f5f0e8',
  gold:  '#f5e317',
  black: '#000000',
}

const OVERLAY_PRESETS_KEY = 'cogito_overlay_presets'

type OverlayPreset = {
  id: string
  name: string
  settings: Omit<TextOverlayConfig, 'text' | 'enabled'>
}

function overlayColorHex(ov: TextOverlayConfig): string {
  if (ov.color === 'custom') return ov.custom_color ?? '#ffffff'
  return COLOR_HEX_MAP[ov.color] ?? '#ffffff'
}

// ── OverlayPreview ─────────────────────────────────────────────────────────────

function OverlayPreview({ ov }: { ov: TextOverlayConfig }) {
  const [enlarged, setEnlarged] = useState(false)
  const [previewH, setPreviewH] = useState(200)
  const dragStartRef = useRef<{ y: number; h: number } | null>(null)
  const BASE_H = 540
  const BASE_W = 304

  const color = overlayColorHex(ov)
  const fontFamily = FONT_CSS_FAMILY[ov.font as OverlayFont] ?? 'Georgia, serif'

  function PreviewBox() {
    const h = BASE_H
    const w = BASE_W
    const fontSize = Math.max(3, Math.round(h * (ov.font_size_pct ?? 0.015)))
    const marginPct = ov.margin_pct ?? 0.05
    const marginX = Math.round(w * marginPct)
    const marginY = Math.round(h * marginPct)
    const usableW = Math.max(10, w - 2 * marginX)
    const lineHeight = Math.max(1, Math.round(fontSize * 1.25))

    const charsPerLine = Math.max(10, Math.floor(usableW / (fontSize * 0.52)))

    const rawInput = ov.text.trim() || 'Preview text'
    const previewLines: string[] = []
    for (const seg of rawInput.replace(/\r\n/g, '\n').split('\n')) {
      if (!seg.trim()) { previewLines.push(''); continue }
      const words = seg.split(' ')
      let cur = ''
      for (const word of words) {
        if (!cur) { cur = word }
        else if (cur.length + 1 + word.length <= charsPerLine) { cur += ' ' + word }
        else { previewLines.push(cur); cur = word }
      }
      if (cur) previewLines.push(cur)
    }
    if (!previewLines.some(l => l)) previewLines.push('Preview text')

    let maxLineWidthPx = 0
    try {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.font = `${fontSize}px ${fontFamily}`
        maxLineWidthPx = previewLines
          .filter(l => l)
          .reduce((max, l) => Math.max(max, ctx.measureText(l).width), 0)
      }
    } catch { /* ignore */ }
    if (!maxLineWidthPx) {
      const maxLineLen = previewLines.reduce((max, l) => Math.max(max, l.length), 5)
      maxLineWidthPx = Math.min(maxLineLen / charsPerLine, 1.0) * usableW
    }
    const blockW = Math.max(20, Math.min(Math.round(maxLineWidthPx), usableW))

    const [vertPart, horizPart] = (ov.position as OverlayPosition).split('-') as ['top' | 'middle' | 'bottom', 'left' | 'center' | 'right']

    const blockLeft = horizPart === 'left' ? marginX
      : horizPart === 'right' ? w - marginX - blockW
      : Math.round((w - blockW) / 2)

    const vertStyle: React.CSSProperties = vertPart === 'top'
      ? { top: marginY }
      : vertPart === 'bottom'
      ? { bottom: marginY }
      : { top: '50%', transform: 'translateY(-50%)' }

    const textStyle: React.CSSProperties = {
      color, fontFamily, fontSize,
      lineHeight: `${lineHeight}px`,
      height: lineHeight,
      textAlign: (ov.alignment ?? 'center') as React.CSSProperties['textAlign'],
      whiteSpace: 'pre',
      overflow: 'hidden',
      ...(ov.background_box ? { background: 'rgba(0,0,0,0.55)', padding: '0 3px', borderRadius: 2 } : {}),
      ...(ov.outline ? { textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000' } : {}),
    }

    return (
      <div style={{
        width: w, height: h,
        background: '#0e0e0e',
        borderRadius: 4,
        overflow: 'hidden',
        position: 'relative',
        border: '1px solid #333',
        flexShrink: 0,
      }}>
        {previewLines.filter(l => l).map((line, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: blockLeft,
            width: blockW,
            ...vertStyle,
            ...(vertPart !== 'middle' ? {
              [vertPart === 'top' ? 'top' : 'bottom']:
                vertPart === 'top'
                  ? marginY + i * lineHeight
                  : marginY + (previewLines.filter(l => l).length - 1 - i) * lineHeight,
            } : {
              top: '50%',
              transform: `translateY(calc(-50% + ${(i - (previewLines.filter(l => l).length - 1) / 2) * lineHeight}px))`,
            }),
          }}>
            <div style={textStyle}>{line}</div>
          </div>
        ))}
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
        <div style={{ width: Math.round((BASE_W * previewH) / BASE_H), height: previewH, overflow: 'hidden' }}>
          <div
            style={{
              width: BASE_W,
              height: BASE_H,
              transform: `scale(${previewH / BASE_H})`,
              transformOrigin: 'top left',
            }}
          >
            <PreviewBox />
          </div>
        </div>
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
            <PreviewBox />
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

// ── Default config ─────────────────────────────────────────────────────────────

export const DEFAULT_TEXT_OVERLAY: TextOverlayConfig = {
  enabled: false,
  text: '',
  font: 'garamond',
  color: 'white',
  background_box: false,
  position: 'bottom-center',
  alignment: 'center',
  font_size_pct: 0.015,
  margin_pct: 0.05,
  outline: false,
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  value: TextOverlayConfig
  onChange: (v: TextOverlayConfig) => void
}

export default function TextOverlayPanel({ value: ov, onChange }: Props) {
  const [overlayPresets, setOverlayPresets] = useState<OverlayPreset[]>(() => {
    try { return JSON.parse(localStorage.getItem(OVERLAY_PRESETS_KEY) || '[]') } catch { return [] }
  })
  const [savingPreset, setSavingPreset] = useState(false)
  const [presetName, setPresetName] = useState('')

  function patch(partial: Partial<TextOverlayConfig>) {
    onChange({ ...ov, ...partial })
  }

  function saveOverlayPreset() {
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

  return (
    <div>
      {/* Toggle header */}
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-stone-400 uppercase tracking-wide">Text overlay</label>
        <button
          onClick={() => patch({ enabled: !ov.enabled })}
          className={`relative w-8 h-4 rounded-full transition-colors ${ov.enabled ? 'bg-brand-500' : 'bg-stone-700'}`}
        >
          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${ov.enabled ? 'left-4' : 'left-0.5'}`} />
        </button>
      </div>

      {ov.enabled && (
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
                    if (e.key === 'Enter') saveOverlayPreset()
                    if (e.key === 'Escape') { setSavingPreset(false); setPresetName('') }
                  }}
                  placeholder="Preset name…"
                  autoFocus
                  className="flex-1 rounded border border-stone-700 bg-stone-800 px-2 py-0.5 text-[10px] text-stone-100 placeholder-stone-600 focus:border-brand-500 focus:outline-none"
                />
                <button
                  onClick={saveOverlayPreset}
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
                      onClick={() => patch({ ...preset.settings })}
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
            onChange={e => patch({ text: e.target.value.slice(0, 200) })}
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
                        onClick={() => patch({ font: f.value })}
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
                  onClick={() => patch({ color: c.value })}
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
                onClick={() => patch({ color: 'custom' })}
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
                onChange={e => patch({ custom_color: e.target.value })}
                className="mt-1.5 h-7 w-full rounded cursor-pointer bg-stone-800 border border-stone-700"
              />
            )}
          </div>

          {/* Background box + Outline */}
          <div className="flex gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={ov.background_box}
                onChange={e => patch({ background_box: e.target.checked })}
                className="rounded border-stone-600 bg-stone-800 accent-brand-500"
              />
              <span className="text-[10px] text-stone-400">Background box</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={ov.outline ?? false}
                onChange={e => patch({ outline: e.target.checked })}
                className="rounded border-stone-600 bg-stone-800 accent-brand-500"
              />
              <span className="text-[10px] text-stone-400">Outline</span>
            </label>
          </div>

          {/* Position grid */}
          <div>
            <p className="mb-1 text-[9px] font-semibold tracking-widest uppercase text-stone-600">Position</p>
            <div className="grid grid-cols-3 gap-0.5">
              {OVERLAY_POSITIONS.flat().map(pos => (
                <button
                  key={pos.value}
                  onClick={() => patch({ position: pos.value })}
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
                  onClick={() => patch({ alignment: a.value })}
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
                {Math.round((ov.font_size_pct ?? 0.015) * 1000) / 10}%
              </span>
            </div>
            <input
              type="range"
              min={0.005}
              max={0.05}
              step={0.001}
              value={ov.font_size_pct ?? 0.015}
              onChange={e => patch({ font_size_pct: parseFloat(e.target.value) })}
              className="w-full accent-brand-500"
            />
          </div>

          {/* Margin */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <p className="text-[9px] font-semibold tracking-widest uppercase text-stone-600">Margin</p>
              <span className="text-[10px] font-mono text-stone-300">
                {Math.round((ov.margin_pct ?? 0.05) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={0.30}
              step={0.01}
              value={ov.margin_pct ?? 0.05}
              onChange={e => patch({ margin_pct: parseFloat(e.target.value) })}
              className="w-full accent-brand-500"
            />
          </div>

        </div>
      )}
    </div>
  )
}
