// The site's scenery, drawn in art pixels (site brief 2.1): flat bands joined by checker dither, and
// layers of crisp inline SVG, one path per colour, horizontal runs. Colours are CSS classes bound to
// the hour's tokens (k1..k4 sky, kp peaks, kh hill, ka path, g1..g3 grass, kl light), so the sky can
// change hour without redrawing a pixel. Each SVG is sized `artWidth x --ap` by CSS and centred, never
// scaled to fit. Actors (creatures, signs, lamps) are positioned by the page, never baked in here.
import { hashString } from '../../plugin/hooks/core/rng.ts'
import { maskPath } from './pages-sprite.ts'

/** A raster of colour classes; cells hold an index into `classes` (0 = empty). */
export class Art {
  readonly w: number
  readonly h: number
  readonly cells: Uint8Array
  readonly classes: string[] = ['']
  constructor(w: number, h: number) { this.w = w; this.h = h; this.cells = new Uint8Array(w * h) }
  private idx(cls: string) {
    let i = this.classes.indexOf(cls)
    if (i < 0) { i = this.classes.length; this.classes.push(cls) }
    return i
  }
  set(x: number, y: number, cls: string) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.cells[y * this.w + x] = cls ? this.idx(cls) : 0
  }
  get(x: number, y: number) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.classes[this.cells[y * this.w + x]!]! : '' }
  rect(x: number, y: number, w: number, h: number, cls: string) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, cls)
  }
  /** fills each column x from row `top(x)` down to `bottom` */
  columns(top: (x: number) => number, cls: string, bottom = this.h) {
    for (let x = 0; x < this.w; x++) for (let y = Math.max(0, Math.round(top(x))); y < bottom; y++) this.set(x, y, cls)
  }
  /** rows of '.' and letters mapped through `ink`, drawn at x, y */
  sprite(x: number, y: number, rows: readonly string[], ink: Record<string, string>) {
    rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ink[ch]) this.set(x + i, y + j, ink[ch]!) }))
  }
  paths(order?: readonly string[]): string {
    const list = order ?? this.classes.slice(1)
    return list.map(cls => {
      const i = this.classes.indexOf(cls)
      if (i < 1) return ''
      const on = (x: number, y: number) => this.cells[y * this.w + x] === i
      // scenery is mostly columns (peaks, hills, grass), so each colour takes whichever runs are shorter
      const rows = maskPath(this.w, this.h, on), cols = columnPath(this.w, this.h, on)
      const d = cols.length < rows.length ? cols : rows
      return d ? `<path class="${cls}" d="${d}"/>` : ''
    }).join('')
  }
  /** The art as one tile, repeated across `total` art px by a pattern (long edges stay small). */
  tiled(cls: string, order: readonly string[], total = 1000): string {
    const id = 'tl-' + cls.replace(/[^a-z]+/g, '-')
    return `<svg class="${cls}" viewBox="0 0 ${total} ${this.h}" style="--aw:${total};--ah:${this.h}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">`
      + `<defs><pattern id="${id}" width="${this.w}" height="${this.h}" patternUnits="userSpaceOnUse">${this.paths(order)}</pattern></defs><rect width="${total}" height="${this.h}" fill="url(#${id})"/></svg>`
  }
  svg(cls: string, order?: readonly string[], extra = ''): string {
    return `<svg class="${cls}" viewBox="0 0 ${this.w} ${this.h}" style="--aw:${this.w};--ah:${this.h}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${this.paths(order)}${extra}</svg>`
  }
}

/** Vertical runs of the cells where `on(x, y)` holds, as one path's d (maskPath's column twin). */
export function columnPath(w: number, h: number, on: (x: number, y: number) => boolean): string {
  let d = ''
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h;) {
      if (!on(x, y)) { y++; continue }
      let n = 1
      while (y + n < h && on(x, y + n)) n++
      d += `M${x} ${y}h1v${n}h-1z`
      y += n
    }
  }
  return d
}

/** A stable pseudo-random 0..1 for a place in the art. */
export const noise = (k: string, i: number) => (hashString(`${k}/${i}`) % 10000) / 10000

const memo = new Map<string, string>()
const once = (key: string, make: () => string) => {
  let v = memo.get(key)
  if (v === undefined) memo.set(key, (v = make()))
  return v
}

/**
 * A 2-row checker dither from class `a` (above) to `b` (below), wide enough for any screen at 3 px.
 * It uses a pattern from the page's one <defs> (ditherDefs).
 */
