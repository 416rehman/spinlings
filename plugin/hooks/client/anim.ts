// The shared frame helpers (SPEC 14): pure functions on Pixels ([y][x] = 0xRRGGBB, or -1 for transparent) that the
// band and the pane animate with. Each returns a new frame of the same size and never touches its input, and the same
// arguments always draw the same frame, so a frame is a function of time and seed alone. Below them, a small cell
// grid for Rasters that mix half-block pixels and glyphs, encoded the way Raster and $.ui.blit take it.
import type { Rarity } from '../core/types.ts'
import type { Pixels } from '../core/sprite.ts'
import { EYE, SHINE, base64, silhouette as coreSilhouette } from '../core/sprite.ts'
import { hashString } from '../core/rng.ts'
import { MYTHIC_COLOR, RARITY_COLOR, hexInt, hslInt } from '../ui/tokens.ts'

export const T = -1
/** Terminal frames run at 24 a second: the engine takes 120 blits a second, so this leaves room for several rasters. */
export const FPS = 24
export const FRAME_MS = 1000 / FPS

// ---------- timing (ms): every beat of every moment, in the band and in the pane, on both surfaces ----------

export const TIMING = {
  /** the stillness before a reveal (SPEC 14: 200 to 400 ms) */
  pause: 300,
  /** the reveal's white frame, then colour snapping in */
  flash: 84,
  reveal: 400,
  /** time to read "A wild Fogmaw appeared!" before the first round */
  revealHold: 900,
  duelIntro: 800,
  duelHold: 500,
  windup: 160,
  hitFlash: 60,
  shake: 180,
  /** HP bars drain over 300 ms (SPEC 14) */
  drain: 300,
  /** damage numbers rise a row and fade over 600 ms */
  popup: 600,
  stepIn: 240,
  ko: 700,
  /** the catch: 4 frames of squash into the card back, then 0.6 s wobble beats (SPEC 13.4) */
  spinFrame: 90,
  beat: 600,
  sparkle: 1400,
  evolve: 3000,
  evolveFlash: 160,
  evolveHold: 6000,
  fled: 1600,
  hatch: 2000,
  /** the pane's ceremonies blit a frame this often */
  tick: 66,
  /** the pack waits a beat, then tears in three frames (SPEC 14: 0.5 s) */
  tearDelay: 400,
  tear: 500,
  /** a face-down card glows this long before it flips: rarer, longer (SPEC 14) */
  buildup: { common: 300, rare: 600, epic: 900, legendary: 1400 } as Record<Rarity, number>,
  /** 0.35 s for a common, 0.8 s rare and above (SPEC 14) */
  flip: { common: 350, rare: 800, epic: 800, legendary: 800 } as Record<Rarity, number>,
  hold: { common: 350, rare: 600, epic: 800, legendary: 1600 } as Record<Rarity, number>,
  /** each extra layer (NEW, first, foil, shiny, high genes, trinket) gets its own short beat */
  layer: 250,
  /** a turned card's one bright frame */
  cardFlash: 120,
  merge: 800,
  wobble: 600,
  crack: 350,
  presentShake: 450,
  unwrap: 400,
  spin: 800,
} as const

// ---------- time ----------

export const clamp01 = (t: number) => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0)
/** Reveals ease out; exits ease in (SPEC 14). */
export const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3
export const easeIn = (t: number) => clamp01(t) ** 3

// ---------- colour ----------

