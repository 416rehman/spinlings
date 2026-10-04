// The ceremonies' pixels (SPEC 13.5, 13.9, 13.10, 14): the pack and its 3-frame tear, the wrapped present, the egg and
// its hatch, glowing card backs, and the frames of each beat, all drawn with client/anim.ts's helpers (the one card
// back, squash, flash, sparkles, foil). The terminal plays them as Raster frames the ceremony driver blits; the
// desktop plays the same beats as one SMIL Svg per state. Both read TIMING, so a beat lasts as long on either. Pure.
import type { Card, Family } from '../core/types.ts'
import type { Pixels } from '../core/sprite.ts'
import { miniSprite, spriteFor } from '../core/sprite.ts'
import { getSpecies } from '../core/species.ts'
import { FOIL_PERIOD, T, TIMING, cardBack, foil, mix, offset, pulse, sparkles, squash, tint } from '../client/anim.ts'
import { artCells, artPixels, frameOf, isMythic } from './card.tsx'
import type { CardFace, Frame } from './card.tsx'
import { FAMILY_COLOR, INK, MYTHIC_COLOR, RAINBOW_STOPS, RARITY_COLOR, hex6, hexInt, pixelRects } from './tokens.ts'

const N = 16
const WHITE = 0xfffdf5
const GLOW_INSIDE = 0xfff4c2

/** The colour a face-down card glows in (SPEC 13.5): none for common, blue rare, purple epic, gold legendary. */
export function glowOf(c: Pick<Card, 'rarity' | 'species'>): number | null {
  if (isMythic(c)) return hexInt(MYTHIC_COLOR)
  return c.rarity === 'common' ? null : hexInt(RARITY_COLOR[c.rarity])
}

/** A card's back as the pane draws it: anim.ts's one back, lit by `glow` (0..1), its gold beating with `t` (seconds). */
export function backOf(c: CardFace, size: 16 | 8, glow: number, t = 0): Pixels {
  return cardBack(size, size, c.rarity, t * 1.2, { mythic: isMythic(c), glow })
}

const paint = (w: number, h: number, f: (x: number, y: number) => number): Pixels =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => f(x, y)))

// ---------- the pieces ----------

/** The pack: a pixel package in its family colour; `tear` 1..3 are the three frames of tearing it open. */
export function packagePixels(family: Family, tear: 0 | 1 | 2 | 3): Pixels {
  const c = hexInt(FAMILY_COLOR[family])
  const dark = mix(c, 0x000000, 0.38), light = mix(c, 0xffffff, 0.35), seal = mix(c, 0x000000, 0.55)
  // the seal tears left to right; the peeled strip curls up at the tear point, still attached
  const edge = 2 + [0, 3, 7, 14][tear]!
  const flap = mix(seal, 0xffffff, 0.3)
  return paint(N, N, (x, y) => {
    const inBody = x >= 2 && x <= 13 && y >= 3 && y <= 15
    if (y === 0) {
      if ((tear === 1 || tear === 2) && (x === edge || x === edge - 1)) return flap
      if (tear === 3 && (x === 6 || x === 9)) return GLOW_INSIDE
      return T
    }
    if (y === 1 || y === 2) {
      if (x < 2 || x > 13) return T
      if (x < edge) return y === 2 ? (tear === 3 && x >= 4 && x <= 11 ? GLOW_INSIDE : light) : T
      return y === 1 ? (x % 2 === 0 || x === edge ? seal : T) : seal
    }
    if (!inBody) return T
    if (tear === 3 && y === 3) return x >= 3 && x <= 12 ? GLOW_INSIDE : dark
    if (y >= 7 && y <= 9 && x >= 3 && x <= 12) {
      const dx = Math.abs(x - 7.5), dy = Math.abs(y - 8)
      return dx + dy < 1.6 ? WHITE : light
    }
    if (x === 2) return light
    if (x === 13 || y === 15) return dark
    if (x === 3 && (y === 4 || y === 5)) return mix(light, 0xffffff, 0.4)
    return c
  })
}

