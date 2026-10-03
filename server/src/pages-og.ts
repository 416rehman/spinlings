// The site's share images (site brief 13), 1200 x 630 in flat colours from the same scenery rasters
// the page draws: the landing's dusk meadow with today's featured species rustling in a tuft, and a
// postcard of the creature somebody met, standing in the grass of the hour they met it.
import { cardName } from '../../plugin/hooks/core/cards.ts'
import { FAMILY_INFO } from '../../plugin/hooks/core/families.ts'
import { silhouette, spriteFor } from '../../plugin/hooks/core/sprite.ts'
import type { Pixels } from '../../plugin/hooks/core/sprite.ts'
import type { Species } from '../../plugin/hooks/core/types.ts'
import { RARITY_COLOR } from '../../plugin/hooks/ui/tokens.ts'
import { createCanvas, encodePng, textWidth } from './png.ts'
import type { Canvas } from './png.ts'
import { HOUR_PAL } from './pages-html.ts'
import { teamRegulars } from './pages-meet.ts'
import type { Met, SiteWorld } from './pages-meet.ts'
import { Art, grassArt, hillArt, lampSvg, peaksArt, PATH_Y } from './pages-scene.ts'

const W = 1200, H = 630, S = 3
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0')

export type ImageCache = {
  /** The image drawn for `key`, if it is still kept; asking makes it the most recently used. */
  get(key: string): Promise<Uint8Array> | undefined
  /** Keeps a drawing under `key`, dropping the least recently used beyond the limit; a failed drawing is forgotten. */
  set(key: string, drawing: Promise<Uint8Array>): Promise<Uint8Array>
}

/**
 * The last `max` share images, in memory. Drawing one is tens of milliseconds of synchronous work and
 * its bytes never change, so each is drawn once while it is kept, and everyone asking meanwhile waits
 * on that one drawing.
 */
export function imageCache(max: number): ImageCache {
  const kept = new Map<string, Promise<Uint8Array>>()
  return {
    get(key) {
      const v = kept.get(key)
      if (v) { kept.delete(key); kept.set(key, v) } // re-inserted, so the Map stays in least-recently-used order
      return v
    },
    set(key, drawing) {
      kept.delete(key)
      if (kept.size >= max) kept.delete(kept.keys().next().value!)
      kept.set(key, drawing)
      drawing.catch(() => { if (kept.get(key) === drawing) kept.delete(key) })
      return drawing
    },
  }
}

type Pal = (typeof HOUR_PAL)['dusk']

const colours = (p: Pal): Record<string, string> => ({
  k1: p.sky[0], k2: p.sky[1], k3: p.sky[2], k4: p.sky[3], kp: p.peaks, kq: mix(p.peaks, p.sky[3], 0.55), kh: p.hill, ka: p.path, ke: mix(p.path, p.hill, 0.6),
  g1: p.grass[0], g2: p.grass[1], g3: p.grass[2], kl: p.lamp, kr: p.rim, lp: '#2a2433',
})

function mix(a: string, b: string, t: number): string {
  const n = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16)
  return '#' + [0, 1, 2].map(i => Math.round(n(a, i) * t + n(b, i) * (1 - t)).toString(16).padStart(2, '0')).join('')
}

/** Paints an Art raster at art offset (ax, ay) on the canvas's art grid, columns from `from`. */
function paint(c: Canvas, a: Art, ax: number, ay: number, cols: Record<string, string>, from = 0) {
  for (let y = 0; y < a.h; y++) {
    for (let x = from; x < a.w;) {
      const cls = a.get(x, y)
      let n = 1
      while (x + n < a.w && a.get(x + n, y) === cls) n++
      const col = cols[cls]
      if (cls && col) c.fillRect((ax + x - from) * S, (ay + y) * S, n * S, S, col)
      x += n
    }
  }
}

/** Sky bands with checker dither between them, over art rows [0, bottom). */
function sky(c: Canvas, p: Pal, rows: [number, number, number]) {
  const [b1, b2, b3] = rows
  c.fillRect(0, 0, W, H, p.sky[3])
  c.fillRect(0, 0, W, b3 * S, p.sky[2])
  c.fillRect(0, 0, W, b2 * S, p.sky[1])
  c.fillRect(0, 0, W, b1 * S, p.sky[0])
  for (const [y, above, below] of [[b1, p.sky[0], p.sky[1]], [b2, p.sky[1], p.sky[2]], [b3, p.sky[2], p.sky[3]]] as const) {
    for (let x = 0; x < W / S; x++) {
      if (x % 2) c.fillRect(x * S, (y - 1) * S, S, S, below)
      else c.fillRect(x * S, y * S, S, S, above)
    }
  }
}

function sprite(c: Canvas, px: Pixels, x: number, y: number, scale: number) {
  c.drawPixels(x, y, px.map(r => r.map(v => (v < 0 ? null : hex(v)))), scale)
}

/** The ground of a scene: peaks, hill with path, front grass; returns the path's walking row (art px). */
function ground(c: Canvas, p: Pal, offset: number, top: number): number {
  const cols = colours(p)
  const peaks = peaksArt(), hill = hillArt(), grass = grassArt()
  paint(c, peaks, 0, top, cols, offset)
  paint(c, hill, 0, top + 36, cols, offset)
  c.fillRect(0, (top + 36 + hill.h) * S, W, H, p.hill)
  const gy = H / S - grass.body.h
  c.fillRect(0, (gy + grass.body.h - 2) * S, W, H, p.grass[2])
  paint(c, grass.body, 0, gy, cols, offset)
  for (const t of grass.tips) paint(c, t.art, 0, gy, cols, offset)
  return top + 36 + PATH_Y
}