export const dither = (a: string, b: string, rows = 2) => `<svg class="dz" viewBox="0 0 1000 ${rows}" style="--aw:1000;--ah:${rows}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">`
  + `<rect width="1000" height="${rows}" fill="url(#dz-${a}-${b})"/></svg>`

/**
 * A tall walk from class `a` (above) to `b` (below) in three ordered-dither bands (a quarter, half and
 * three quarters of b), each `band` art rows high, so one place fades into the next instead of
 * switching at a hard edge. Its patterns are its own, so each pair is used once per page.
 */
export const ramp = (a: string, b: string, band = 6) => {
  const id = `rp-${a}-${b}`
  const cells = ['M0 0h1v1h-1z', 'M0 0h1v1h-1zM1 1h1v1h-1z', 'M0 0h2v1h-2zM1 1h1v1h-1z']
  const pats = cells.map((d, k) => `<pattern id="${id}-${k}" width="2" height="2" patternUnits="userSpaceOnUse"><path class="${a}" d="M0 0h2v2h-2z"/><path class="${b}" d="${d}"/></pattern>`).join('')
  const h = band * 3
  return `<svg class="dz ramp" viewBox="0 0 1000 ${h}" style="--aw:1000;--ah:${h}" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><defs>${pats}</defs>`
    + [0, 1, 2].map(k => `<rect y="${k * band}" width="1000" height="${band}" fill="url(#${id}-${k})"/>`).join('') + '</svg>'
}

/** The page's shared dither patterns: each a 2x2 checker of two colour classes. */
export function ditherDefs(pairs: readonly (readonly [string, string])[]): string {
  return `<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>${pairs.map(([a, b]) =>
    `<pattern id="dz-${a}-${b}" width="2" height="2" patternUnits="userSpaceOnUse"><path class="${a}" d="M0 0h1v1h-1zM1 1h1v1h-1z"/><path class="${b}" d="M1 0h1v1h-1zM0 1h1v1h-1z"/></pattern>`).join('')}</defs></svg>`
}

// ---- the hero: peaks, hill and path, front grass --------------------------------------------------
// The hero's scene is 512 art px wide (2048 px at 4 px). Its centre is x = 256. On wide screens the
// hero's text sits left of centre + 43, so only peaks right of that may rise into the text's rows.

export const SCENE_W = 512

/** Two ranges of stepped peaks; snow (sky4) on the tallest. Height 44. */
let PEAKS: Art | null = null
export function peaksArt(): Art {
  if (PEAKS) return PEAKS
  const W = SCENE_W, H = 44, a = new Art(W, H)
  type Peak = [cx: number, h: number, slope: number]
  const far: Peak[] = [[20, 12, 0.55], [84, 15, 0.6], [150, 11, 0.5], [214, 14, 0.62], [318, 34, 0.72], [372, 40, 0.8], [430, 29, 0.66], [492, 18, 0.6]]
  const near: Peak[] = [[52, 9, 0.5], [120, 12, 0.7], [182, 8, 0.45], [262, 13, 0.6], [346, 22, 0.75], [404, 26, 0.7], [462, 15, 0.55]]
  const height = (list: Peak[], x: number, k: string) => {
    let best = 0
    for (const [cx, h, s] of list) best = Math.max(best, h - Math.abs(x - cx) * s)
    // a little crag: one pixel up or down every few columns
    const j = noise(k, x >> 2)
    return Math.max(0, Math.round(best + (best > 3 ? (j < 0.2 ? -1 : j > 0.85 ? 1 : 0) : 0)))
  }
  // far range, lighter
  a.columns(x => H - height(far, x, 'far'), 'kq')
  // snow caps on far peaks taller than 26
  for (let x = 0; x < W; x++) {
    const hgt = height(far, x, 'far')
    if (hgt > 26) {
      const cap = Math.min(hgt - 26, 3 + (noise('cap', x) > 0.5 ? 1 : 0))
      for (let y = H - hgt; y < H - hgt + cap; y++) a.set(x, y, 'k4')
    }
  }
  a.columns(x => H - height(near, x, 'near'), 'kp')
  return (PEAKS = a)
}
export const peaksSvg = () => once('peaks', () => peaksArt().svg('peaks', ['kq', 'k4', 'kp']))

/** Where the path's walking line sits in the hill, by column (art px from the hill's top). */
export const PATH_Y = 17

