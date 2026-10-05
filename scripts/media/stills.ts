// PNG stills for launch, drawn with the server's own canvas and 5x7 pixel font (server/src/png.ts) and the game's
// own pixels: core sprites, and the band's and the ceremonies' frame effects (glow, sparkles, foil, card backs, the
// rustle's shadows).
// Product Hunt gallery 1270 x 760 (4), X 1200 x 675, GitHub social preview 1280 x 640. The palette is the site's
// og:image palette, so a shared link and a launch post look like one thing.
import type { Card, Family } from '../../plugin/hooks/core/types.ts'
import { cardName, fuse } from '../../plugin/hooks/core/cards.ts'
import { rngFromSeed } from '../../plugin/hooks/core/rng.ts'
import { FAMILIES, FAMILY_INFO } from '../../plugin/hooks/core/families.ts'
import { familySpecies } from '../../plugin/hooks/core/species.ts'
import { spriteFor } from '../../plugin/hooks/core/sprite.ts'
import type { Pixels } from '../../plugin/hooks/core/sprite.ts'
import { foil, glowOutline, sparkles } from '../../plugin/hooks/client/anim.ts'
import { FAMILY_COLOR, INK, RARITY_COLOR, hexInt } from '../../plugin/hooks/ui/tokens.ts'
import type { Canvas } from '../../server/src/png.ts'
import { createCanvas, encodePng, textWidth } from '../../server/src/png.ts'
import { albumForm, eyes, shadow } from './shadows.ts'
import { dayWith, mediaWorld } from './world.ts'

const BG = '#141a26', PANEL = '#1d2534', PLATE = '#1b1824', LINE = '#2c3547', TEXT = '#eceaf3', SOFT = '#a6a4b8', GOLD = INK.accent
const T = -1
const hex = (c: number) => '#' + (c & 0xffffff).toString(16).padStart(6, '0')

// ---------- drawing ----------

function sprite(c: Canvas, px: Pixels, x: number, y: number, s: number): void {
  c.drawPixels(Math.round(x), Math.round(y), px.map(r => r.map(v => (v === T ? null : hex(v)))), s)
}

/** A rectangle with stepped, pixel-art corners: `r` steps of `b` px. */
function rounded(c: Canvas, x: number, y: number, w: number, h: number, col: string, b: number, r: number): void {
  c.fillRect(x, y + r * b, w, h - 2 * r * b, col)
  for (let i = 0; i < r; i++) {
    const inset = (r - i) * b
    c.fillRect(x + inset, y + i * b, w - 2 * inset, b, col)
    c.fillRect(x + inset, y + h - (i + 1) * b, w - 2 * inset, b, col)
  }
}

/** A rounded panel with a border `b` px wide. */
function panel(c: Canvas, x: number, y: number, w: number, h: number, fill: string, stroke?: string, b = 3, r = 2): void {
  if (!stroke) return rounded(c, x, y, w, h, fill, b, r)
  rounded(c, x, y, w, h, stroke, b, r)
  rounded(c, x + b, y + b, w - 2 * b, h - 2 * b, fill, b, Math.max(1, r - 1))
}

function text(c: Canvas, x: number, y: number, s: string, color: string, scale: number): number {
  return c.drawText(Math.round(x), Math.round(y), s, color, scale)
}

/** Text wrapped to `max` px at `scale`, a line every `lead` px; returns the y below it. */
function para(c: Canvas, x: number, y: number, s: string, color: string, scale: number, max: number, lead = scale * 11): number {
  const words = s.split(' ')
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (textWidth(next, scale) > max && line) { text(c, x, y, line, color, scale); y += lead; line = w } else line = next
  }
  if (line) { text(c, x, y, line, color, scale); y += lead }
  return y
}

/** A slide's headline and the line under it. */
function heading(c: Canvas, W: number, title: string, sub: string): void {
  text(c, 72, 60, title, TEXT, 7)
  para(c, 74, 150, sub, SOFT, 3, W - 148)
}

const centre = (w: number, s: string, scale: number) => Math.round((w - textWidth(s, scale)) / 2)
const only = (px: Pixels, from: Pixels) => px.map((r, y) => r.map((v, x) => (from[y]![x] === T ? v : T)))

/** The wordmark, the way the site draws it: the pixel font, lowercase. */
function wordmark(c: Canvas, x: number, y: number, scale: number, color = TEXT): number {
  return text(c, x, y, 'spinlings', color, scale)
}

/** A creature on the band's dark plate, rimmed in a colour. */
function plate(c: Canvas, px: Pixels, x: number, y: number, s: number, stroke: string, pad = 2): { w: number; h: number } {
  const side = (16 + pad * 2) * s
  panel(c, x, y, side, side, PLATE, stroke, Math.max(2, Math.round(s / 2)), 3)
  sprite(c, px, x + pad * s, y + pad * s, s)
  return { w: side, h: side }
}

