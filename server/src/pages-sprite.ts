// One SVG builder for every creature on the site, shared by the server and the client bundle. A
// sprite comes out in layers so the page can bring it to life without redrawing it:
//   g.b   the body, with every eye pixel filled by the colour above it (what shows when eyes close)
//   g.e   the eyes alone, which shift a pixel toward the pointer (only by the offsets in data-eo)
//   .ld   closed lids: a dark line along the bottom of each eye, shown while blinking or asleep
//   .fl   a white silhouette, swapped in for the one-frame flash (never a CSS filter)
// The same markup becomes a silhouette (rustles, unfound species, the campfire shadow) by CSS alone.
import { EYE, SHINE } from '../../plugin/hooks/core/sprite.ts'
import type { Pixels } from '../../plugin/hooks/core/sprite.ts'

const T = -1
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0')

/** Horizontal runs of the cells where `on(x, y)` holds, as one path's d. */
export function maskPath(w: number, h: number, on: (x: number, y: number) => boolean): string {
  let d = ''
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w;) {
      if (!on(x, y)) { x++; continue }
      let n = 1
      while (x + n < w && on(x + n, y)) n++
      d += `M${x} ${y}h${n}v1h-${n}z`
      x += n
    }
  }
  return d
}

/** Every opaque pixel as one path per colour. */
export function colourPaths(px: Pixels): string {
  const runs = new Map<number, string>()
  px.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const c = row[x]!
      let n = 1
      while (x + n < row.length && row[x + n] === c) n++
      if (c !== T) runs.set(c, (runs.get(c) ?? '') + `M${x} ${y}h${n}v1h-${n}z`)
      x += n
    }
  })
  return [...runs].map(([c, d]) => `<path fill="${hex(c)}" d="${d}"/>`).join('')
}

export type SpriteLayers = {
  w: number
  h: number
  /** body paths with the eyes filled in */
  body: string
  /** eye paths */
  eyes: string
  /** the lids' path d */
  lids: string
  /** the white silhouette's path d */
  flash: string
  /** allowed eye offsets: any of l r u d */
  eo: string
}

/**
 * Splits a sprite into its layers. Eye pixels are the eye colour and catchlights in the eye rows,
 * plus the rest of each 2x2 eye (a sparkle eye's iris).
 */
export function spriteLayers(px: Pixels): SpriteLayers {
  const h = px.length, w = px[0]?.length ?? 0
  const get = (x: number, y: number) => px[y]?.[x] ?? T
  let top = h
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (get(x, y) === EYE) top = Math.min(top, y)
  const eye = new Set<number>()
  const key = (x: number, y: number) => y * w + x
  if (top < h) {
    for (let y = top; y <= top + 1; y++) for (let x = 0; x < w; x++) {
      const c = get(x, y)
      if (c === EYE || c === SHINE) eye.add(key(x, y))
    }
    // complete 2x2 eyes: the cell under a catchlight's neighbour (a sparkle iris)
    for (let x = 0; x < w; x++) {
      if (get(x, top) !== SHINE) continue
      for (const nx of [x - 1, x + 1]) if (get(nx, top) === EYE && get(nx, top + 1) !== T) eye.add(key(nx, top + 1))
    }
  }
  const isEye = (x: number, y: number) => eye.has(key(x, y))
  const opaque = (x: number, y: number) => get(x, y) !== T
  const fillOf = (x: number, y: number) => {
    for (let yy = y - 1; yy >= 0; yy--) {
      if (!opaque(x, yy)) break
      if (!isEye(x, yy)) return get(x, yy)
    }
    for (const nx of [x - 1, x + 1, x - 2, x + 2]) if (opaque(nx, y) && !isEye(nx, y)) return get(nx, y)
    return get(x, y)
  }
  const bodyPx = px.map((row, y) => row.map((c, x) => (isEye(x, y) ? fillOf(x, y) : c)))
  const eyePx = px.map((row, y) => row.map((c, x) => (isEye(x, y) ? c : T)))
  // lids: the lowest eye pixel of each column
  const lidAt = new Set<number>()
  for (const k of eye) {
    const x = k % w, y = (k - x) / w
    if (!isEye(x, y + 1)) lidAt.add(k)
  }
  const interior = (x: number, y: number) => opaque(x, y) && opaque(x - 1, y) && opaque(x + 1, y) && opaque(x, y - 1) && opaque(x, y + 1)
  const cells = [...eye].map(k => [k % w, Math.floor(k / w)] as const)
  const eo = cells.length
    ? (['l', -1, 0, 'r', 1, 0, 'u', 0, -1, 'd', 0, 1] as const).reduce((s, _, i, a) => {
      if (i % 3) return s
      const [name, dx, dy] = [a[i] as string, a[i + 1] as number, a[i + 2] as number]
      return cells.every(([x, y]) => interior(x + dx, y + dy)) ? s + name : s
    }, '')
    : ''
  return {
    w, h,
    body: colourPaths(bodyPx),
    eyes: colourPaths(eyePx),
    lids: maskPath(w, h, (x, y) => lidAt.has(key(x, y))),
    flash: maskPath(w, h, opaque),
    eo,
  }
}

export type SpriteSvgOptions = {
  cls?: string
  /** an accessible name; without one the art is decorative */
  label?: string
  /** CSS px per sprite pixel for the width/height attributes (CSS usually sizes it) */
  scale?: number
  /** false leaves out the white flash silhouette, for art that never flashes (the album) */
  flash?: boolean
}

/** A creature as layered inline SVG (see the file comment). */
export function spriteSvg(px: Pixels, o: SpriteSvgOptions = {}): string {
  const l = spriteLayers(px)
  const s = o.scale ?? 4
  const a11y = o.label ? `role="img" aria-label="${o.label.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)}"` : 'aria-hidden="true" focusable="false"'
  return `<svg class="spr${o.cls ? ' ' + o.cls : ''}" viewBox="0 0 ${l.w} ${l.h}" width="${l.w * s}" height="${l.h * s}" shape-rendering="crispEdges" data-eo="${l.eo}" ${a11y}>`
    + `<g class="b">${l.body}</g><g class="e">${l.eyes}</g><path class="ld" fill="#1d1726" d="${l.lids}"/>${o.flash === false ? '' : `<path class="fl" fill="#fffdf5" d="${l.flash}"/>`}</svg>`
}

/** A plain silhouette in currentColor (no layers): scenery shadows and card backs. */
export function shadowSvg(px: Pixels, cls = 'shd'): string {
  const h = px.length, w = px[0]?.length ?? 0
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path fill="currentColor" d="${maskPath(w, h, (x, y) => (px[y]?.[x] ?? T) !== T)}"/></svg>`
}