function lamp(c: Canvas, p: Pal, x: number, feet: number) {
  const a = new Art(7, 22)
  // the same lamp as the page: parse its classes back out of the svg markup
  const svg = lampSvg()
  for (const [, cls, d] of svg.matchAll(/class="(\w+)" d="([^"]+)"/g)) {
    for (const [, px, py, n] of d!.matchAll(/M(\d+) (\d+)h(\d+)/g)) for (let i = 0; i < +n!; i++) a.set(+px! + i, +py!, cls!)
  }
  paint(c, a, x, feet - 21, colours(p))
}

const TUFT = [
  '......1.....1....1......', '...1..12...121..12...1..', '...12.122..222.122..12..', '..122.2222.222.2222.122.', '..2222222222222222222222',
  '.22222232222222322222222', '.2223222222322222222322.', '222222222222222222222222', '222322222232222222232222', '232222232222222322222223',
]

function tuft(c: Canvas, p: Pal, ax: number, ay: number) {
  const ink: Record<string, string> = { '1': p.grass[0], '2': p.grass[1], '3': p.grass[2] }
  TUFT.forEach((r, y) => [...r].forEach((ch, x) => { if (ink[ch]) c.fillRect((ax + x) * S, (ay + y) * S, S, S, ink[ch]!) }))
}

const wordmark = (c: Canvas, x: number, y: number, col: string, scale: number) => c.drawText(x, y, 'spinlings', col, scale)

/** The landing's share image: a dusk meadow, two regulars on the lamp-lit path, today's featured species rustling. */
export async function meadowPng(w: SiteWorld, featured: Species): Promise<Uint8Array> {
  const p = HOUR_PAL.dusk
  const c = createCanvas(W, H, p.sky[3])
  sky(c, p, [44, 78, 104])
  const walk = ground(c, p, 56, 136)
  lamp(c, p, 78, walk)
  lamp(c, p, 318, walk)
  const [a, b] = teamRegulars(w, 'dusk')
  sprite(c, spriteFor(b), 330, walk * S - 96, 6)
  sprite(c, spriteFor(a), 440, walk * S - 96, 6)
  // the wild one: a dark silhouette in its tuft, a white ! above
  const shade = mix('#1d1726', '#a874e8', 0.75)
  sprite(c, silhouette(spriteFor({ form: featured, stage: 1 }), parseInt(shade.slice(1), 16)), 230 * S - 12, (walk - 10) * S - 60, 6)
  tuft(c, p, 228, walk - 4)
  c.drawText(234 * S + 6, (walk - 30) * S, '!', '#fffdf5', 7)
  wordmark(c, 48, 40, p.ink, 4)
  c.drawText(48, 104, 'Wild creatures find you', p.ink, 7)
  c.drawText(48, 104 + 70, 'while Claude works.', p.ink, 7)
  return encodePng(c)
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

/** Fits a name on one line from scale `big` down, or two words on two lines. */
function fitName(name: string, max: number): { lines: string[]; scale: number } {
  for (let s = 10; s >= 6; s--) if (textWidth(name, s) <= max) return { lines: [name], scale: s }
  const words = name.split(' ')
  if (words.length === 2) for (let s = 8; s >= 4; s--) if (words.every(w => textWidth(w, s) <= max)) return { lines: words, scale: s }
  let t = name
  while (t.length > 1 && textWidth(t + '...', 6) > max) t = t.slice(0, -1)
  return { lines: [t + '...'], scale: 6 }
}

/** A postcard: the creature at 20x in the grass of its hour, its name and what it is. */
export async function postcardPng(m: Met, host: string): Promise<Uint8Array> {
  const p = HOUR_PAL[m.hour]
  const c = createCanvas(W, H, p.sky[3])
  sky(c, p, [52, 88, 116])
  const walk = ground(c, p, 100, 120)
  void walk
  const px = spriteFor(m.card)
  sprite(c, px, 60, H - 20 * 16 - 18, 20)
  // grass in front of its feet
  const g = grassArt()
  paint(c, g.body, 0, H / S - g.body.h + 4, colours(p), 100)
  for (const t of g.tips) paint(c, t.art, 0, H / S - g.body.h + 4, colours(p), 100)
  if (m.card.foil) {
    const bands = ['#ff7ac6', '#f2b33d', '#9ed36a', '#5b8def', '#a874e8']
    bands.forEach((col, i) => {
      c.fillRect(i * 3, i * 3, W - i * 6, 3, col); c.fillRect(i * 3, H - 3 - i * 3, W - i * 6, 3, col)
      c.fillRect(i * 3, i * 3, 3, H - i * 6, col); c.fillRect(W - 3 - i * 3, i * 3, 3, H - i * 6, col)
    })
  }
  if (m.card.shiny) {
    const star = [[0, -2], [0, -1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [0, 1], [0, 2]]
    for (const [dx, dy] of star) c.fillRect(380 + dx! * 10, 120 + dy! * 10, 10, 10, '#fffdf5')
  }
  const left = 470, width = W - left - 56
  const name = fitName(cardName(m.card), width)
  let y = 92
  name.lines.forEach(line => { c.drawText(left, y, line, p.ink, name.scale); y += 10 * name.scale })
  y += 16
  const rarity = `${cap(m.card.rarity)} ${FAMILY_INFO[m.card.family].name}${m.card.shiny ? ' Shiny' : ''}`
  c.fillRect(left - 8, y - 8, textWidth(rarity, 5) + 16, 9 * 5 + 10, '#14121c')
  c.drawText(left, y, rarity, RARITY_COLOR[m.card.rarity], 5)
  y += 9 * 5 + 28
  c.drawText(left, y, `met me at ${m.hour}`, p.ink, 4)
  wordmark(c, left, H - 120, p.ink, 4)
  c.drawText(left, H - 72, host, p.soft, 3)
  return encodePng(c)
}