/** The hill with its winding path, height 30: hill, path, path edge, and a few bushes. */
let HILL: Art | null = null
export function hillArt(): Art {
  if (HILL) return HILL
  const W = SCENE_W, H = 30, a = new Art(W, H)
  const top = (x: number) => 7 + 2.4 * Math.sin(x / 38 + 0.6) + 1.6 * Math.sin(x / 15.5 + 2.2)
  a.columns(top, 'kh')
  // bushes along the ridge behind the path
  for (let x = 6; x < W - 6; x += 9 + Math.floor(noise('bush', x) * 23)) {
    const w = 5 + Math.floor(noise('bw', x) * 6), t = Math.round(top(x + (w >> 1)))
    for (let i = 0; i < w; i++) {
      const hh = Math.round(3 - Math.abs(i - (w - 1) / 2) * 0.8 + noise('bh', x + i))
      for (let y = t - hh; y < t + 2; y++) a.set(x + i, y, 'g2')
      a.set(x + i, t - hh, 'g1')
    }
  }
  // the path: 4 rows, a soft edge above and a dark edge below, drifting a little
  for (let x = 0; x < W; x++) {
    const y0 = PATH_Y - 2 + Math.round(0.9 * Math.sin(x / 41))
    a.set(x, y0 - 1, 'ke')
    for (let y = y0; y < y0 + 4; y++) a.set(x, y, 'ka')
    if (noise('peb', x) > 0.93) a.set(x, y0 + 1 + (x % 2), 'ke')
    a.set(x, y0 + 4, 'ke')
  }
  // flowers in the hill grass
  for (let x = 3; x < W; x += 7 + Math.floor(noise('fl', x) * 12)) {
    const y = PATH_Y + 5 + Math.floor(noise('fy', x) * 6)
    a.set(x, y, noise('fc', x) > 0.5 ? 'kl' : 'g1')
  }
  return (HILL = a)
}
export const hillSvg = () => once('hill', () => hillArt().svg('hill', ['kh', 'g2', 'g1', 'ke', 'ka', 'kl']))

/** The front grass, height 16: blade bodies in one path, each tuft's tips in its own group (they lean). */
let GRASS: { body: Art; tips: { x: number; art: Art }[] } | null = null
export function grassArt(): { body: Art; tips: { x: number; art: Art }[] } {
  if (GRASS) return GRASS
  const W = SCENE_W, H = 16, body = new Art(W, H)
  const tips: { x: number; art: Art }[] = []
  let x = 0, n = 0
  while (x < W) {
    const tw = 6 + Math.floor(noise('tw', n) * 7)
    const tip = new Art(W, H)
    for (let i = 0; i < tw && x + i < W; i++) {
      const cx = x + i
      const peak = 1 - Math.abs(i - (tw - 1) / 2) / (tw / 2)
      const h = 5 + Math.round(peak * 6 + noise('bl', cx) * 3)
      const t = H - h
      for (let y = t; y < H; y++) body.set(cx, y, y >= H - 4 ? 'g3' : 'g2')
      // ragged blade tips: the top two pixels, and a lighter streak
      tip.set(cx, t, 'g1')
      if (noise('tt', cx) > 0.45) tip.set(cx, t + 1, 'g1')
      if (noise('st', cx) > 0.8) body.set(cx, t + 3, 'g1')
    }
    tips.push({ x: x + (tw >> 1), art: tip })
    x += tw
    n++
  }
  return (GRASS = { body, tips })
}
export const grassSvg = () => once('grass', () => {
  const g = grassArt()
  return g.body.svg('grass', ['g2', 'g3', 'g1'], g.tips.map(t => `<g class="tf" data-x="${t.x}">${t.art.paths(['g1'])}</g>`).join(''))
})

/** The rustle tuft, 24 x 14: its body and its swaying tip layer. */
export const tuftSvg = () => once('tuft', () => {
  const W = 24, H = 14
  const body = new Art(W, H), tip = new Art(W, H)
  const shape = [
    '......1.....1....1......',
    '...1..12...121..12...1..',
    '...12.122..222.122..12..',
    '..122.2222.222.2222.122.',
    '..2222222222222222222222',
    '.22222232222222322222222',
    '.2223222222322222222322.',
    '222222222222222222222222',
    '222322222232222222232222',
    '232222232222222322222223',
    '222222222222222222222222',
    '333333333333333333333333',
    '333333333333333333333333',
    '333333333333333333333333',
  ]
  shape.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch === '1') tip.set(x, y, 'g1')
    else if (ch === '2') (y < 4 ? tip : body).set(x, y, 'g2')
    else if (ch === '3') body.set(x, y, 'g3')
  }))
  return `<svg class="tuft" viewBox="0 0 ${W} ${H}" style="--aw:${W};--ah:${H}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${body.paths(['g2', 'g3'])}<g class="tt">${tip.paths(['g1', 'g2'])}</g></svg>`
})