const BOX = { red: 0xc9504a, lid: 0xd9605a, light: 0xe58a80, dark: 0x9a3a36, gold: 0xf2b33d, goldDark: 0xc48a1f } as const

/** The wrapped present (SPEC 13.9): 0 wrapped, 1 ribbon off, 2 lid lifted. */
export function presentPixels(phase: 0 | 1 | 2): Pixels {
  const lidTop = phase === 2 ? 2 : 5
  return paint(N, N, (x, y) => {
    const ribbon = phase === 0
    if (ribbon && y >= 2 && y <= 4) {
      const bow = (y === 2 && (x === 4 || x === 5 || x === 10 || x === 11)) || (y === 3 && (x === 3 || x === 6 || x === 9 || x === 12))
        || (y === 4 && x >= 4 && x <= 11)
      if (bow) return y === 4 ? BOX.goldDark : BOX.gold
      if (y === 3 && (x === 7 || x === 8)) return BOX.goldDark
    }
    if (y >= lidTop && y <= lidTop + 2 && x >= 1 && x <= 14) {
      if (ribbon && (x === 7 || x === 8)) return BOX.gold
      return y === lidTop + 2 ? BOX.dark : x === 1 ? BOX.light : BOX.lid
    }
    if (phase === 2 && y === 8 && x >= 3 && x <= 12) return GLOW_INSIDE
    if (y >= 8 && y <= 15 && x >= 2 && x <= 13) {
      if (ribbon && (x === 7 || x === 8 || y === 11)) return x === 7 || y === 11 ? BOX.gold : BOX.goldDark
      return x === 2 ? BOX.light : x === 13 || y === 15 ? BOX.dark : BOX.red
    }
    return T
  })
}

const SHELL = { base: 0xf1e8d4, shade: 0xd8ccb2, edge: 0x9d9078, crack: 0x5b5042 } as const

/** The egg (SPEC 13.10, 25): a speckled shell; `crack` 1..2 splits it; `tilt` leans it for the wobble. */
export function eggPixels(speck: number, crack: 0 | 1 | 2, tilt: -1 | 0 | 1): Pixels {
  const inside = (x: number, y: number) => {
    const rx = y < 8.5 ? 4.6 : 5.4
    return ((x - 7.5) / rx) ** 2 + ((y - 8.5) / 7) ** 2 <= 1
  }
  const base = paint(N, N, (x, y) => {
    if (!inside(x, y)) return T
    const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)
    if (edge) return SHELL.edge
    if ([[5, 4], [9, 6], [6, 9], [10, 11], [4, 12], [8, 13], [11, 8]].some(([sx, sy]) => sx === x && sy === y)) return speck
    return x > 9 ? SHELL.shade : SHELL.base
  })
  if (crack > 0) {
    const from = crack === 1 ? 5 : 3, to = crack === 1 ? 9 : 12
    for (let x = from; x <= to; x++) {
      const y = x % 2 === 0 ? 8 : 9
      if (base[y]![x] !== T) base[y]![x] = SHELL.crack
      if (crack === 2 && (x === 6 || x === 9) && base[y - 1]![x] !== T) base[y - 1]![x] = GLOW_INSIDE
    }
  }
  return tilt === 0 ? base : base.map((r, y) => r.map((_, x) => r[x - (y < 6 ? tilt * 2 : y < 11 ? tilt : 0)] ?? T))
}

/** The speck colour of a family's egg (a neutral one before the family is known). */
export const eggSpeck = (family: Family | null) => (family ? hexInt(FAMILY_COLOR[family]) : 0xc9b48a)

/** Two parents sliding together and interleaving into one shape (`p` 0..1): the start of a fusion hatch. */
export function mergePixels(a: Pixels, b: Pixels, p: number): Pixels {
  const ax = Math.round(4 * p), bx = Math.round(8 - 4 * p)
  return paint(N, N, (x, y) => {
    const ca = y >= 4 && y < 12 ? a[y - 4]?.[x - ax] ?? T : T
    const cb = y >= 4 && y < 12 ? b[y - 4]?.[x - bx] ?? T : T
    if (ca !== T && cb !== T) return x % 2 === 0 ? ca : cb
    return ca !== T ? ca : cb
  })
}

