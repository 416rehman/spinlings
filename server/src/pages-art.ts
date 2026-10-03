// Pixel art for the site: core sprites as compact inline SVG (one path per colour), silhouettes for
// unseen species, the pixel wordmark in png.ts's 5x7 font, and the 1200x630 og:image of a card.
import { cardName } from '../../plugin/hooks/core/cards.ts'
import { FAMILY_INFO } from '../../plugin/hooks/core/families.ts'
import { silhouette, spriteFor } from '../../plugin/hooks/core/sprite.ts'
import type { Pixels } from '../../plugin/hooks/core/sprite.ts'
import { TRAITS } from '../../plugin/hooks/core/traits.ts'
import type { BattleCard, CardStage, Form } from '../../plugin/hooks/core/types.ts'
import { FAMILY_COLOR, MYTHIC_COLOR, RARITY_COLOR } from '../../plugin/hooks/ui/tokens.ts'
import { escapeHtml } from './http.ts'
import { createCanvas, encodePng, textWidth } from './png.ts'

const T = -1
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0')

/** Every opaque pixel as `<path>`s, one per colour, each a list of horizontal runs. */
export function pixelPaths(px: Pixels, mono?: string): string {
  const runs = new Map<string, string>()
  px.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const c = row[x]!
      let n = 1
      while (x + n < row.length && row[x + n] === c) n++
      if (c !== T) {
        const fill = mono ?? hex(c)
        runs.set(fill, (runs.get(fill) ?? '') + `M${x} ${y}h${n}v1h-${n}z`)
      }
      x += n
    }
  })
  return [...runs].map(([fill, d]) => `<path fill="${fill}" d="${d}"/>`).join('')
}

export type SvgOptions = {
  /** rendered size in CSS px of one sprite pixel (the page's CSS may override it) */
  scale?: number
  /** an accessible name; without one the art is decorative */
  label?: string
  cls?: string
}

export function svgOf(px: Pixels, paths: string, o: SvgOptions = {}): string {
  const h = px.length, w = px[0]?.length ?? 0, s = o.scale ?? 4
  const a11y = o.label ? `role="img" aria-label="${escapeHtml(o.label)}"` : 'aria-hidden="true" focusable="false"'
  return `<svg class="${o.cls ?? 'px'}" viewBox="0 0 ${w} ${h}" width="${w * s}" height="${h * s}" shape-rendering="crispEdges" ${a11y}>${paths}</svg>`
}

// Sprites are pure functions of their source, so each is drawn once per isolate.
const memo = new Map<string, { px: Pixels; paths: string }>()
function memoized(key: string, make: () => Pixels, mono?: string) {
  let hit = memo.get(key)
  if (!hit) {
    const px = make()
    hit = { px, paths: pixelPaths(px, mono) }
    if (memo.size >= 1024) memo.delete(memo.keys().next().value!)
    memo.set(key, hit)
  }
  return hit
}

const formKey = (f: Form & { id?: string; seed?: string }) => [f.id ?? f.seed ?? '', f.family, f.body, f.hue, f.pattern, f.accessory, f.names[0], f.legendary].join(':')

/** A species or bare form in its plain album look; `shadow` draws it as a silhouette in currentColor. */
export function formSvg(form: Form, stage: CardStage, o: SvgOptions & { shadow?: boolean } = {}): string {
  const st: CardStage = form.legendary ? 3 : stage
  const key = `form|${formKey(form)}|${st}|${o.shadow ? 's' : 'c'}`
  const art = memoized(key, () => {
    const px = spriteFor({ form, stage: st })
    return o.shadow ? silhouette(px, 0) : px
  }, o.shadow ? 'currentColor' : undefined)
  return svgOf(art.px, art.paths, o)
}

/** A card exactly as the game draws it: its DNA look, stage and raised form. */
export function cardSvg(card: BattleCard, o: SvgOptions = {}): string {
  const key = `card|${card.species}|${card.form ? formKey(card.form) : ''}|${card.dna}|${card.stage}|${card.raisedIn ?? ''}|${card.shiny}|${card.rarity}`
  const art = memoized(key, () => spriteFor(card))
  return svgOf(art.px, art.paths, o)
}

