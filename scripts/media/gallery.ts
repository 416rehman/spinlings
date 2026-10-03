// Poster (d): season 1, held back. The 36 species the way the album shows one you have not met (card.tsx: the art in
// a muted frame, the name ???), each a shadow from the band's own rustle (shadows.ts), four families of eight and a
// legendary rimmed in gold. Nothing names them, colours them or shows a later stage. One at a time, a shadow stirs,
// opens its eyes, glances aside, blinks and goes still again, and the legendaries' gold rims breathe. One loop.
import type { Family, Species } from '../../plugin/hooks/core/types.ts'
import type { Pixels } from '../../plugin/hooks/core/sprite.ts'
import { FAMILIES, FAMILY_INFO } from '../../plugin/hooks/core/families.ts'
import { familySpecies } from '../../plugin/hooks/core/species.ts'
import { FAMILY_COLOR, FAMILY_MARK, INK, RARITY_COLOR, hexInt } from '../../plugin/hooks/ui/tokens.ts'
import { pixelTextSvg } from '../../server/src/pages-art.ts'
import { compact } from './clock.ts'
import { doc } from './desk.ts'
import { albumForm, eyes, glances, shadow } from './shadows.ts'
import type { Theme } from './view.ts'
import { MONO, embed } from './view.ts'

const { artSvg } = await import('../../plugin/hooks/ui/card.tsx')

const SEASON = 1
const SCALE = 4
const TILE = 18 * SCALE
const GAP = 16
const COL = TILE + GAP
const MARGIN = 36
const ROW = TILE + 72
const TOP = 214
export const POSTER = { w: MARGIN * 2 + 9 * COL - GAP, h: TOP + 4 * ROW - 22 }

/** One shadow stirs per beat, in this order (family, index), wandering about the poster. */
const PEEKS: [Family, number][] = [
  ['sonnet', 2], ['opus', 6], ['haiku', 4], ['fable', 1], ['opus', 0], ['haiku', 7], ['fable', 5], ['sonnet', 6],
]
const BEAT = 4000
const LOOP = BEAT * PEEKS.length
/** Within a beat (ms): a burst of wobble, then the eyes open, glance aside and back, blink, and close. */
const PEEK = { start: 200, open: 1100, glance: 1700, back: 2200, blink: 2550, reopen: 2700, close: 3500 }
const WOBBLE = [-1, 0, 1, 0, -1, 0]
const WOBBLE_STEP = 130
const GLOW = hexInt(INK.bright)
/** The gold rims breathe on their own slower beat, each a little after the one above. */
const BREATH = 4000

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const sec = (ms: number) => `${ms / 1000}s`
/** Gold words: the rarity colour, a shade deeper on a light page so they still read. */
const goldInk = (t: Theme) => (t.name === 'light' ? '#8c6823' : RARITY_COLOR.legendary)
/** Family words: the family colour, deepened on a light page to read at AA (each keeps its hue). */
const familyInk = (f: Family, t: Theme) => (t.name === 'light' ? { haiku: '#3d7a5c', sonnet: '#476eba', opus: '#ac563a', fable: '#855cb7' }[f] : FAMILY_COLOR[f])
const blank = (): Pixels => Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => -1))

/** A discrete animation over the loop: values[i] from at[i] ms on (at[0] is 0). */
function steps(values: string[], at: number[], attr: 'visibility' | 'translate'): string {
  const head = attr === 'translate' ? '<animateTransform attributeName="transform" type="translate"' : `<animate attributeName="${attr}"`
  return `${head} values="${values.join(';')}" keyTimes="${at.map(ms => +(ms / LOOP).toFixed(5)).join(';')}" calcMode="discrete" dur="${sec(LOOP)}" repeatCount="indefinite"/>`
}

/** Pixels as the mod's own Svg rects, in sprite units. */
function rects(px: Pixels): string {
  const art = artSvg(px, null, 1, false)
  return art.slice(art.indexOf('>') + 1, -'</svg>'.length)
}