/** The parents of a fusion as minis, when this mod can draw them; else the hybrid's own mini twice. */
export function parentMinis(c: CardFace): [Pixels, Pixels] {
  const own = artPixels(c, true)
  const ps = c.form?.kind === 'fusion' ? c.form.parents : undefined
  const one = (id: string | undefined, at: number): Pixels => {
    const s = c.parentForms?.[at] ?? (id ? getSpecies(id) : undefined)
    if (!s) return own
    try {
      return miniSprite(spriteFor({ form: s, stage: 1 }))
    } catch {
      return own
    }
  }
  return [one(ps?.[0], 0), one(ps?.[1], 1)]
}

// ---------- terminal frames ----------

export type Cells = { columns: number; rows: number; cells: string }

const plain = (color: number): Frame => ({ color, rainbow: false, sparkle: false })

/** The stage (18 x 10 cells): a 16x16 picture in a one-cell frame, the same frame the card's own art has. */
export function stageCells(px: Pixels, frame: Frame, t = 0): Cells {
  return artCells(px, frame, t)
}

/** A slot in the strip (8 x 4 cells, unframed): a glowing back (its gold beating `glowT` seconds in), or the mini face. */
export function slotCells(c: CardFace, up: boolean, glowT = 0): Cells {
  if (up) return artCells(artPixels(c, true), null)
  return artCells(backOf(c, 8, glowOf(c) === null ? 0 : 0.8, glowT), null)
}

export function backFrame(c: CardFace, t: number): Frame {
  const g = glowOf(c)
  if (g === null) return plain(hexInt(INK.muted))
  return plain(c.rarity === 'legendary' || isMythic(c) ? mix(g, WHITE, pulse(t) * 0.6) : g)
}

/** The back of a card as the stage shows it while it builds up (t seconds into the build-up): the glow swells in. */
export function backStage(c: CardFace, t: number): Cells {
  const glow = c.rarity === 'legendary' || isMythic(c) ? 1 : Math.min(1, 0.4 + t)
  return stageCells(backOf(c, 16, glow, t), backFrame(c, t))
}

/** One frame of the flip (`t` 0..1): the back squashes away, a white flash, the face grows in. */
export function flipStage(c: CardFace, t: number): Cells {
  const face = artPixels(c)
  if (t < 0.45) return stageCells(squash(backOf(c, 16, 1), 1 - t / 0.45), backFrame(c, 0))
  if (t < 0.55) return stageCells(tint(squash(face, 0.25), WHITE, 1), frameOf(c))
  return stageCells(tint(squash(face, Math.min(1, (t - 0.55) / 0.35)), WHITE, Math.max(0, 1 - (t - 0.55) / 0.2)), frameOf(c))
}

/** The revealed face, celebrating in proportion (`t` seconds after the flip): foil's one sweep, sparkles, gold. */
export function faceStage(c: CardFace, t: number): Cells {
  let px = artPixels(c)
  if (c.foil && t < 1.2) px = foil(px, (t / 1.2) * FOIL_PERIOD)
  if (c.rarity !== 'common' || c.shiny) px = sparkles(px, t, c.id, { count: c.rarity === 'legendary' ? 6 : c.shiny ? 5 : 3, color: WHITE })
  const f = frameOf(c)
  const gold = c.rarity === 'legendary' && !isMythic(c)
  return stageCells(px, gold ? { ...f, color: mix(hexInt(RARITY_COLOR.legendary), WHITE, pulse(t, 1.5) * 0.7) } : f, t)
}

export function packStage(family: Family, tear: 0 | 1 | 2 | 3): Cells {
  return stageCells(packagePixels(family, tear), plain(hexInt(FAMILY_COLOR[family])))
}

