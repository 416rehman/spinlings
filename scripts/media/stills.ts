// PNG stills for launch, drawn with the server's own canvas and 5x7 pixel font (server/src/png.ts) and the game's
// own pixels: core sprites, and the band's and the ceremonies' frame effects (glow, sparkles, foil, card backs).
// Product Hunt gallery 1270 x 760 (4), X 1200 x 675, GitHub social preview 1280 x 640. The palette is the site's
// og:image palette, so a shared link and a launch post look like one thing.
import type { Card, Family } from '../../plugin/hooks/core/types.ts'
import { cardName } from '../../plugin/hooks/core/cards.ts'
import { FAMILIES, FAMILY_INFO } from '../../plugin/hooks/core/families.ts'
import { familySpecies } from '../../plugin/hooks/core/species.ts'
import { spriteFor } from '../../plugin/hooks/core/sprite.ts'
import type { Pixels } from '../../plugin/hooks/core/sprite.ts'
import { foil, glowOutline, sparkles } from '../../plugin/hooks/client/anim.ts'
import { FAMILY_COLOR, INK, RARITY_COLOR, hexInt } from '../../plugin/hooks/ui/tokens.ts'
import type { Canvas } from '../../server/src/png.ts'
import { createCanvas, encodePng, textWidth } from '../../server/src/png.ts'
import { dayWith, mediaWorld } from './world.ts'

const { eggPixels } = await import('../../plugin/hooks/ui/ceremony-art.tsx')
const { cardBack } = await import('../../plugin/hooks/client/anim.ts')

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

/** Product Hunt 3: a pack, one back glowing gold before it flips. */
function pack(W: number, H: number): Canvas {
  const c = frame(W, H)
  const w = mediaWorld(dayWith('calm'), 'spinlings/media/pack')
  heading(c, W, 'Packs glow before they flip', 'Packs charge with time, never with usage. Rarer cards build up longer.')
  const s = 10, side = 18 * s, gap = 44
  const x0 = Math.round((W - (5 * side + 4 * gap)) / 2), y = 350
  const faces: (Card | null)[] = [
    w.mint('opus', 2, 'common', {}, 1, 2718281828), w.mint('opus', 1, 'rare', {}, 1, 1732050807), null,
    w.mint('opus', 8, 'legendary', { shiny: true }, 1, 3141592653), null,
  ]
  const glow = [null, null, hexInt(RARITY_COLOR.epic), null, hexInt(RARITY_COLOR.legendary)]
  faces.forEach((card, i) => {
    const x = x0 + i * (side + gap)
    if (!card) {
      const back = cardBack(16, 16, i === 4 ? 'legendary' : i === 2 ? 'epic' : 'common', 1)
      const halo = only(glowOutline(back, glow[i]!, 1), back)
      sprite(c, halo, x + s, y + s, s)
      sprite(c, back, x + s, y + s, s)
      const label = i === 4 ? 'glowing gold...' : 'glowing'
      text(c, x + centre(side, label, 2), y + side + 18, label, i === 4 ? GOLD : RARITY_COLOR.epic, 2)
      return
    }
    const legendary = card.rarity === 'legendary'
    let px = spriteFor(card)
    if (legendary) px = sparkles(foil(px, 1.1), 0.3, 'pack', { count: 4, color: 0xfff0a8, reach: 1 })
    panel(c, x, y, side, side, PLATE, legendary ? GOLD : RARITY_COLOR[card.rarity], Math.round(s / 1.5), 3)
    sprite(c, px, x + s, y + s, s)
    const name = cardName(card)
    text(c, x + centre(side, name, 2), y + side + 18, name, legendary ? GOLD : RARITY_COLOR[card.rarity], 2)
  })
  // the legendary's rim runs the foil rainbow
  const lx = x0 + 3 * (side + gap)
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

/** Product Hunt 4: the season, and what the game never reads. */
function season(W: number, H: number): Canvas {
  const c = frame(W, H)
  heading(c, W, '36 new species every 28 days', 'It plays off the rhythm of your session. No sign-up, no telemetry, zero tokens.')
  const s = 4, cell = 16 * s + 34, rowH = 16 * s + 36
  const x0 = Math.round((W - 9 * cell + 34) / 2)
  FAMILIES.forEach((f, row) => {
    familySpecies(1, f).forEach((sp, i) => {
      const x = x0 + i * cell, y = 262 + row * rowH
      sprite(c, spriteFor({ form: sp, stage: sp.legendary ? 3 : 1 }), x, y, s)
    })
    text(c, x0 - 16 - textWidth(FAMILY_INFO[f].name, 2), 262 + row * rowH + 26, FAMILY_INFO[f].name, FAMILY_COLOR[f], 2)
  })
  text(c, x0 + 8 * cell + centre(16 * s, 'Legendary', 2), 236, 'Legendary', GOLD, 2)
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
  text(c, 76, H - 76, '/plugin install spinlings --marketplace 416rehman/spinlings', GOLD, 2)
  return c
}

/** X, the drop post (1200 x 675): the Founder's Egg, its code, and what makes it worth showing off. */
function founders(W: number, H: number): Canvas {
  const c = frame(W, H)
  const egg = eggPixels(hexInt(FAMILY_COLOR.fable), 2, 0)
  const s = 18, ex = W - 96 - 16 * s, ey = 150
  sprite(c, only(glowOutline(egg, hexInt(RARITY_COLOR.epic), 1), egg), ex, ey, s)
  sprite(c, egg, ex, ey, s)
  sprite(c, only(sparkles(egg, 0.3, 'founders', { count: 5, color: 0xfff0a8, reach: 2 }), egg), ex, ey, s)
  text(c, 72, 92, "The Founder's Egg", TEXT, 6)
  text(c, 72, 170, 'Everyone who redeems it gets the', SOFT, 3)
  text(c, 72, 204, 'same creature. Yours hatches with', SOFT, 3)
  text(c, 72, 238, 'its own colours and genes.', SOFT, 3)
  text(c, 72, 300, 'Launch week only:', TEXT, 3)
  panel(c, 72, 342, 452, 92, PANEL, GOLD, 4, 3)
  text(c, 72 + centre(452, 'FOUNDERS', 7), 358, 'FOUNDERS', GOLD, 7)
  text(c, 72, 474, '/spin redeem FOUNDERS', TEXT, 3)
  wordmark(c, 72, H - 92, 4, SOFT)
  return c
}

/** GitHub social preview (1280 x 640): wordmark, line, a family of creatures. */
function social(W: number, H: number): Canvas {
  const c = frame(W, H)
  wordmark(c, 80, 96, 13)
  text(c, 86, 236, 'A creature card game that lives inside Claude Code.', TEXT, 3)
  text(c, 86, 272, 'No sign-up, zero tokens. Open source.', SOFT, 3)
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
    ['x-founders.png', founders(1200, 675)],
    ['github-social.png', social(1280, 640)],
  ]
  return Promise.all(list.map(async ([name, c]) => [name, await encodePng(c)] as [string, Uint8Array]))
}