/** An HP bar: rounded track, fill in the game's HP colours. */
function hpBar(c: Canvas, x: number, y: number, w: number, h: number, frac: number): void {
  panel(c, x, y, w, h, '#3a3646', undefined, Math.max(1, Math.floor(h / 3)), 1)
  const fill = frac > 0.5 ? INK.good : frac > 0.2 ? INK.warn : INK.bad
  if (frac > 0) panel(c, x, y, Math.max(h, Math.round(w * frac)), h, fill, undefined, Math.max(1, Math.floor(h / 3)), 1)
}

function frame(w: number, h: number): Canvas {
  const c = createCanvas(w, h, BG)
  // a meadow line at the bottom, like the site's hills
  for (let x = 0; x < w; x += 4) {
    const hh = Math.round(10 + 6 * Math.sin(x / 70) + 4 * Math.sin(x / 23 + 1.3))
    c.fillRect(x, h - hh, 4, hh, '#18202e')
  }
  return c
}

// ---------- the world they show ----------

function cast() {
  const w = mediaWorld(dayWith('wildBloom'))
  const lead = w.starters[0]!
  const wild = w.mint('sonnet', 3, 'epic', {}, 4, 147926868)
  return { w, lead, wild }
}

// ---------- the images ----------

/** Product Hunt 1: the battle in the band, with the Perfect special landing. */
function battle(W: number, H: number): Canvas {
  const c = frame(W, H)
  const { lead, wild } = cast()
  heading(c, W, 'Battles above your prompt', 'While Claude works, wild creatures find you. Press 1 as your special fires for a Perfect hit.')
  // the band: two plates and the story between them
  const y = 330, s = 10, side = 20 * s
  const a = spriteFor(lead), d = spriteFor(wild)
  panel(c, 72, y - 40, W - 144, side + 80, PANEL, LINE, 3, 3)
  plate(c, a, 112, y, s, FAMILY_COLOR.opus)
  sprite(c, only(glowOutline(a, hexInt(GOLD), 1), a), 112 + 2 * s, y + 2 * s, s)
  sprite(c, only(sparkles(a, 0.2, 'still/p', { count: 5, color: 0xfff0a8, reach: 1 }), a), 112 + 2 * s, y + 2 * s, s)
  const dx = W - 112 - side
  plate(c, d, dx, y, s, RARITY_COLOR.epic)
  text(c, dx - 110, y + 64, '-42', INK.bad, 5)
  const mx = 112 + side + 48, mw = dx - 130 - mx - 24
  text(c, mx, y + 8, `${cardName(lead)} vs wild ${cardName(wild)}`, SOFT, 3)
  text(c, mx, y + 50, 'Perfect!', GOLD, 6)
  text(c, mx, y + 120, 'Crescendo, super effective', TEXT, 3)
  hpBar(c, mx, y + 168, mw, 12, 42 / 60)
  text(c, mx, y + 188, '42/60', SOFT, 2)
  panel(c, mx + mw + 24 - 4, y + 160, 34, 30, GOLD, undefined, 3, 2)
  text(c, mx + mw + 24 + 8, y + 167, '1', '#241c08', 3)
  text(c, mx + mw + 24 + 44, y + 167, 'Now!', TEXT, 3)
  wordmark(c, W - 72 - textWidth('spinlings', 4), H - 92, 4, SOFT)
  return c
}

/** Product Hunt 2: one species, every card its own. */
function unique(W: number, H: number): Canvas {
  const c = frame(W, H)
  const w = mediaWorld(dayWith('calm'), 'spinlings/media/unique')
  heading(c, W, 'No two cards alike', 'Every card rolls its own colours, eyes, genes and traits.')
  const s = 6, side = 20 * s, gap = 28
  const cols = 7
  const x0 = Math.round((W - (cols * side + (cols - 1) * gap)) / 2)
  const rarities = ['common', 'common', 'rare', 'common', 'epic', 'common', 'rare', 'common', 'common', 'rare', 'common', 'epic', 'common', 'common'] as const
  for (let i = 0; i < 14; i++) {
    const shiny = i === 5 || i === 12
    const stage = (1 + (i % 3)) as 1 | 2 | 3
    const card: Card = { ...w.mint('haiku', 4, rarities[i]!, { shiny }, 1, (i + 1) * 2654435761 >>> 0), stage }
    const x = x0 + (i % cols) * (side + gap), y = 246 + Math.floor(i / cols) * (side + 76)
    const color = shiny ? GOLD : RARITY_COLOR[card.rarity]
    let px = spriteFor(card)
    if (shiny) px = sparkles(px, 0.15, `u${i}`, { count: 3, color: 0xfff0a8, reach: 1 })
    plate(c, px, x, y, s, color)
    const label = shiny ? 'Shiny' : card.rarity[0]!.toUpperCase() + card.rarity.slice(1)
    text(c, x + centre(side, label, 2), y + side + 14, label, color, 2)
  }
  text(c, 72, H - 92, `One species, ${cardName({ ...w.mint('haiku', 4, 'common'), stage: 1 })}, through its three stages`, SOFT, 2)
  wordmark(c, W - 72 - textWidth('spinlings', 4), H - 92, 4, SOFT)
  return c
}