export function presentStage(phase: 0 | 1 | 2, dx = 0): Cells {
  return stageCells(offset(presentPixels(phase), dx, 0), plain(BOX.gold))
}

export function eggStage(c: CardFace, crack: 0 | 1 | 2, tilt: -1 | 0 | 1): Cells {
  return stageCells(eggPixels(eggSpeck(c.family), crack, tilt), plain(hexInt(INK.muted)))
}

export function mergeStage(c: CardFace, p: number): Cells {
  if (p < 0.7) return stageCells(mergePixels(...parentMinis(c), p / 0.7), plain(hexInt(INK.muted)))
  return stageCells(tint(eggPixels(eggSpeck(c.family), 0, 0), WHITE, 1 - (p - 0.7) / 0.3), plain(hexInt(INK.muted)))
}

/** A bounty spinning out of the opponent's corner (`t` 0..1): two spins, then the face. */
export function spinStage(c: CardFace, t: number): Cells {
  const turns = Math.abs(Math.cos(t * Math.PI * 2))
  return stageCells(squash(backOf(c, 16, 1), Math.max(0.06, turns)), backFrame(c, t))
}

// ---------- desktop: one SMIL Svg per state ----------

const sec = (ms: number) => `${(ms / 1000).toFixed(2)}s`
/** Pixels inside the stage's one-pixel frame. */
const rects = (px: Pixels, fill?: string) => pixelRects(px, 1, 1, 1, fill)

/** Visible from `from` ms, until `to` (or for good). */
function during(from: number, to: number | null, body: string): string {
  if (from <= 0 && to === null) return `<g>${body}</g>`
  return `<g visibility="${from <= 0 ? 'visible' : 'hidden'}">${from > 0 ? `<set attributeName="visibility" to="visible" begin="${sec(from)}" fill="freeze"/>` : ''}`
    + `${to !== null ? `<set attributeName="visibility" to="hidden" begin="${sec(to)}" fill="freeze"/>` : ''}${body}</g>`
}

/** Scales a group horizontally about the stage's centre from `a` to `b` over [begin, begin + dur]. */
function scaleX(body: string, a: number, b: number, begin: number, dur: number): string {
  const base = a === 1 ? '' : ` transform="scale(${a} 1)"`
  return `<g transform="translate(9 9)"><g${base}><animateTransform attributeName="transform" type="scale" values="${a} 1;${b} 1" begin="${sec(begin)}" dur="${sec(dur)}" fill="freeze"/>`
    + `<g transform="translate(-9 -9)">${body}</g></g></g>`
}

function flashAt(px: Pixels, begin: number, dur: number): string {
  return `<g opacity="0"><animate attributeName="opacity" values="0;1;0" begin="${sec(begin)}" dur="${sec(dur)}" fill="freeze"/>${rects(px, hex6(WHITE))}</g>`
}

/** The stage's border: pulsing while a back glows, beating gold from `gold` ms for a legendary. */
function ring(stroke: string, o: { motion: boolean; pulse?: boolean; gold?: number | null }): string {
  const anims = !o.motion ? '' : (o.pulse ? '<animate attributeName="stroke-opacity" values="0.35;1;0.35" dur="0.9s" repeatCount="indefinite"/>' : '')
    + (o.gold !== null && o.gold !== undefined ? `<animate attributeName="stroke" values="${RARITY_COLOR.legendary};#fff4c2;${RARITY_COLOR.legendary}" begin="${sec(o.gold)}" dur="0.7s" repeatCount="4"/>` : '')
  return `<rect x="0.5" y="0.5" width="17" height="17" rx="1.5" fill="none" stroke="${stroke}" stroke-width="1">${anims}</rect>`
}