export function mix(a: number, b: number, t: number): number {
  const k = clamp01(t)
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/** HSL lightness, 0..1. */
export function lightness(c: number): number {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 510
}

/** 0..1 for a pulse at time t (seconds), `hz` beats a second: a legendary's gold, a glowing back. */
export function pulse(t: number, hz = 1.2): number {
  return (Math.sin(t * Math.PI * 2 * hz - Math.PI / 2) + 1) / 2
}

// ---------- frames ----------

export function blank(w: number, h: number): Pixels {
  return Array.from({ length: h }, () => Array<number>(w).fill(T))
}

const sizeOf = (px: Pixels) => ({ w: px[0]?.length ?? 0, h: px.length })
const at = (px: Pixels, x: number, y: number) => px[y]?.[x] ?? T
const map = (px: Pixels, fn: (c: number, x: number, y: number) => number): Pixels => px.map((row, y) => row.map((c, x) => fn(c, x, y)))

/** Every opaque pixel in one flat colour: the rustle's shadow, an unseen creature. */
export function silhouette(px: Pixels, color = 0x3a3646): Pixels {
  return coreSilhouette(px, color)
}

/** Every opaque pixel white (or `color`): the one bright frame before a reveal, a hit landing. */
export function flash(px: Pixels, color = 0xffffff): Pixels {
  return map(px, c => (c === T ? T : color))
}

/** Every opaque pixel moved `t` of the way toward `color`: a fading flash, a heal's glow. */
export function tint(px: Pixels, color: number, t: number): Pixels {
  if (t <= 0) return px.map(r => r.slice())
  return map(px, c => (c === T ? T : mix(c, color, t)))
}

/**
 * Squashed horizontally about the centre to `scaleX` of its width (0 is gone, 1 untouched): the card spin. A negative
 * scale mirrors, as the far side of a turn.
 */
export function squash(px: Pixels, scaleX: number): Pixels {
  const { w, h } = sizeOf(px)
  const s = Math.abs(scaleX)
  if (s >= 0.999 && scaleX > 0) return px.map(r => r.slice())
  const out = blank(w, h)
  if (s < 1 / (w * 2)) return out
  const cx = w / 2
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sx = cx + (x + 0.5 - cx) / s
    if (scaleX < 0) sx = w - sx
    const ix = Math.floor(sx)
    if (ix >= 0 && ix < w) out[y]![x] = at(px, ix, y)
  }
  return out
}

/** Shifted by whole pixels, clipped at the edges: wobbles, shakes, a lunge, a fall. */
export function offset(px: Pixels, dx: number, dy: number): Pixels {
  const { w, h } = sizeOf(px)
  const ox = Math.round(dx), oy = Math.round(dy)
  if (ox === 0 && oy === 0) return px.map(r => r.slice())
  const out = blank(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(px, x - ox, y - oy)
    if (c !== T) out[y]![x] = c
  }
  return out
}

/** `inner` placed at (x, y) on a w x h canvas: a mini on a bigger stage, a sprite inside a card. */
export function place(inner: Pixels, w: number, h: number, x: number, y: number): Pixels {
  const out = blank(w, h)
  inner.forEach((row, iy) => row.forEach((c, ix) => {
    const ox = ix + x, oy = iy + y
    if (c !== T && ox >= 0 && ox < w && oy >= 0 && oy < h) out[oy]![ox] = c
  }))
  return out
}

/** `top` drawn over `base` (same size): transparent pixels of `top` show `base`. */
export function over(base: Pixels, top: Pixels): Pixels {
  return map(base, (c, x, y) => { const t = at(top, x, y); return t === T ? c : t })
}

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
const touches = (px: Pixels, x: number, y: number) => N4.some(([dx, dy]) => at(px, x + dx, y + dy) !== T)

/**
 * A glow of `color` in the clear pixels around the sprite: the first ring from `strength` above 0, a sparse second
 * ring from 0.66. Only clear pixels change, so an unoutlined halo on the frame's top row is glowed around, never over.
 */
export function glowOutline(px: Pixels, color: number, strength: number): Pixels {
  const s = clamp01(strength)
  if (s === 0) return px.map(r => r.slice())
  const ring1 = map(px, (c, x, y) => {
    if (c !== T || !touches(px, x, y)) return c
    const near = N4.map(([dx, dy]) => at(px, x + dx, y + dy)).find(n => n !== T) ?? color
    return mix(near, color, 0.45 + 0.55 * s)
  })
  if (s < 0.66) return ring1
  return map(ring1, (c, x, y) => (c === T && (x + y) % 2 === 0 && touches(ring1, x, y) ? mix(color, 0xffffff, 0.15) : c))
}