/** Text in png.ts's pixel font (5x7 with descenders) as a grid of on/off pixels. */
export function pixelText(text: string): boolean[][] {
  const w = Math.max(1, textWidth(text)), h = 9
  const canvas = createCanvas(w, h)
  canvas.drawText(0, 0, text, '#000')
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => canvas.data[(y * w + x) * 4 + 3]! > 0))
}

/** Pixel-font text as inline SVG in currentColor, `scale` px per font pixel; decorative unless labelled. */
export function pixelTextSvg(text: string, o: SvgOptions = {}): string {
  const grid = pixelText(text)
  const px: Pixels = grid.map(r => r.map(on => (on ? 0 : T)))
  return svgOf(px, pixelPaths(px, 'currentColor'), { cls: 'ptext', ...o })
}

/** A tuft of meadow grass, 16x9, for the rustle. */
export const TUFT: Pixels = (() => {
  const rows = [
    '......1....1....',
    '..1...12..12..1.',
    '..12.122..22.12.',
    '.122.2222122.22.',
    '.2222222222222..',
    '1222223222322221',
    '2223222232222322',
    '2322232222223222',
    '2222222222222222',
  ]
  const ink: Record<string, number> = { '.': T, '1': 0x9ed36a, '2': 0x5f9f4a, '3': 0x3f7a3a }
  return rows.map(r => [...r].map(ch => ink[ch]!))
})()

export const tuftSvg = (o: SvgOptions = {}) => svgOf(TUFT, pixelPaths(TUFT), o)

/** Far hills behind the meadow, 240 x 16 pixels in currentColor: a stepped skyline from a few slow waves. */
export const hillsSvg = (() => {
  const W = 240, H = 16
  let d = ''
  for (let x = 0; x < W;) {
    const at = (i: number) => Math.round(7 + 3 * Math.sin(i / 17) + 2.2 * Math.sin(i / 7.3 + 1.3) + 1.4 * Math.sin(i / 29 + 2.1))
    const h = at(x)
    let n = 1
    while (x + n < W && at(x + n) === h) n++
    d += `M${x} ${H - h}h${n}v${h}h-${n}z`
    x += n
  }
  const svg = `<svg class="hills" viewBox="0 0 ${W} ${H}" width="${W * 4}" height="${H * 4}" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path fill="currentColor" d="${d}"/></svg>`
  return () => svg
})()

/** A few still motes of light over the meadow (shown at dusk only), 240 x 40 pixels. */
export const motesSvg = (() => {
  const spots = [[14, 9], [41, 17], [63, 6], [88, 22], [119, 11], [147, 19], [171, 7], [196, 15], [223, 24], [231, 8]]
  const d = spots.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join('')
  const svg = `<svg class="motes" viewBox="0 0 240 40" width="960" height="160" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path fill="currentColor" d="${d}"/></svg>`
  return () => svg
})()

// ---- the og:image (1200 x 630) -----------------------------------------------------------------

const OG = { w: 1200, h: 630 }
/** Family places (sky, ground, shade), as the site paints them. */
const PLACE_COLORS: Record<BattleCard['family'], [string, string, string]> = {
  haiku: ['#dcefe2', '#5fbf8f', '#1f5a45'], sonnet: ['#dbe6fa', '#5b8def', '#1d3570'], opus: ['#f8e0d3', '#e8744f', '#6a2a17'], fable: ['#e7defa', '#a874e8', '#3a2262'],
}
const INK = '#eceaf3', SOFT = '#a6a4b8', BG = '#141a26', PANEL = '#1d2534'

/** Fits text into `max` px wide at the largest scale from `big` down to `small`. */
const fit = (text: string, max: number, big: number, small: number) => {
  for (let s = big; s > small; s--) if (textWidth(text, s) <= max) return s
  return small
}

/** A name on one line, or two-word names on two lines, at the largest scale that fits. */
function fitName(name: string, max: number): { lines: string[]; scale: number } {
  const one = fit(name, max, 11, 6)
  if (textWidth(name, one) <= max && one >= 7) return { lines: [name], scale: one }
  const words = name.split(' ')
  if (words.length === 2) {
    const s = Math.min(fit(words[0]!, max, 7, 4), fit(words[1]!, max, 7, 4))
    return { lines: words.map(w => clip(w, max, s)), scale: s }
  }
  return { lines: [clip(name, max, one)], scale: one }
}