function twinkles(begin: number, count: number): string {
  const spots = [[2, 2], [16, 2], [2, 16], [16, 16], [9, 1], [1, 9]].slice(0, count)
  return spots.map(([x, y], k) => `<path d="M${x} ${y! - 1.2}L${x! + 0.35} ${y! - 0.35}L${x! + 1.2} ${y}L${x! + 0.35} ${y! + 0.35}L${x} ${y! + 1.2}L${x! - 0.35} ${y! + 0.35}L${x! - 1.2} ${y}L${x! - 0.35} ${y! - 0.35}Z" fill="#fff4c2" opacity="0">`
    + `<animate attributeName="opacity" values="0;1;0" begin="${sec(begin + k * 140)}" dur="0.8s" repeatCount="3"/></path>`).join('')
}

function doc(body: string, scale: number, rainbow: boolean, defs = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="${18 * scale}" height="${18 * scale}" shape-rendering="crispEdges">`
    + (rainbow || defs ? `<defs>${rainbow ? `<linearGradient id="rb" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="18" y2="18">${RAINBOW_STOPS}</linearGradient>` : ''}${defs}</defs>` : '')
    + body + '</svg>'
}

const frameColor = (c: CardFace) => isMythic(c) ? MYTHIC_COLOR : RARITY_COLOR[c.rarity]
const glowColor = (c: CardFace) => { const g = glowOf(c); return g === null ? INK.muted : hex6(g) }
const isRainbow = (c: CardFace) => !!c.foil || isMythic(c)
const sparkly = (c: CardFace) => c.rarity !== 'common' || c.shiny
/** A face's border: the rainbow for foil and Mythics, else its rarity, beating gold from `at` for a legendary. */
const faceRing = (c: CardFace, motion: boolean, at: number | null) =>
  ring(isRainbow(c) ? 'url(#rb)' : frameColor(c), { motion, gold: c.rarity === 'legendary' && !isMythic(c) ? at : null })

/** Foil's own beat (SPEC 14): one holo sweep across the face from `at`, masked to the creature. */
function sheen(px: Pixels, at: number): { defs: string; body: string } {
  return {
    defs: '<linearGradient id="sh" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="18" y2="18" gradientTransform="translate(-18 0)">'
      + '<stop offset="0.35" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.5" stop-color="#ff9df0"/><stop offset="0.55" stop-color="#9df6ff"/>'
      + '<stop offset="0.7" stop-color="#ffffff" stop-opacity="0"/>'
      + `<animateTransform attributeName="gradientTransform" type="translate" from="-18 0" to="18 0" begin="${sec(at)}" dur="1.2s" fill="freeze"/></linearGradient>`
      + `<mask id="sm"><g fill="#fff">${rects(px, '#ffffff')}</g></mask>`,
    body: '<rect x="1" y="1" width="16" height="16" fill="url(#sh)" mask="url(#sm)" opacity="0.45" style="mix-blend-mode:color-dodge"/>',
  }
}

/** A card face up on the stage, still: what any state shows with motion off. */
export function svgFace(c: CardFace, scale: number): string {
  return doc(rects(artPixels(c)) + faceRing(c, false, null), scale, isRainbow(c))
}

/**
 * One state of a pack (or any several-card reveal) on the desktop: the beats the driver keeps on the terminal. The
 * card just turned (`prev`) holds its face and celebrates for `hold` ms; then the next card's back glows through its
 * build-up, goes still for the pause, and flips: it squashes away, one bright frame, the face grows in.
 */
export function svgTurn(next: CardFace, scale: number, motion: boolean, prev: { card: CardFace; hold: number } | null = null): string {
  const rainbow = isRainbow(next) || (!!prev && isRainbow(prev.card))
  if (!motion) return prev ? svgFace(prev.card, scale) : doc(rects(backOf(next, 16, 0.8)) + ring(glowColor(next), { motion }), scale, false)
  const hold = prev ? prev.hold : 0
  const build = TIMING.buildup[next.rarity]
  const flipAt = hold + build + TIMING.pause
  const f = TIMING.flip[next.rarity], half = f * 0.45, end = flipAt + f
  let body = ''
  let defs = ''
  if (prev) {
    const px = artPixels(prev.card)
    let face = rects(px) + (sparkly(prev.card) ? twinkles(0, prev.card.rarity === 'legendary' ? 6 : 4) : '')
    if (prev.card.foil) {
      const s = sheen(px, 0)
      defs += s.defs
      face += s.body
    }
    body += during(0, hold, face + faceRing(prev.card, true, 0))
  }
  const glowing = glowOf(next) !== null
  body += during(hold, flipAt + half, scaleX(rects(backOf(next, 16, 1)), 1, 0.01, flipAt, half))
    + during(hold, hold + build, ring(glowColor(next), { motion, pulse: glowing }))
    + during(hold + build, end, ring(glowColor(next), { motion }))
  const face = artPixels(next)
  body += during(flipAt + half, null, scaleX(rects(face), 0.01, 1, flipAt + half, f - half)) + flashAt(face, flipAt + half, TIMING.cardFlash * 2)
    + (sparkly(next) ? twinkles(end, next.rarity === 'legendary' ? 6 : 4) : '')
    + during(end, null, faceRing(next, true, end))
  return doc(body, scale, rainbow, defs)
}

/** A face-down card in the strip, glowing in its rarity colour; epic and up pulse while motion is on. */
export function svgSlotBack(c: CardFace, scale: number, motion: boolean): string {
  const px = backOf(c, 8, glowOf(c) === null ? 0 : 0.8)
  const pulseIt = motion && (c.rarity === 'legendary' || isMythic(c) || c.rarity === 'epic')
  const anim = pulseIt ? '<animate attributeName="opacity" values="0.55;1;0.55" dur="0.9s" repeatCount="indefinite"/>' : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="${8 * scale}" height="${8 * scale}" shape-rendering="crispEdges">`
    + `<g>${anim}${pixelRects(px)}</g></svg>`
}

