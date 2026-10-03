// The game's own 5x7 pixel font (png.ts draws it into og:images) as glyph masks and inline SVG, for
// the site's display type. One SVG per word and one <g> per glyph, so words wrap like text and each
// letter can move on its own; the real words always sit beside it for readers and assistive tech.
// Shared by the server and the client bundle.
import { createCanvas } from './png.ts'

export const GLYPH_W = 5
export const GLYPH_H = 9

const cache = new Map<string, number[]>()

/** A glyph as 9 rows of 5-bit masks (bit 4 is the leftmost column); rows 7 and 8 are descenders. */
export function glyph(ch: string): number[] {
  let g = cache.get(ch)
  if (g) return g
  if (ch === '…') g = [0, 0, 0, 0, 0, 0, 0b10101, 0, 0]
  else {
    const c = createCanvas(GLYPH_W, GLYPH_H)
    c.drawText(0, 0, ch, '#000')
    g = Array.from({ length: GLYPH_H }, (_, y) => {
      let m = 0
      for (let x = 0; x < GLYPH_W; x++) if (c.data[(y * GLYPH_W + x) * 4 + 3]) m |= 1 << (GLYPH_W - 1 - x)
      return m
    })
  }
  cache.set(ch, g)
  return g
}

/** True when every character has a pixel glyph (ASCII, the middle dot and the ellipsis). */
export const pixelable = (s: string) => /^[\x20-\x7e·…]*$/.test(s)

/** One glyph's pixels as an SVG path at column offset `ox`. */
export function glyphPath(ch: string, ox = 0): string {
  let d = ''
  glyph(ch).forEach((m, y) => {
    for (let x = 0; x < GLYPH_W;) {
      if (!(m & (1 << (GLYPH_W - 1 - x)))) { x++; continue }
      let n = 1
      while (x + n < GLYPH_W && m & (1 << (GLYPH_W - 1 - x - n))) n++
      d += `M${ox + x} ${y}h${n}v1h-${n}z`
      x += n
    }
  })
  return d
}

// ---- proportional metrics ----------------------------------------------------------------------
// Each glyph advances by its own ink (leftmost to rightmost set column) plus one column of air, so i,
// l, 1 and the stops no longer sit in cells as wide as W and m. A pair tucks one column closer when no
// row of the second glyph comes within one column of the first, even diagonally (r., Ta, y,, L').

const inkCache = new Map<string, [number, number]>()
/** A glyph's leftmost inked column and its ink width; a blank glyph is 2 columns of space. */
export function ink(ch: string): [left: number, width: number] {
  let v = inkCache.get(ch)
  if (v) return v
  const all = glyph(ch).reduce((a, m) => a | m, 0)
  if (!all) v = [0, 2]
  else {
    let l = 0, r = GLYPH_W - 1
    while (!(all & (1 << (GLYPH_W - 1 - l)))) l++
    while (!(all & (1 << (GLYPH_W - 1 - r)))) r--
    v = [l, r - l + 1]
  }
  inkCache.set(ch, v)
  return v
}

/** The set columns of one glyph row, relative to the glyph's ink start. */
const cols = (m: number, left: number) => { const c: number[] = []; for (let x = 0; x < GLYPH_W; x++) if (m & (1 << (GLYPH_W - 1 - x))) c.push(x - left); return c }

/** -1 when b can sit one column closer to a and still keep a clear column on every side, else 0. */
export function kern(a: string, b: string): number {
  const ga = glyph(a), gb = glyph(b), [la, wa] = ink(a), [lb] = ink(b)
  if (!ga.some(Boolean) || !gb.some(Boolean)) return 0
  for (let ya = 0; ya < GLYPH_H; ya++) {
    const ra = cols(ga[ya]!, la).pop()
    if (ra === undefined) continue
    for (let yb = Math.max(0, ya - 1); yb <= Math.min(GLYPH_H - 1, ya + 1); yb++) {
      const lb2 = cols(gb[yb]!, lb)[0]
      if (lb2 !== undefined && lb2 + wa - ra < 2) return 0
    }
  }
  return -1
}

/**
 * Where each glyph of a word starts (its origin, so its ink lands on the pen) and the word's width,
 * in glyph pixels, or in half pixels for the bold cut (ink doubled and grown one, 2 of shadow, 1 of air).
 */
export function layoutWord(word: string, bold = false): { at: number[]; w: number } {
  const chars = [...word], k = bold ? 2 : 1, at: number[] = []
  let pen = 0
  chars.forEach((ch, i) => {
    const [left, w] = ink(ch)
    if (i) pen += kern(chars[i - 1]!, ch) * k
    at.push(pen - left * k)
    pen += bold ? 2 * w + 4 : w + 1
  })
  return { at, w: Math.max(1, pen - 1) }
}