/** Cuts text to fit `max` px at `scale`, ending in '...'. */
function clip(text: string, max: number, scale: number): string {
  if (textWidth(text, scale) <= max) return text
  let t = text
  while (t.length > 1 && textWidth(t + '...', scale) > max) t = t.slice(0, -1)
  return t.trimEnd() + '...'
}

/** The card's share image: the creature on its rarity-framed card, its name and what it is. */
export async function cardPng(card: BattleCard, host: string): Promise<Uint8Array> {
  const c = createCanvas(OG.w, OG.h, BG)
  const mythic = card.species === 'mythic'
  const rarityColor = mythic ? MYTHIC_COLOR : RARITY_COLOR[card.rarity]
  const family = FAMILY_COLOR[card.family]

  // the family's place behind the card: its sky, a shaded ridge in stepped pixels, its ground
  const [sky, ground, shade] = PLACE_COLORS[card.family]
  c.fillRect(0, 0, 560, OG.h, sky)
  for (let x = 0; x < 560; x += 8) {
    const h = Math.round(140 + 40 * Math.sin(x / 90) + 24 * Math.sin(x / 37 + 1))
    c.fillRect(x, OG.h - h, 8, h, shade)
  }
  c.fillRect(0, OG.h - 96, 560, 96, ground)

  // the card: a rarity frame, a family-coloured floor, the sprite at 24x
  const fx = 84, fy = 51, fw = 448, fh = 528
  // foil: pixel rainbow bands all round the frame
  if (card.foil) ['#a874e8', '#5b8def', '#9ed36a', '#f2b33d', '#ff7ac6'].forEach((col, i) => c.fillRect(fx - 30 + i * 6, fy - 30 + i * 6, fw + 60 - i * 12, fh + 60 - i * 12, col))
  c.fillRect(fx, fy, fw, fh, rarityColor)
  c.fillRect(fx + 10, fy + 10, fw - 20, fh - 20, PANEL)
  c.fillRect(fx + 10, fy + fh - 106, fw - 20, 96, family)
  c.fillRect(fx + 10, fy + fh - 106, fw - 20, 8, '#00000033')
  const px = spriteFor(card)
  const s = 24, sx = fx + (fw - 16 * s) / 2, sy = fy + fh - 106 - 16 * s + 40
  c.drawPixels(sx, sy, px.map(r => r.map(v => (v === T ? null : hex(v)))), s)

  // the words
  const left = 588, width = OG.w - left - 56
  const name = fitName(cardName(card), width)
  name.lines.forEach((line, i) => c.drawText(left, 84 + i * 10 * name.scale, line, INK, name.scale))
  let y = 84 + name.lines.length * 10 * name.scale + 18
  const rarity = mythic ? 'Mythic' : card.rarity[0]!.toUpperCase() + card.rarity.slice(1)
  const finish = [card.shiny ? 'Shiny' : '', card.foil ? 'Foil' : ''].filter(Boolean).join(' ')
  c.drawText(left, y, clip(`${rarity}${finish ? ' ' + finish : ''}`, width, 5), rarityColor, 5)
  y += 9 * 5 + 18
  c.drawText(left, y, `${FAMILY_INFO[card.family].name} family`, family, 4)
  y += 9 * 4 + 24
  const stage = card.stage === 3 && (mythic || card.rarity === 'legendary') ? 'Final form' : `Stage ${card.stage}`
  c.drawText(left, y, `Level ${card.level}   ${stage}`, INK, 4)
  y += 9 * 4 + 16
  const st = card.stats
  c.drawText(left, y, clip(`HP ${st.hp} ATK ${st.atk} DEF ${st.def} SPD ${st.spd}`, width, 3), SOFT, 3)
  y += 9 * 3 + 12
  const traits = card.traits.map(t => TRAITS[t]?.name ?? t).join(', ')
  if (traits) c.drawText(left, y, clip(traits, width, 3), SOFT, 3)

  c.drawText(left, OG.h - 72 - 27, clip(host, width, 3), SOFT, 3)
  c.drawText(left, OG.h - 72, 'Find yours while Claude works', INK, 3)
  return encodePng(c)
}