/** A 4-point star of light at (x, y): a pixel at small sizes, a plus at the peak. */
function star(px: Pixels, x: number, y: number, size: number, color: number): void {
  const put = (sx: number, sy: number, c: number) => { if (px[sy]?.[sx] !== undefined && px[sy]![sx] === T) px[sy]![sx] = c }
  if (size <= 0) return
  put(x, y, color)
  if (size >= 2) for (const [dx, dy] of N4) put(x + dx, y + dy, mix(color, 0x9a8fd0, 0.35))
}

/**
 * Twinkling stars in the clear pixels near the sprite, each on its own phase; deterministic by `seed`, `t` in seconds.
 * `count` stars at most; a shiny's twinkle, a catch's sparkle burst, a Perfect special.
 */
export function sparkles(px: Pixels, t: number, seed: string | number, o: { count?: number; color?: number; reach?: number } = {}): Pixels {
  const { w, h } = sizeOf(px)
  const out = px.map(r => r.slice())
  const reach = o.reach ?? 2
  const spots: [number, number][] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (at(px, x, y) !== T) continue
    let near = false
    for (let dy = -reach; dy <= reach && !near; dy++) for (let dx = -reach; dx <= reach && !near; dx++) if (at(px, x + dx, y + dy) !== T) near = true
    if (near) spots.push([x, y])
  }
  if (spots.length === 0) return out
  const count = Math.min(o.count ?? 4, spots.length)
  const color = o.color ?? 0xfffbe6
  for (let i = 0; i < count; i++) {
    const hsh = hashString(`spark/${seed}/${i}`)
    const [x, y] = spots[hsh % spots.length]!
    const phase = ((hsh >>> 8) % 1000) / 1000
    const cycle = ((t * 1.6 + phase) % 1 + 1) % 1
    const size = cycle < 0.15 ? 1 : cycle < 0.35 ? 2 : cycle < 0.5 ? 1 : 0
    star(out, x, y, size, color)
  }
  return out
}

/** The outline: an edge pixel that is dark. A light edge (a halo, an aura, a sparkle) is not outline. */
function isOutline(px: Pixels, x: number, y: number): boolean {
  const c = at(px, x, y)
  if (c === T) return false
  const edge = N4.some(([dx, dy]) => at(px, x + dx, y + dy) === T)
  return edge && lightness(c) < 0.36
}

/** One foil sweep takes 2.4 s (SPEC 14). */
export const FOIL_PERIOD = 2.4

/**
 * The foil sheen: a diagonal holo band 3 pixels wide crosses the creature every 2.4 s; pixels inside it blend 28%
 * toward the rainbow hue (x*18 + y*10 + t*90) mod 360 at their own lightness. Eyes, catchlights and the outline stay.
 */
export function foil(px: Pixels, t: number): Pixels {
  const { w, h } = sizeOf(px)
  const span = w + h + 6
  const centre = -3 + ((((t % FOIL_PERIOD) + FOIL_PERIOD) % FOIL_PERIOD) / FOIL_PERIOD) * span
  return map(px, (c, x, y) => {
    if (c === T || c === EYE || c === SHINE || Math.abs(x + y - centre) >= 1.5 || isOutline(px, x, y)) return c
    const hue = (x * 18 + y * 10 + t * 90) % 360
    return mix(c, hslInt(hue, 0.8, lightness(c)), 0.28)
  })
}

/** A pixel's own threshold in [0, 1): the order it leaves in when dissolving. */
const threshold = (x: number, y: number, seed: string | number) => (hashString(`dissolve/${seed}/${x}/${y}`) % 10_000) / 10_000

/**
 * Gone into the static: pixels leave in a seeded order as `t` runs 0..1, each crackling grey for a moment before it
 * vanishes. A lost Mythic's farewell; a creature dropping out.
 */
export function dissolve(px: Pixels, t: number, seed: string | number): Pixels {
  const k = clamp01(t)
  const frame = Math.floor(k * 48)
  return map(px, (c, x, y) => {
    if (c === T) return T
    const th = threshold(x, y, seed)
    if (th < k) return T
    if (k > 0 && th < k + 0.18) {
      const n = hashString(`static/${seed}/${x}/${y}/${frame}`) % 4
      return n === 0 ? 0xe8e6f0 : n === 1 ? 0x8a8798 : n === 2 ? 0x4a4658 : c
    }
    return c
  })
}