/** The shadow inside its frame; the one stirring on `beat` wobbles and opens its eyes. */
function creature(s: Species, x: number, y: number, beat: number | null): string {
  const px = albumForm(s)
  const dim = shadow(px, !!s.legendary)
  let inner = rects(dim)
  if (s.legendary) {
    // the rim at the top of its pulse, fading in over the dim one and out again
    const bright = shadow(px, true, true).map((row, yy) => row.map((c, xx) => (c === dim[yy]![xx] ? -1 : c)))
    const a = FAMILIES.indexOf(s.family) * 0.125
    inner += `<g opacity="0">${rects(bright)}<animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;${a};${a + 0.25};${a + 0.5};1" dur="${sec(BREATH)}" repeatCount="indefinite"/></g>`
  }
  if (beat !== null) {
    const t0 = beat * BEAT
    const eo = glances(px)
    const way = eo.includes('l') ? -1 : eo.includes('r') ? 1 : 0
    const look = way ? steps(['0 0', `${way} 0`, '0 0'], [0, t0 + PEEK.glance, t0 + PEEK.back], 'translate') : ''
    const open = steps(['hidden', 'visible', 'hidden', 'visible', 'hidden'], [0, t0 + PEEK.open, t0 + PEEK.blink, t0 + PEEK.reopen, t0 + PEEK.close], 'visibility')
    inner += `<g visibility="hidden">${open}<g>${look}${rects(eyes(px, GLOW))}</g></g>`
    const wobble = steps(['0 0', ...WOBBLE.map(d => `${d} 0`)], [0, ...WOBBLE.map((_, i) => t0 + PEEK.start + i * WOBBLE_STEP)], 'translate')
    inner = `<g>${wobble}${inner}</g>`
  }
  return `<g transform="translate(${x + SCALE} ${y + SCALE}) scale(${SCALE})" shape-rendering="crispEdges">${inner}</g>`
}

function tile(s: Species, x: number, y: number, t: Theme, beat: number | null): string {
  const gold = !!s.legendary
  const frame = artSvg(blank(), { color: hexInt(gold ? RARITY_COLOR.legendary : INK.muted), rainbow: false, sparkle: false }, SCALE, false)
  // the frame over the creature, so a shadow that wobbles at its edge stays inside it
  return creature(s, x, y, beat) + embed(frame, x, y, TILE, TILE)
    + `<text x="${x + TILE / 2}" y="${y + TILE + 22}" text-anchor="middle" font-size="12" font-weight="700" fill="${gold ? goldInk(t) : t.dim}">???</text>`
}

function familyRow(f: Family, y: number, t: Theme): string {
  const info = FAMILY_INFO[f]
  const label = `<text x="${MARGIN}" y="${y - 12}" font-size="13" font-weight="700"><tspan fill="${familyInk(f, t)}">${FAMILY_MARK[f]} ${info.name}</tspan>`
    + `<tspan fill="${t.dim}" font-weight="400">  ${esc(info.special[0]!.toUpperCase() + info.special.slice(1))} · beats ${FAMILY_INFO[info.beats].name}</tspan></text>`
  return label + familySpecies(SEASON, f).map((s, i) => {
    const beat = PEEKS.findIndex(([pf, pi]) => pf === f && pi === i)
    return tile(s, MARGIN + i * COL, y, t, beat < 0 ? null : beat)
  }).join('')
}

export function gallerySvg(t: Theme): string {
  const { w, h } = POSTER
  const mark = pixelTextSvg('spinlings', { scale: 4 }).replace(/currentColor/g, t.text)
  let body = `<rect width="${w}" height="${h}" rx="14" fill="${t.bg}"/>`
  body += embed(mark.replace(/^<svg[^>]*?(viewBox="[^"]+")[^>]*>/, '<svg $1 shape-rendering="crispEdges">'), MARGIN, 34, Number(/width="(\d+)"/.exec(mark)![1]), Number(/height="(\d+)"/.exec(mark)![1]))
  body += `<text x="${MARGIN}" y="106" font-size="20" font-weight="700" fill="${t.text}">36 new species hide in every season.</text>`
  body += `<text x="${MARGIN}" y="134" font-size="13" fill="${t.dim}">Each one stays a shadow in your album until you meet it.</text>`
  body += `<text x="${MARGIN}" y="154" font-size="13" fill="${t.dim}">Find one before anyone else and it keeps a First Discovered stamp for good.</text>`
  body += `<text x="${MARGIN + 8 * COL + TILE / 2}" y="${TOP - 12}" text-anchor="middle" font-size="11" font-weight="700" fill="${goldInk(t)}">Legendary</text>`
  FAMILIES.forEach((f, i) => { body += familyRow(f, TOP + i * ROW, t) })
  return doc(w, h, t, `<g font-family="${MONO}">${compact(body)}</g>`, `Spinlings season ${SEASON}: 36 species as shadows, four families of eight and a legendary`)
}