/** One word as an SVG in currentColor, sized by the `--gp` (glyph pixel) custom property. */
export function wordSvg(word: string, cls = 'pw'): string {
  const chars = [...word]
  const { at, w } = layoutWord(word)
  const gs = chars.map((ch, i) => (ch === ' ' ? '' : `<g><path d="${glyphPath(ch, at[i])}"/></g>`)).join('')
  return `<svg class="${cls}" viewBox="0 0 ${w} ${GLYPH_H}" style="--w:${w}" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${gs}</svg>`
}

/**
 * Pixel words for a visible line, decorative: callers put the real text beside it (`.sr`). Words
 * are separate SVGs with a break opportunity between them, so the line wraps per word.
 */
export function pixelWords(text: string, cls = 'pt'): string {
  return `<span class="${cls}" aria-hidden="true">${text.split(' ').filter(Boolean).map(w => wordSvg(w)).join(' ')}</span>`
}

// ---- the bold cut: headings ---------------------------------------------------------------------

// The bold cut is drawn on a half-pixel grid: every glyph pixel becomes 2 x 2 half pixels, and every
// run of ink grows one half pixel to the right. Stems come out half again as heavy, while the one-pixel
// gaps inside m, w and M stay open. Under it sits the same shape one whole glyph pixel down and right,
// as its shadow. Units below are half pixels.

export const BOLD_H = GLYPH_H * 2 + 2
const BOLD_W = GLYPH_W * 2 + 1

/** Runs of set bits in BOLD_W-bit rows, as one path. */
function rowsPath(rows: number[], ox: number, oy: number): string {
  let d = ''
  rows.forEach((m, y) => {
    for (let x = 0; x < BOLD_W;) {
      if (!(m & (1 << (BOLD_W - 1 - x)))) { x++; continue }
      let n = 1
      while (x + n < BOLD_W && m & (1 << (BOLD_W - 1 - x - n))) n++
      d += `M${ox + x} ${oy + y}h${n}v1h-${n}z`
      x += n
    }
  })
  return d
}

/** A glyph row doubled to 10 half-pixel columns, then emboldened one half pixel to the right. */
const boldRow = (m: number) => {
  let wide = 0
  for (let x = 0; x < GLYPH_W; x++) if (m & (1 << (GLYPH_W - 1 - x))) wide |= 0b11 << (BOLD_W - 2 - 2 * x)
  return wide | (wide >> 1)
}

/** One glyph in the bold cut: its face, and its shadow one glyph pixel down and right. */
export function boldGlyph(ch: string, ox = 0): { face: string; shade: string } {
  const rows = glyph(ch).flatMap(m => [boldRow(m), boldRow(m)])
  return { face: rowsPath(rows, ox, 0), shade: rowsPath(rows, ox + 2, 2) }
}

/** The id of a bold glyph's shared shape (boldDefs). */
const boldId = (ch: string) => `bg${ch.codePointAt(0)}`

/**
 * One word in the bold cut: a <g> per letter (the shade, then the face), in currentColor. --w is in
 * half pixels. Pages reference each letter's one shared shape (boldDefs) with <use>, so a heading
 * costs a few bytes a letter; `inline` draws the paths instead (for script-made words).
 */
export function boldWordSvg(word: string, cls = 'pw bd', inline = false): string {
  const chars = [...word]
  const { at, w } = layoutWord(word, true)
  const gs = chars.map((ch, i) => {
    if (ch === ' ') return ''
    const ox = at[i]!
    if (!inline) return `<g><use class="sh" href="#${boldId(ch)}" x="${ox + 2}" y="2"/><use href="#${boldId(ch)}" x="${ox}"/></g>`
    const g = boldGlyph(ch, ox)
    return `<g><path class="sh" d="${g.shade}"/><path d="${g.face}"/></g>`
  }).join('')
  return `<svg class="${cls}" viewBox="0 0 ${w} ${BOLD_H}" style="--w:${w}" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${gs}</svg>`
}

/** A heading line in the bold cut, decorative like pixelWords. */
export function boldWords(text: string, cls = 'pt'): string {
  return `<span class="${cls}" aria-hidden="true">${text.split(' ').filter(Boolean).map(w => boldWordSvg(w)).join(' ')}</span>`
}

/** The shared bold shapes for every letter a page's markup refers to, once each, in one hidden <svg>. */
export function boldDefs(markup: string): string {
  const codes = new Set<number>()
  for (const m of markup.matchAll(/href="#bg(\d+)"/g)) codes.add(Number(m[1]))
  if (!codes.size) return ''
  const paths = [...codes].sort((a, b) => a - b).map(c => `<path id="bg${c}" d="${boldGlyph(String.fromCodePoint(c)).face}"/>`).join('')
  return `<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>${paths}</defs></svg>`
}