/** A lamp post on the path, 7 x 22, with its lit glass (kl) and a dark glass for when it is off. */
export const lampSvg = () => once('lamp', () => {
  const a = new Art(7, 22)
  a.sprite(0, 0, [
    '..sss..',
    '.sssss.',
    's.lll.s',
    's.lll.s',
    's.lll.s',
    '.sssss.',
    '...s...',
    '...s...',
    '...s...',
    '...s...',
    '...s...',
    '...s...',
    '...s...',
    '...s...',
    '...s...',
    '...s...',
    '...s...',
    '...s...',
    '..sss..',
    '..sss..',
    '.sssss.',
    '.sssss.',
  ], { s: 'lp', l: 'kl' })
  return a.svg('lampart', ['lp', 'kl'])
})

/** The sun: a 14 x 14 disc with a rim. */
export const sunSvg = () => once('sun', () => {
  const a = new Art(14, 14)
  for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) {
    const d = Math.hypot(x - 6.5, y - 6.5)
    if (d < 7) a.set(x, y, d > 5.6 ? 'kr' : 'kl')
  }
  return a.svg('sunart', ['kl', 'kr'])
})

/** The moon: a 12 x 12 disc and its 8 phases' shadows (one shows, by html[data-moon]). */
export const moonSvg = () => once('moon', () => {
  const N = 12, c = 5.5, r = 6
  const disc = (x: number, y: number) => Math.hypot(x - c, y - c) < r
  const lit = new Art(N, N)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (disc(x, y)) lit.set(x, y, 'kl')
  lit.set(3, 4, 'km'); lit.set(4, 4, 'km'); lit.set(7, 7, 'km'); lit.set(6, 2, 'km')
  let shadows = ''
  for (let p = 0; p < 8; p++) {
    // waxing: the shadow slides off to the left; waning: it comes back from the right
    const k = p <= 4 ? p / 4 : (p - 4) / 4
    const off = p <= 4 ? -k * 2 * r : (1 - k) * 2 * r
    const d = p === 4 ? '' : maskPath(N, N, (x, y) => disc(x, y) && Math.hypot(x - c - off, y - c) < r + (p === 0 ? 1 : 0))
    shadows += `<path class="ms mp${p}" d="${d}"/>`
  }
  return lit.svg('moonart', ['kl', 'km'], shadows)
})

/** Night stars, 300 x 60 (one class each for twinkle groups). */
export const starsSvg = () => once('stars', () => {
  const a = new Art(300, 60)
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(noise('sx', i) * 300), y = Math.floor(noise('sy', i) * 60)
    a.set(x, y, `s${i % 3}`)
    if (i % 11 === 0) { a.set(x - 1, y, `s${i % 3}`); a.set(x + 1, y, `s${i % 3}`); a.set(x, y - 1, `s${i % 3}`); a.set(x, y + 1, `s${i % 3}`) }
  }
  return a.svg('stars', ['s0', 's1', 's2'])
})

// ---- section edges ---------------------------------------------------------------------------

/** The cutaway into the den: the clearing's grass edge, then soil with hanging roots. 1000 x 22. */
export const denTopSvg = () => once('dentop', () => {
  const W = 250, H = 22, a = new Art(W, H)
  a.rect(0, 0, W, H, 'so')
  for (let x = 0; x < W; x++) {
    const g = 3 + Math.round(noise('dg', x) * 2)
    for (let y = 0; y < g; y++) a.set(x, y, 'kc')
    if (noise('dgt', x) > 0.55) a.set(x, g, 'kc')
  }
  // roots: wandering lines that drop and thin out
  for (let r = 0; r < 12; r++) {
    let x = Math.floor(noise('rx', r) * W), y = 3
    const len = 8 + Math.floor(noise('rl', r) * 16)
    for (let i = 0; i < len && y < H; i++) {
      a.set(x, y, 'rt')
      if (i < len * 0.6) a.set(x + 1, y, 'rt')
      if (noise(`rh${r}`, i) > 0.86) { a.set(x - 1, y + 1, 'rt'); a.set(x - 2, y + 2, 'rt') }
      y++
      const turn = noise(`rt${r}`, i)
      if (turn < 0.25) x--
      else if (turn > 0.75) x++
    }
  }
  // stones
  for (let s = 0; s < 10; s++) {
    const x = Math.floor(noise('stx', s) * W), y = 8 + Math.floor(noise('sty', s) * 12)
    a.rect(x, y, 2 + (s % 2), 1, 'st')
  }
  return a.tiled('edge dentop', ['so', 'kc', 'rt', 'st'])
})