/** The pack on the desktop: it waits a beat, then tears open in three frames. */
export function svgPackage(family: Family, scale: number, motion: boolean): string {
  const color = FAMILY_COLOR[family]
  if (!motion) return doc(rects(packagePixels(family, 0)) + ring(color, { motion }), scale, false)
  const a = TIMING.tearDelay, step = TIMING.tear / 3
  const body = during(0, a, rects(packagePixels(family, 0))) + during(a, a + step, rects(packagePixels(family, 1)))
    + during(a + step, a + 2 * step, rects(packagePixels(family, 2))) + during(a + 2 * step, null, rects(packagePixels(family, 3)))
  return doc(body + ring(color, { motion }), scale, false)
}

/** The whole single-card moment on the desktop, ending on the face: the egg, the present, a bounty or a craft. */
export function svgSingle(kind: 'egg' | 'present' | 'bounty' | 'craft', c: CardFace, scale: number, motion: boolean, fusion: boolean): string {
  if (!motion) return svgFace(c, scale)
  const face = artPixels(c)
  let body = ''
  let at = 0
  if (kind === 'egg') {
    const speck = eggSpeck(c.family)
    if (fusion) {
      for (let k = 0; k < 4; k++) body += during(at + (k * TIMING.merge) / 4, at + ((k + 1) * TIMING.merge) / 4, rects(mergePixels(...parentMinis(c), k / 3)))
      at += TIMING.merge
    }
    const egg = rects(eggPixels(speck, 0, 0))
    const rot = (from: number) => `<animateTransform attributeName="transform" type="rotate" values="0 9 15;-9 9 15;9 9 15;0 9 15" begin="${sec(from)}" dur="${sec(TIMING.wobble)}"/>`
    body += during(at, at + 3 * TIMING.wobble, `<g>${rot(at)}${rot(at + TIMING.wobble)}${rot(at + 2 * TIMING.wobble)}${egg}</g>`)
    at += 3 * TIMING.wobble
    body += during(at, at + TIMING.crack, rects(eggPixels(speck, 1, 0))) + during(at + TIMING.crack, at + 2 * TIMING.crack, rects(eggPixels(speck, 2, 0)))
    at += 2 * TIMING.crack
  } else if (kind === 'present') {
    const shake = `<animateTransform attributeName="transform" type="translate" values="0 0;1 0;-1 0;1 0;0 0" begin="0s" dur="${sec(TIMING.presentShake)}" repeatCount="2"/>`
    body += during(0, 2 * TIMING.presentShake, `<g>${shake}${rects(presentPixels(0))}</g>`)
    at = 2 * TIMING.presentShake
    body += during(at, at + TIMING.unwrap, rects(presentPixels(1))) + during(at + TIMING.unwrap, at + 2 * TIMING.unwrap, rects(presentPixels(2)))
    at += 2 * TIMING.unwrap
  } else if (kind === 'bounty') {
    const back = rects(backOf(c, 16, 1))
    body += during(0, TIMING.spin, `<g transform="translate(9 9)"><g><animateTransform attributeName="transform" type="scale" values="1 1;0.06 1;1 1;0.06 1;1 1" dur="${sec(TIMING.spin)}" fill="freeze"/><g transform="translate(-9 -9)">${back}</g></g></g>`)
    at = TIMING.spin
  } else {
    body += during(0, TIMING.buildup.rare, rects(backOf(c, 16, 1)))
    at = TIMING.buildup.rare
  }
  body += during(at, null, scaleX(rects(face), 0.3, 1, at, TIMING.cardFlash * 2)) + flashAt(face, at, TIMING.cardFlash * 3)
  const end = at + TIMING.cardFlash * 2
  body += sparkly(c) ? twinkles(end, 4) : ''
  const lead = kind === 'egg' || kind === 'present' ? INK.muted : glowColor(c)
  return doc(body + during(0, end, ring(lead, { motion })) + during(end, null, faceRing(c, true, end)), scale, isRainbow(c))
}