/** Product Hunt 3: a two-card pack, common and legendary foil. */
function pack(W: number, H: number): Canvas {
  const c = frame(W, H)
  const w = mediaWorld(dayWith('calm'), 'spinlings/media/pack')
  heading(c, W, 'Packs glow before they flip', 'Two cards in every pack. Rarer cards build up longer.')
  const s = 12, side = 18 * s, gap = 132
  const x0 = Math.round((W - (2 * side + gap)) / 2), y = 318
  const faces: Card[] = [
    w.mint('opus', 2, 'common', {}, 1, 2718281828),
    w.mint('opus', 8, 'legendary', { foil: true }, 1, 3141592653),
  ]
  faces.forEach((card, i) => {
    const x = x0 + i * (side + gap)
    const legendary = card.rarity === 'legendary'
    let px = spriteFor(card)
    if (legendary) px = sparkles(foil(px, 1.1), 0.3, 'pack', { count: 4, color: 0xfff0a8, reach: 1 })
    panel(c, x, y, side, side, PLATE, legendary ? GOLD : RARITY_COLOR[card.rarity], Math.round(s / 1.5), 3)
    sprite(c, px, x + s, y + s, s)
    const name = cardName(card)
    text(c, x + centre(side, name, 2), y + side + 18, name, legendary ? GOLD : RARITY_COLOR[card.rarity], 2)
    const label = legendary ? 'Legendary · Foil' : 'Common'
    text(c, x + centre(side, label, 2), y + side + 48, label, legendary ? GOLD : SOFT, 2)
  })
  // the legendary's rim runs the foil rainbow
  const lx = x0 + side + gap
  for (let k = 0; k < side; k += 6) {
    const col = hex(foilHue(k / side))
    c.fillRect(lx + k, y, 6, 6, col)
    c.fillRect(lx + k, y + side - 6, 6, 6, col)
    c.fillRect(lx, y + k, 6, 6, col)
    c.fillRect(lx + side - 6, y + k, 6, 6, col)
  }
  text(c, lx + centre(side, 'LEGENDARY!', 3), y - 44, 'LEGENDARY!', GOLD, 3)
  wordmark(c, W - 72 - textWidth('spinlings', 4), H - 92, 4, SOFT)
  return c
}

function foilHue(t: number): number {
  const h = (t * 360) % 360
  const f = (n: number) => { const k = (n + h / 30) % 12; return Math.round(255 * (0.62 - 0.8 * 0.38 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))) }
  return (f(0) << 16) | (f(8) << 8) | f(4)
}

/**
 * Product Hunt 4: the season, held back. All 36 species as the shadows they stay until you meet them (the band's
 * rustle, shadows.ts), a row per family, the legendaries rimmed in gold; one has opened its eyes.
 */
function season(W: number, H: number): Canvas {
  const c = frame(W, H)
  heading(c, W, 'A new season every 28 days', '36 species in each. Every one is a shadow until you find it.')
  // the legendary stands a little apart from its eight
  const s = 4, side = 20 * s, gap = 22, apart = 18, pitch = side + 16
  const label = Math.max(...FAMILIES.map(f => textWidth(FAMILY_INFO[f].name, 2)))
  const x0 = Math.round((W - (label + 24 + 9 * side + 8 * gap + apart)) / 2) + label + 24, y0 = 262
  FAMILIES.forEach((f, row) => {
    const y = y0 + row * pitch
    familySpecies(1, f).forEach((sp, i) => {
      const px = albumForm(sp), x = x0 + i * (side + gap) + (sp.legendary ? apart : 0)
      plate(c, shadow(px, !!sp.legendary, true), x, y, s, sp.legendary ? GOLD : FAMILY_COLOR[f])
      if (f === 'sonnet' && i === 2) sprite(c, eyes(px, hexInt(INK.bright)), x + 2 * s, y + 2 * s, s)
    })
    const name = FAMILY_INFO[f].name
    text(c, x0 - 24 - textWidth(name, 2), y + side / 2 - 7, name, FAMILY_COLOR[f], 2)
  })
  text(c, x0 + 8 * (side + gap) + apart + centre(side, 'Legendary', 2), y0 - 30, 'Legendary', GOLD, 2)
  wordmark(c, W - 72 - textWidth('spinlings', 4), H - 92, 4, SOFT)
  return c
}