/**
 * Out of the den into the night: soil, a grass line, then the market town's houses against the sky,
 * each a wall with a stepped gable roof, a chimney now and then and a window or two lit. 1000 x 34.
 */
export const marketTopSvg = () => once('mtop', () => {
  const W = 250, H = 34, a = new Art(W, H)
  a.rect(0, 0, W, 4, 'so')
  for (let x = 0; x < W; x++) {
    const t = 4 + Math.round(noise('mg', x) * 2)
    for (let y = 4; y < t + 1; y++) a.set(x, y, 'ng')
  }
  a.rect(0, 7, W, H - 7, 'nt')
  let x = 6
  for (let i = 0; x < W - 22; i++) {
    const w = 15 + 2 * Math.floor(noise('hw', i) * 6), wall = 6 + Math.floor(noise('hh', i) * 5), top = H - wall, rh = Math.floor(w / 4)
    a.rect(x, top, w, wall, 'nr')
    for (let r = 0; r <= rh; r++) a.rect(x - 1 + 2 * r, top - 1 - r, w + 2 - 4 * r, 1, 'nf')
    if (noise('ch', i) > 0.45) a.rect(x + w - 5, top - rh - 1, 2, rh, 'nf')
    for (let k = 0; k < 2; k++) if (noise('win', i * 2 + k) > 0.3) a.rect(k ? x + w - 6 : x + 3, top + 2, 2, 2, noise('wl', i * 2 + k) > 0.45 ? 'nw' : 'nx')
    if (wall > 8) a.rect(x + (w >> 1) - 1, H - 4, 3, 4, 'nf')
    x += w + 5 + Math.floor(noise('hg', i) * 16)
  }
  return a.tiled('edge mtop', ['so', 'ng', 'nt', 'nr', 'nf', 'nw', 'nx'])
})

/** A trainer's tent, 40 x 28: an A-frame with a lit left face, a shaded right one, an open flap and pegged lines. */
export const tentSvg = () => once('tent', () => {
  const W = 40, H = 28, a = new Art(W, H)
  for (let y = 3; y < 26; y++) {
    const half = Math.round((y - 3) * 0.78)
    for (let x = 20 - half; x <= 19 + half; x++) a.set(x, y, x < 20 ? (x < 20 - half + 2 ? 'tl' : 'tf') : 'td')
  }
  // the flap: a dark door, its edge folded back
  for (let y = 12; y < 26; y++) {
    const h = Math.round((y - 12) * 0.45)
    for (let x = 19 - h; x <= 20 + h; x++) a.set(x, y, 'to')
    a.set(21 + h, y, 'tl')
  }
  a.rect(19, 0, 2, 4, 'tp')
  for (let k = 0; k < 6; k++) { a.set(1 + k, 25 - k * 3, 'tp'); a.set(38 - k, 25 - k * 3, 'tp') }
  a.rect(0, 26, 3, 2, 'tp'); a.rect(37, 26, 3, 2, 'tp')
  return a.svg('tentart', ['tf', 'tl', 'td', 'to', 'tp'])
})