/** How long a single-card moment runs before the card lands (the driver waits this long, then flips). */
export function singleMs(kind: 'egg' | 'present' | 'bounty' | 'craft', fusion: boolean): number {
  if (kind === 'egg') return (fusion ? TIMING.merge : 0) + 3 * TIMING.wobble + 2 * TIMING.crack + TIMING.cardFlash * 2
  if (kind === 'present') return 2 * TIMING.presentShake + 2 * TIMING.unwrap + TIMING.cardFlash * 2
  if (kind === 'bounty') return TIMING.spin + TIMING.cardFlash * 2
  return TIMING.buildup.rare + TIMING.cardFlash * 2
}

/** A growing gene bar for the desktop reveal: the score counting up from 0 (SPEC 13.5). */
export function svgGenes(score: number, motion: boolean, widthPx = 96): string {
  const w = Math.round((widthPx * Math.max(0, Math.min(100, score))) / 100)
  const fill = score >= 80 ? RARITY_COLOR.legendary : RARITY_COLOR.rare
  const grow = motion ? `<animate attributeName="width" values="0;${w}" dur="0.8s" calcMode="spline" keySplines="0.2 0.8 0.2 1" keyTimes="0;1"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} 8" width="${widthPx}" height="8">`
    + `<rect x="0" y="1" width="${widthPx}" height="6" rx="3" fill="${INK.muted}" fill-opacity="0.35"/>`
    + `<rect x="0" y="1" width="${w}" height="6" rx="3" fill="${fill}">${grow}</rect></svg>`
}

/** The 2-second hold filling on the desktop (SPEC 21.8). */
export function svgHold(motion: boolean, widthPx = 64): string {
  const grow = motion ? `<animate attributeName="width" values="0;${widthPx}" dur="2s" fill="freeze"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} 6" width="${widthPx}" height="6">`
    + `<rect x="0" y="0" width="${widthPx}" height="6" rx="3" fill="${INK.muted}" fill-opacity="0.35"/>`
    + `<rect x="0" y="0" width="${motion ? 0 : widthPx}" height="6" rx="3" fill="${INK.warn}">${grow}</rect></svg>`
}