/** X (1200 x 675): the wordmark, the line, and one creature growing. */
function x(W: number, H: number): Canvas {
  const c = frame(W, H)
  const { lead } = cast()
  wordmark(c, 72, 72, 12)
  text(c, 76, 200, 'Tiny pixel creatures that battle above your', TEXT, 4)
  text(c, 76, 244, 'prompt while Claude works.', TEXT, 4)
  const s = 9
  ;([1, 2, 3] as const).forEach((stage, i) => {
    const px = spriteFor({ ...lead, stage })
    const xx = 96 + i * 250
    plate(c, px, xx, 330, s, FAMILY_COLOR.opus)
    const name = cardName({ ...lead, stage })
    text(c, xx + centre(20 * s, name, 3), 330 + 20 * s + 18, name, TEXT, 3)
    if (i < 2) text(c, xx + 20 * s + 20, 330 + 10 * s - 12, '>', SOFT, 4)
  })
  text(c, 76, H - 89, '/plugin marketplace add 416rehman/spinlings', GOLD, 3)
  text(c, 76, H - 53, '/plugin install spinlings@spinlings', GOLD, 3)
  return c
}

/** X (1200 x 675): two real generated cards and the hybrid returned by the game's fusion rules. */
function fusion(W: number, H: number): Canvas {
  const c = frame(W, H)
  const w = mediaWorld(dayWith('wildBloom'), 'spinlings/media/fusion')
  const a = w.mint('haiku', 5, 'rare', {}, 5, 59139635)
  const b = w.mint('opus', 0, 'rare', {}, 5, 3985328812)
  const hybrid = w.id(fuse(a, b, rngFromSeed('spinlings/media/fusion/result'), w.now))
  heading(c, W, 'Fuse a new creature', 'Fuse two cards. A hybrid inherits their look, genes and traits.')
  const s = 10, side = 20 * s, y = 296
  ;([a, b, hybrid] as const).forEach((card, i) => {
    const x = [96, 400, 848][i]!
    const label = i === 2 ? 'Hybrid' : 'Parent'
    text(c, x + centre(side, label, 2), y - 30, label, i === 2 ? GOLD : SOFT, 2)
    plate(c, spriteFor(card), x, y, s, FAMILY_COLOR[card.family])
    const name = cardName(card)
    const scale = textWidth(name, 3) <= side + 40 ? 3 : 2
    text(c, x + centre(side, name, scale), y + side + 20, name, TEXT, scale)
  })
  text(c, 330, y + side / 2 - 18, '+', SOFT, 5)
  text(c, 736, y + side / 2 - 18, '>', SOFT, 5)
  text(c, 72, H - 110, 'Fusion consumes both parent cards.', SOFT, 2)
  wordmark(c, 72, H - 70, 4, SOFT)
  return c
}

/** GitHub social preview (1280 x 640): wordmark, line, a family of creatures. */
function social(W: number, H: number): Canvas {
  const c = frame(W, H)
  wordmark(c, 80, 96, 13)
  text(c, 86, 236, 'A creature card game that lives inside Claude Code.', TEXT, 3)
  text(c, 86, 272, 'Open source.', SOFT, 3)
  const picks: [Family, number][] = [['haiku', 0], ['sonnet', 1], ['opus', 0], ['fable', 3], ['haiku', 8]]
  picks.forEach(([f, i], k) => {
    const sp = familySpecies(1, f)[i]!
    const px = spriteFor({ form: sp, stage: sp.legendary ? 3 : 2 })
    plate(c, px, 86 + k * 226, 362, 9, sp.legendary ? GOLD : FAMILY_COLOR[f])
  })
  return c
}

export async function stills(): Promise<[string, Uint8Array][]> {
  const list: [string, Canvas][] = [
    ['ph-1-battle.png', battle(1270, 760)],
    ['ph-2-unique.png', unique(1270, 760)],
    ['ph-3-pack.png', pack(1270, 760)],
    ['ph-4-season.png', season(1270, 760)],
    ['x-card.png', x(1200, 675)],
    ['x-fusion.png', fusion(1200, 675)],
    ['github-social.png', social(1280, 640)],
  ]
  return Promise.all(list.map(async ([name, c]) => [name, await encodePng(c)] as [string, Uint8Array]))
}