/** The campfire, 20 x 18, in three frames (logs, stones and three flame shapes). */
export const fireSvg = () => once('fire', () => {
  const W = 20, H = 18
  const base = new Art(W, H)
  base.sprite(0, 12, [
    '..o..oo.....oo..o...',
    '.ooLLLLLLLLLLLLLLoo.',
    'oooLLLlLLLLLlLLLLooo',
    '.oooLLLLLLLLLLLLooo.',
    '..oo..o..oo..o..oo..',
    '....................',
  ], { o: 'fs', L: 'fw', l: 'fx' })
  const flames = [
    ['.........y..........', '........yy..........', '.......yyy....y.....', '......yyyyy..yy.....', '.....yyywyyyyyy.....', '.....yywwwyyyyy.....', '....yyywwwwyyyyy....', '....yywwhhwwwyyy....', '...yyywhhhhwwyyyy...', '...yywwhhhhhwwyyy...', '....ywwhhhhhwwyy....', '.....wwwhhhwww......'],
    ['..........y.........', '..........yy........', '....y....yyy........', '....yy..yyyyy.......', '.....yyyyywyyy......', '.....yyyywwwyy......', '....yyyywwwwyyy.....', '....yyywwhhwwyy.....', '...yyyywhhhhwwyyy...', '...yyywwhhhhhwyyy...', '....yywwhhhhhwwy....', '......wwwhhhwww.....'],
    ['........y...........', '.......yy......y....', '.......yyy....yy....', '......yyyy...yyy....', '.....yyywyyyyyyy....', '.....yywwwyyyyy.....', '....yyywwwwwyyyy....', '....yywwwhhwwyyy....', '...yyywwhhhhwyyyy...', '...yywwhhhhhwwyyy...', '....yywhhhhhwwyy....', '.....wwwhhhhww......'],
  ]
  const frames = flames.map((rows, i) => {
    const f = new Art(W, H)
    f.sprite(0, 0, rows, { y: 'f1', w: 'f2', h: 'f3' })
    return `<g class="ff ff${i}">${f.paths(['f1', 'f2', 'f3'])}</g>`
  }).join('')
  return base.svg('fireart', ['fs', 'fw', 'fx'], frames)
})

/** The campfire's ground: a clearing at night with a big rock to catch the shadow. 1000 x 40. */
export const campGroundSvg = () => once('camp', () => {
  const W = 280, H = 40, a = new Art(W, H)
  for (let x = 0; x < W; x++) {
    const t = 20 + Math.round(2 * Math.sin((x / W) * Math.PI * 4) + noise('cg', x >> 3))
    for (let y = t; y < H; y++) a.set(x, y, y < t + 2 ? 'cg' : 'cd')
    if (noise('cgt', x) > 0.6) a.set(x, t - 1, 'cg')
  }
  return a.tiled('edge camp', ['cg', 'cd'], 1120)
})

/** The boulder behind the fire, 80 x 42, where the lead's shadow falls: a lit rim, a body, a darker foot. */
export const rockSvg = () => once('rock', () => {
  const W = 80, H = 42, a = new Art(W, H)
  for (let x = 0; x < W; x++) {
    const t = Math.round(3 + 34 * Math.pow(Math.abs(x - 38) / 40, 3) + noise('rk', x >> 2) * 2)
    for (let y = t; y < H; y++) a.set(x, y, y <= t + 1 ? 'rh' : y > H - 6 ? 'rd' : 'rb')
  }
  // a few cracks
  for (const [x, y, n] of [[52, 14, 5], [22, 22, 4], [60, 28, 3]] as const) for (let i = 0; i < n; i++) a.set(x + (i % 2), y + i, 'rd')
  return a.svg('rockart', ['rb', 'rd', 'rh'])
})

/** The footer's top edge: soil meeting the night ground, with blades. 1000 x 8. */
export const footTopSvg = () => once('foot', () => {
  const W = 200, H = 8, a = new Art(W, H)
  a.rect(0, 0, W, H, 'fo')
  for (let x = 0; x < W; x++) {
    const g = 2 + Math.round(noise('ft', x) * 2)
    for (let y = 0; y < g; y++) a.set(x, y, 'cd')
  }
  return a.tiled('edge foottop', ['fo', 'cd'])
})

/** A place strip for the other pages, 480 x 64: a family place (or the meadow): a far ridge, a hill, grassy ground. */
export const placeStripSvg = () => once('place', () => {
  const W = 480, H = 64, a = new Art(W, H)
  a.columns(x => 30 - 7 * Math.sin(x / 47 + 1) - 4 * Math.sin(x / 19 + 2) - 3 * Math.max(0, 1 - Math.abs(x - 360) / 40) * 3, 'pf', 52)
  a.columns(x => 42 - 5 * Math.max(0, Math.sin(x / 33)) - 3 * Math.sin(x / 13 + 0.5), 'ph', 52)
  for (let x = 0; x < W; x++) {
    const t = 50 - (noise('pgt', x) > 0.55 ? 1 : 0) - (noise('pgu', x) > 0.85 ? 1 : 0)
    for (let y = t; y < H; y++) a.set(x, y, 'pg')
  }
  return a.svg('placeart', ['pf', 'ph', 'pg'])
})