const BACK = 0x2a2540, BACK_LINE = 0x3b3558, BACK_MARK = 0x5a5285, BACK_RIM = 0x4b4368

/**
 * A face-down card, the one back every surface shows: a rounded dark back with a diamond lattice and a centre star,
 * its border in the rarity's colour (SPEC 13.5): grey for common, blue rare, purple epic, gold legendary, pink for a
 * Mythic; a legendary's and a Mythic's border pulses with `glowT` (0..1 is one pulse). With `glow` (0..1) the back
 * builds up instead, as a pack's backs do: a common keeps a plain rim, the rarer ones light their rim and an inner
 * ring by `glow`.
 */
export function cardBack(width: number, height: number, rarity: Rarity, glowT = 0, o: { mythic?: boolean; glow?: number } = {}): Pixels {
  const w = Math.max(3, Math.round(width)), h = Math.max(3, Math.round(height))
  const out = blank(w, h)
  const phase = (((glowT % 1) + 1) % 1) || 0
  const beat = rarity === 'legendary' || o.mythic ? 0.5 + 0.5 * Math.sin(phase * Math.PI * 2) : 0
  const base = hexInt(o.mythic ? MYTHIC_COLOR : RARITY_COLOR[rarity])
  const lit = o.glow === undefined ? null : rarity === 'common' && !o.mythic ? 0 : clamp01(o.glow)
  const rim = lit === null ? base : lit === 0 ? BACK_RIM : mix(BACK_RIM, base, 0.35 + 0.65 * lit)
  const border = lit === 0 ? rim : mix(rim, 0xfff4c8, 0.35 * beat)
  const ring = lit ? mix(BACK, base, 0.25 * lit) : null
  const cx = (w - 1) / 2, cy = (h - 1) / 2
  const arm = Math.max(1, Math.floor(Math.min(w, h) / 6)) + 0.5
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1)
    if (corner) continue
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { out[y]![x] = border; continue }
    if (ring !== null && (x === 1 || y === 1 || x === w - 2 || y === h - 2)) { out[y]![x] = ring; continue }
    const dx = Math.abs(x - cx), dy = Math.abs(y - cy)
    if (dx < 1 && dy < 1) out[y]![x] = mix(base, 0xffffff, 0.3)
    else if ((dx < 1 && dy < arm) || (dy < 1 && dx < arm)) out[y]![x] = BACK_MARK
    else out[y]![x] = (x + y) % 4 === 0 || (x - y + 64) % 4 === 0 ? BACK_LINE : BACK
  }
  return out
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const

/**
 * From `a` to `b` as `t` runs 0..1, with an ordered dither, since a pixel is either there or not: shapes melt into
 * each other (the evolution's two stages), colours where both are drawn.
 */
export function crossfade(a: Pixels, b: Pixels, t: number): Pixels {
  const k = clamp01(t)
  const w = Math.max(a[0]?.length ?? 0, b[0]?.length ?? 0), h = Math.max(a.length, b.length)
  const out = blank(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const useB = (BAYER[(y % 4) * 4 + (x % 4)]! + 0.5) / 16 < k
    out[y]![x] = useB ? at(b, x, y) : at(a, x, y)
  }
  return out
}

// ---------- cells: Rasters mixing half-block pixels and glyphs ----------

/** The terminal's own colour (Raster): a clear pixel, a glyph on the background. */
export const DEFAULT_COLOR = 0x01000000
const UPPER = 0x2580, LOWER = 0x2584, SPACE_CP = 0x20

export type Grid = { columns: number; rows: number; cp: Uint32Array; fg: Uint32Array; bg: Uint32Array }

export function grid(columns: number, rows: number): Grid {
  const n = Math.max(1, columns) * Math.max(1, rows)
  return {
    columns: Math.max(1, columns), rows: Math.max(1, rows),
    cp: new Uint32Array(n).fill(SPACE_CP), fg: new Uint32Array(n).fill(DEFAULT_COLOR), bg: new Uint32Array(n).fill(DEFAULT_COLOR),
  }
}

