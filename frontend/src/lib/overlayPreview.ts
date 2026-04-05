import type { CSSProperties } from 'react'
import type { OverlayFont, OverlayPosition, TextOverlayConfig } from './api'

export const OVERLAY_FONT_CSS_FAMILY: Record<OverlayFont, string> = {
  garamond: '"Overlay Garamond", Georgia, "Times New Roman", serif',
  cormorant: '"Overlay Cormorant", "Palatino Linotype", Georgia, serif',
  playfair: '"Overlay Playfair", "Palatino Linotype", Georgia, serif',
  crimson: '"Overlay Crimson", Georgia, serif',
  philosopher: '"Overlay Philosopher", Georgia, serif',
  lora: '"Overlay Lora", Georgia, serif',
  outfit: '"Overlay Outfit", system-ui, -apple-system, sans-serif',
  raleway: '"Overlay Raleway", system-ui, -apple-system, sans-serif',
  josefin: '"Overlay Josefin", system-ui, -apple-system, sans-serif',
  inter: '"Overlay Inter", system-ui, -apple-system, sans-serif',
  cinzel: '"Overlay Cinzel", "Times New Roman", serif',
  cinzel_deco: '"Overlay Cinzel Deco", "Times New Roman", serif',
  uncial: '"Overlay Uncial", Georgia, serif',
  jetbrains: '"Overlay JetBrains Mono", "Courier New", Courier, monospace',
  space_mono: '"Overlay Space Mono", "Courier New", Courier, monospace',
}

const COLOR_HEX_MAP: Record<string, string> = {
  white: '#ffffff',
  cream: '#f5f0e8',
  gold: '#f5e317',
  black: '#000000',
}

function breakLongWord(word: string, width: number): string[] {
  if (!word) return ['']
  if (word.length <= width) return [word]
  const parts: string[] = []
  let rest = word
  while (rest.length > width) {
    parts.push(rest.slice(0, width))
    rest = rest.slice(width)
  }
  if (rest) parts.push(rest)
  return parts
}

function wrapSegment(segment: string, charsPerLine: number): string[] {
  const tokens = segment.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return ['']

  const lines: string[] = []
  let current = ''

  for (const token of tokens) {
    const pieces = breakLongWord(token, charsPerLine)
    for (const piece of pieces) {
      if (!current) {
        current = piece
        continue
      }
      const candidate = `${current} ${piece}`
      if (candidate.length <= charsPerLine) {
        current = candidate
      } else {
        lines.push(current)
        current = piece
      }
    }
  }

  if (current) lines.push(current)
  return lines
}

function measureMaxLineWidth(lines: string[], fontSize: number, fontFamily: string, usableWidth: number) {
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.font = `${fontSize}px ${fontFamily}`
      const measured = lines
        .filter(Boolean)
        .reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0)
      if (measured > 0) return Math.min(Math.round(measured), usableWidth)
    }
  } catch {
    // ignore and fall through to approximation
  }

  const maxLineLen = lines.reduce((max, line) => Math.max(max, line.length), 10)
  return Math.min(Math.round(maxLineLen * fontSize * 0.52), usableWidth)
}

export function overlayColorHex(ov: TextOverlayConfig): string {
  if (ov.color === 'custom') return ov.custom_color ?? '#ffffff'
  return COLOR_HEX_MAP[ov.color] ?? '#ffffff'
}

export function buildOverlayPreviewLayout(
  ov: TextOverlayConfig,
  width: number,
  height: number,
): {
  blockLeft: number
  blockWidth: number
  lines: string[]
  positions: number[]
  textStyle: CSSProperties
} {
  const fontFamily = OVERLAY_FONT_CSS_FAMILY[ov.font as OverlayFont] ?? 'Georgia, serif'
  const color = overlayColorHex(ov)
  const fontSize = Math.max(3, Math.round(height * (ov.font_size_pct ?? 0.045)))
  const marginPct = ov.margin_pct ?? 0.05
  const marginX = Math.round(width * marginPct)
  const marginY = Math.round(height * marginPct)
  const usableWidth = Math.max(10, width - 2 * marginX)
  const lineHeight = Math.max(1, Math.round(fontSize * 1.25))
  const charsPerLine = Math.max(1, Math.floor(usableWidth / (fontSize * 0.52)))

  const rawInput = ov.text.trim() || 'Preview text'
  const lines = rawInput
    .replace(/\r\n/g, '\n')
    .split('\n')
    .flatMap(segment => (segment.trim() ? wrapSegment(segment, charsPerLine) : ['']))

  const visibleLines = lines.filter(Boolean)
  const safeLines = visibleLines.length ? visibleLines : ['Preview text']
  const blockWidth = Math.max(20, measureMaxLineWidth(safeLines, fontSize, fontFamily, usableWidth))

  const [vertical, horizontal] = (ov.position as OverlayPosition).split('-') as ['top' | 'middle' | 'bottom', 'left' | 'center' | 'right']
  const blockLeft = horizontal === 'left'
    ? marginX
    : horizontal === 'right'
      ? width - marginX - blockWidth
      : Math.round((width - blockWidth) / 2)

  const totalLineCount = lines.length || 1
  const firstLineTop = vertical === 'top'
    ? marginY
    : vertical === 'middle'
      ? Math.round((height - totalLineCount * lineHeight) / 2)
      : height - marginY - totalLineCount * lineHeight

  const positions: number[] = []
  let visibleIndex = 0
  lines.forEach((line, idx) => {
    if (!line) return
    positions[visibleIndex] = firstLineTop + idx * lineHeight
    visibleIndex += 1
  })

  const textStyle: CSSProperties = {
    color,
    fontFamily,
    fontSize,
    lineHeight: `${lineHeight}px`,
    minHeight: lineHeight,
    textAlign: (ov.alignment ?? 'center') as CSSProperties['textAlign'],
    whiteSpace: 'pre',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    ...(ov.background_box ? { background: 'rgba(0,0,0,0.55)', padding: '0 3px', borderRadius: 2 } : {}),
    ...(ov.outline ? { textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000' } : {}),
  }

  return {
    blockLeft,
    blockWidth,
    lines,
    positions,
    textStyle,
  }
}