/** Pixels drawn as half blocks with their top-left at cell (column, row): two pixel rows per cell. */
export function putPixels(g: Grid, px: Pixels, column: number, row: number): void {
  const rows = Math.ceil(px.length / 2), w = px[0]?.length ?? 0
  for (let r = 0; r < rows; r++) for (let x = 0; x < w; x++) {
    const cx = column + x, cy = row + r
    if (cx < 0 || cy < 0 || cx >= g.columns || cy >= g.rows) continue
    const top = at(px, x, 2 * r), bot = at(px, x, 2 * r + 1)
    const i = cy * g.columns + cx
    if (top === T && bot === T) continue
    if (top === T) { g.cp[i] = LOWER; g.fg[i] = bot; g.bg[i] = DEFAULT_COLOR }
    else if (bot === T) { g.cp[i] = UPPER; g.fg[i] = top; g.bg[i] = DEFAULT_COLOR }
    else { g.cp[i] = UPPER; g.fg[i] = top; g.bg[i] = bot }
  }
}

/**
 * Text drawn into cells from (column, row), clipped to the grid. Every glyph must be one printable width-1 BMP code
 * point; anything else draws as a space. `keepBg` lays the glyph over what the cell shows (a number over a creature).
 */
export function putText(g: Grid, column: number, row: number, text: string, fg: number, o: { keepBg?: boolean } = {}): void {
  if (row < 0 || row >= g.rows) return
  let x = column
  for (const ch of text) {
    if (x >= g.columns) break
    if (x >= 0) {
      const i = row * g.columns + x
      const cp = ch.codePointAt(0)!
      const ok = cp >= 0x20 && cp <= 0xffff && cp !== 0x7f && !(cp >= 0x80 && cp < 0xa0) && !(cp >= 0x1100 && wide(cp))
      if (o.keepBg) {
        // a glyph over half-block pixels: the cell's background becomes the pixel it covered, so the glyph sits on the creature
        g.bg[i] = g.cp[i] === UPPER || g.cp[i] === LOWER ? g.fg[i]! : g.bg[i]!
      } else {
        g.bg[i] = DEFAULT_COLOR
      }
      g.cp[i] = ok ? cp : SPACE_CP
      g.fg[i] = fg
    }
    x++
  }
}

/** East Asian wide and fullwidth ranges that a cell cannot hold. */
function wide(cp: number): boolean {
  return (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3)
    || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)
}

/** The grid as Raster `cells`: base64 of little-endian [codePoint, fg, bg] triplets, row-major. */
export function encodeGrid(g: Grid): string {
  const n = g.columns * g.rows
  const bytes = new Uint8Array(n * 12)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < n; i++) {
    view.setUint32(i * 12, g.cp[i]!, true)
    view.setUint32(i * 12 + 4, g.fg[i]!, true)
    view.setUint32(i * 12 + 8, g.bg[i]!, true)
  }
  return base64(bytes)
}

/** Pixels alone as Raster cells (no frame): what a sprite Raster is drawn and blitted with. */
export function pixelCells(px: Pixels): { columns: number; rows: number; cells: string } {
  const g = grid(px[0]?.length ?? 1, Math.ceil(px.length / 2))
  putPixels(g, px, 0, 0)
  return { columns: g.columns, rows: g.rows, cells: encodeGrid(g) }
}

/** One cell of a grid, for tests and checks: its glyph and colours. */
export function cellAt(g: Grid, column: number, row: number): { ch: string; fg: number; bg: number } {
  const i = row * g.columns + column
  return { ch: String.fromCodePoint(g.cp[i] ?? SPACE_CP), fg: g.fg[i] ?? DEFAULT_COLOR, bg: g.bg[i] ?? DEFAULT_COLOR }
}

/** A grid's glyphs as text lines (pixels read as blocks): what a test or a reader can check. */
export function gridText(g: Grid): string[] {
  const lines: string[] = []
  for (let r = 0; r < g.rows; r++) {
    let s = ''
    for (let c = 0; c < g.columns; c++) s += String.fromCodePoint(g.cp[r * g.columns + c]!)
    lines.push(s)
  }
  return lines
}
