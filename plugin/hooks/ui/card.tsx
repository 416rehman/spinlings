// The one card component (SPEC 21), every size the pane draws: full (card detail, reveals), tile (grids, the team,
// summaries), mini (pickers, offers: the 8x8 art) and row (narrow lists: the mini beside its words). The band draws its
// own battle minis from client/battleview.ts. Terminal art is one keyed Raster: the 16x16 sprite in half blocks inside
// a one-cell frame drawn with box characters, so the ceremonies can blit the foil sweep and the cycling rainbow border
// without a render pass. Desktop art is one Svg with the same frame, a rainbow gradient border for foil, and an
// animated sheen while motion is on. Text rows sit below or beside the art, one row each, in the same order everywhere.
import type { RenderElement } from 'claude-code'
import type { Card, Family, Form } from '../core/types.ts'
import { cardName, geneScore, xpToNext } from '../core/cards.ts'
import { ECONOMY } from '../core/economy.ts'
import { FAMILY_INFO } from '../core/families.ts'
import { isFinalForm } from '../core/species.ts'
import { TRAITS } from '../core/traits.ts'
import { miniSprite, silhouette, spriteFor } from '../core/sprite.ts'
import type { Pixels, SpriteSource } from '../core/sprite.ts'
import { DEFAULT_COLOR, T, encodeGrid, grid, putPixels } from '../client/anim.ts'
import type { El, Surface } from '../client/types.ts'
import { bar, cells, dots, fit, safe, span } from '../client/text.ts'
import {
  ART, FAMILY_COLOR, FAMILY_MARK, FOIL_STEP, INK, MARK, MYTHIC_COLOR, RAINBOW_STOPS, RARITY_COLOR, RARITY_INITIAL, RARITY_WORD,
  SPACE, SPRITE, SVG_SCALE, hex6, hexInt, hslInt, pixelRects,
} from './tokens.ts'

export type CardSize = 'full' | 'tile' | 'mini' | 'row'

/**
 * Cells across a tile and a mini; a row and a full card take what they are given. A mini is wide enough for `1: ` and
 * any one-word name, so a picker's hotkey never cuts a name.
 */
export const CARD_WIDTH = { tile: ART.columns, mini: 14 } as const

/** How a pressable card answers the pointer anywhere over it: its name lights up, so the whole card reads as one control. */
const LIT = { bold: true, underline: true } as const

/** The mark a picked card's name carries. */
const CHECK = '✓'

/** Anything shown as a card: your own (Card) or another player's or a wild one (a battle card, no ownership fields). */
export type CardFace = Pick<Card,
  'id' | 'species' | 'form' | 'season' | 'family' | 'rarity' | 'shiny' | 'foil' | 'dna' | 'genes' | 'traits' | 'level'
  | 'stage' | 'raisedIn' | 'stats' | 'firstFind'>
  & Partial<Pick<Card, 'xp' | 'origin' | 'bound' | 'forTrade' | 'state' | 'lockedUntil' | 'tiredUntil'>>

export type CardOptions = {
  /** unique within the tree; the art's Raster key is `${key}-art` (what blit names) */
  key: string
  /** cells across: the full card's text column, a row's */
  width?: number
  /** an unseen creature: its silhouette (album, rustle) */
  ghost?: boolean
  /** desktop: the foil sheen and the border animate (SMIL) while motion is on */
  motion?: boolean
  /** the offline world: a Mythic reads "Local mythic" and claims no 1 of 1 (SPEC 28) */
  offline?: boolean
  /** for "resting" and trade-lock lines (server time) */
  now?: number
  /** tile, mini and row: pressing the name does this */
  on?: () => unknown
  hotkey?: string | undefined
  /** drawn as the picked one: a tick before the name */
  selected?: boolean
  dimmed?: boolean
  /** one dim line under the marks (a slot, a handle, NEW) */
  note?: string
  /** a row of the caller's under the marks: a listing's price chip and the card it wants */
  extra?: RenderElement | null
}

// ---------- words ----------

export const isMythic = (c: Pick<CardFace, 'species'>) => c.species === 'mythic'

export function rarityColor(c: Pick<CardFace, 'species' | 'rarity'>): string {
  return isMythic(c) ? MYTHIC_COLOR : RARITY_COLOR[c.rarity]
}

/** `Rare`, `Rare · Foil`, `Rare · Shiny Foil`, `Mythic · Foil` (SPEC 14). */
export function rarityLabel(c: Pick<CardFace, 'species' | 'rarity' | 'shiny' | 'foil'>): string {
  const word = isMythic(c) ? 'Mythic' : RARITY_WORD[c.rarity]
  const finish = c.shiny && c.foil ? 'Shiny Foil' : c.shiny ? 'Shiny' : c.foil ? 'Foil' : ''
  return dots(word, finish)
}

export function rarityInitial(c: Pick<CardFace, 'species' | 'rarity'>): string {
  return isMythic(c) ? 'M' : RARITY_INITIAL[c.rarity]
}

/** The name at the card's stage; '?' for a species this mod cannot read yet (a season the server has not sent). */
export function displayName(c: Pick<CardFace, 'species' | 'form' | 'stage'>, max = 24): string {
  try {
    return safe(cardName(c), max)
  } catch {
    return '?'
  }
}

function finalForm(c: Pick<CardFace, 'species' | 'form'>): boolean {
  try {
    return isFinalForm(c)
  } catch {
    return false
  }
}

/** The stamps a card carries, in their fixed order (SPEC 21: same marks, same order, everywhere). */
export function stamps(c: CardFace, o: { offline?: boolean } = {}): string[] {
  const out: string[] = []
  if (c.firstFind) out.push(`${MARK.first} First Discovered`)
  if (isMythic(c)) out.push(o.offline ? `${MARK.mythic} Local mythic` : `${MARK.mythic} Mythic · 1 of 1`)
  if (isMythic(c) && c.form?.discoveredBy && !o.offline) out.push(`Discovered by ${safe(c.form.discoveredBy, 40)}`)
  if (c.form?.kind === 'promo' && c.form.stamp) out.push(safe(c.form.stamp, 40))
  if (c.raisedIn && c.stage > 1) out.push(`Raised under ${FAMILY_INFO[c.raisedIn].name}`)
  if (finalForm(c)) out.push('Final form')
  return out
}

const ORIGIN: Record<string, string> = {
  starter: 'Your starter', pack: 'From a pack', catch: 'Caught in the wild', bounty: 'A duel bounty', craft: 'Crafted',
  fusion: 'Fused', gift: 'A gift', daily: 'A daily first win', trader: 'From the Wandering Trader', promo: 'From a drop',
  season: 'A season reward',
}

export function originLine(c: CardFace): string {
  return c.origin ? ORIGIN[c.origin] ?? '' : ''
}

/** Plain-word state of one of your cards: resting, held (a trade, a gift or the market), bound (SPEC 21.5). */
export function stateLine(c: CardFace, now: number | undefined): string {
  if (c.state === 'escrow') return 'Held for a trade or sale'
  if (now !== undefined && c.tiredUntil !== undefined && c.tiredUntil > now) return `Resting · ${span(c.tiredUntil - now)}`
  if (c.bound) return 'Stays with you'
  return c.forTrade ? 'Marked for trade' : ''
}

/**
 * A name split to fit `room` cells without cutting it: the words that fit on the first line, and the rest for a
 * wrapping line below. Only a single word longer than the room is cut, and then the whole name follows below.
 */
export function splitName(text: string, room: number): [string, string] {
  if (cells(text) <= room) return [text, '']
  const words = text.split(' ')
  let first = ''
  for (const w of words) {
    const next = first ? `${first} ${w}` : w
    if (cells(next) > room) break
    first = next
  }
  if (!first) return [fit(text, room), text]
  return [first, text.slice(first.length).trim()]
}

// ---------- art ----------

/** The frame around terminal art: a rarity colour, the rainbow for foil (and every Mythic), a sparkle corner for shiny. */
export type Frame = { color: number; rainbow: boolean; sparkle: boolean }

export function frameOf(c: Pick<CardFace, 'species' | 'rarity' | 'shiny' | 'foil'>, ghost = false): Frame {
  if (ghost) return { color: hexInt(INK.muted), rainbow: false, sparkle: false }
  return { color: hexInt(rarityColor(c)), rainbow: !!c.foil || isMythic(c), sparkle: c.shiny }
}

const BOX = { tl: 0x256d, tr: 0x256e, bl: 0x2570, br: 0x256f, h: 0x2500, v: 0x2502, star: 0x2726 } as const

const pixelCache = new Map<string, Pixels>()

function artKey(c: CardFace, mini: boolean, ghost: boolean): string {
  const f = c.form
  const formKey = f ? `${f.kind}:${f.seed ?? ''}:${f.parents?.join('+') ?? ''}:${f.names[0]}:${f.hue}:${f.body}` : ''
  return `${c.species}|${formKey}|${c.dna}|${c.stage}|${c.shiny ? 1 : 0}|${c.rarity}|${c.raisedIn ?? ''}|${mini ? 'm' : 'c'}|${ghost ? 'g' : ''}`
}

const clear = () => Array.from({ length: SPRITE.card.px }, () => Array.from({ length: SPRITE.card.px }, () => T))

/** The card's sprite pixels: 16x16, or the 8x8 mini; a silhouette when ghosted. Cached: sprites are deterministic. */
export function artPixels(c: CardFace, mini = false, ghost = false): Pixels {
  const key = artKey(c, mini, ghost)
  let px = pixelCache.get(key)
  if (!px) {
    try {
      px = spriteFor(c as SpriteSource)
    } catch {
      px = clear()
    }
    if (ghost) px = silhouette(px)
    if (mini) px = miniSprite(px)
    if (pixelCache.size >= 400) pixelCache.clear()
    pixelCache.set(key, px)
  }
  return px
}

/** Clockwise position of a frame cell, for the rainbow's hue. */
function ringIndex(x: number, y: number, w: number, h: number): number {
  if (y === 0) return x
  if (x === w - 1) return w - 1 + y
  if (y === h - 1) return w - 1 + h - 1 + (w - 1 - x)
  return 2 * (w - 1) + h - 1 + (h - 1 - y)
}

/**
 * Raster cells for a card's art: an unframed mini (8 x 4 cells), or the framed card (18 x 10). `t` (seconds) turns
 * the foil rainbow; the ceremonies call this per frame with their own pixels and blit the result.
 */
export function artCells(px: Pixels, frame: Frame | null, t = 0): { columns: number; rows: number; cells: string } {
  const w = px[0]?.length ?? 0, spriteRows = Math.ceil(px.length / 2)
  const pad = frame ? 1 : 0
  const g = grid(w + 2 * pad, spriteRows + 2 * pad)
  putPixels(g, px, pad, pad)
  if (frame) {
    const { columns, rows } = g
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const edgeX = x === 0 || x === columns - 1, edgeY = y === 0 || y === rows - 1
      if (!edgeX && !edgeY) continue
      const i = y * columns + x
      g.cp[i] = y === 0 && x === 0 ? BOX.tl
        : y === 0 && x === columns - 1 ? (frame.sparkle ? BOX.star : BOX.tr)
        : y === rows - 1 && x === 0 ? BOX.bl
        : y === rows - 1 && x === columns - 1 ? BOX.br
        : edgeY ? BOX.h : BOX.v
      g.fg[i] = frame.rainbow ? hslInt(ringIndex(x, y, columns, rows) * FOIL_STEP + t * 90, 0.8, 0.62) : frame.color
      g.bg[i] = DEFAULT_COLOR
    }
  }
  return { columns: g.columns, rows: g.rows, cells: encodeGrid(g) }
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The desktop art: the same frame as the terminal's, a rainbow gradient for foil, and the sheen while motion is on.
 * `title` (the card's full name and rarity) is the art's tooltip wherever the surface draws it live.
 */
export function artSvg(px: Pixels, frame: Frame | null, scale: number, motion: boolean, title = ''): string {
  const n = px.length
  const pad = frame ? 1 : 0
  const size = n + pad * 2
  const body = pixelRects(px, 1, pad, pad)
  let defs = ''
  let border = ''
  let sheen = ''
  if (frame) {
    const stroke = frame.rainbow ? 'url(#rb)' : hex6(frame.color)
    if (frame.rainbow) {
      const spin = motion ? `<animateTransform attributeName="gradientTransform" type="rotate" from="0 ${size / 2} ${size / 2}" to="360 ${size / 2} ${size / 2}" dur="2.4s" repeatCount="indefinite"/>` : ''
      defs += `<linearGradient id="rb" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${size}" y2="${size}">${RAINBOW_STOPS}${spin}</linearGradient>`
      const sweep = motion ? `<animateTransform attributeName="gradientTransform" type="translate" from="-${size} 0" to="${size} 0" dur="2.4s" repeatCount="indefinite"/>` : ''
      defs += `<linearGradient id="sh" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${size}" y2="${size}">`
        + `<stop offset="0.35" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.5" stop-color="#ff9df0"/>`
        + `<stop offset="0.55" stop-color="#9df6ff"/><stop offset="0.7" stop-color="#ffffff" stop-opacity="0"/>${sweep}</linearGradient>`
      defs += `<mask id="m"><g fill="#fff">${pixelRects(px, 1, pad, pad, '#ffffff')}</g></mask>`
      if (motion) sheen = `<rect x="${pad}" y="${pad}" width="${n}" height="${n}" fill="url(#sh)" mask="url(#m)" opacity="0.4" style="mix-blend-mode:color-dodge"/>`
    }
    border = `<rect x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" rx="1.5" fill="none" stroke="${stroke}" stroke-width="1"/>`
    if (frame.sparkle) border += `<path d="M${size - 1.5} 0.2 L${size - 1.1} 1.1 L${size - 0.2} 1.5 L${size - 1.1} 1.9 L${size - 1.5} 2.8 L${size - 1.9} 1.9 L${size - 2.8} 1.5 L${size - 1.9} 1.1 Z" fill="#fff4c2"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * scale}" height="${size * scale}" shape-rendering="crispEdges">`
    + (title ? `<title>${xml(title)}</title>` : '') + (defs ? `<defs>${defs}</defs>` : '') + body + sheen + border + '</svg>'
}

const svgCache = new Map<string, string>()

function artElement(el: El, surface: Surface, key: string, cacheKey: string, px: Pixels, frame: Frame | null, scale: number, motion: boolean, alt: string): RenderElement {
  if (surface === 'terminal') {
    const r = artCells(px, frame)
    return <el.Raster key={`${key}-art`} columns={r.columns} rows={r.rows} cells={r.cells} />
  }
  const animate = motion && !!frame?.rainbow
  const k = `${cacheKey}|${scale}|${animate ? 1 : 0}|${frame ? frame.color + (frame.rainbow ? 'r' : '') + (frame.sparkle ? 's' : '') : '-'}`
  let svg = svgCache.get(k)
  if (!svg) {
    svg = artSvg(px, frame, scale, animate, alt)
    if (svgCache.size >= 400) svgCache.clear()
    svgCache.set(k, svg)
  }
  const side = (px.length + (frame ? 2 : 0)) * scale
  return <el.Svg source={svg} alt={alt} width={side} height={side} isInteractive={animate} />
}

/** A card's art as an element: the keyed Raster on the terminal, the Svg elsewhere. Tiles and full cards are framed. */
export function art(el: El, surface: Surface, c: CardFace, size: CardSize, o: Pick<CardOptions, 'key' | 'ghost' | 'motion'>): RenderElement {
  const mini = size === 'mini' || size === 'row'
  const ghost = !!o.ghost
  const alt = ghost ? 'an unseen creature' : `${displayName(c)}, ${FAMILY_INFO[c.family].name}, ${rarityLabel(c)}, level ${c.level}`
  return artElement(el, surface, o.key, artKey(c, mini, ghost), artPixels(c, mini, ghost), mini ? null : frameOf(c, ghost),
    SVG_SCALE[mini ? 'mini' : size === 'tile' ? 'tile' : 'full'], !!o.motion, alt)
}

const formCache = new Map<string, Pixels>()

/**
 * A species (or any form) as an album entry: its plain look at a stage, framed like a common tile, or as a mini; its
 * silhouette while unseen. A legendary shows its one final form.
 */
export function formArt(el: El, surface: Surface, key: string, form: Form & { id?: string }, seen: boolean, stage: 1 | 2 | 3 = 1, size: 'tile' | 'mini' = 'tile'): RenderElement {
  const at = form.legendary ? 3 : stage
  const ck = `form|${form.id ?? form.names[0]}|${form.hue}|${form.body}|${at}|${seen ? 1 : 0}|${size}`
  let px = formCache.get(ck)
  if (!px) {
    try {
      px = spriteFor({ form, stage: at })
    } catch {
      px = clear()
    }
    if (!seen) px = silhouette(px)
    if (size === 'mini') px = miniSprite(px)
    if (formCache.size >= 400) formCache.clear()
    formCache.set(ck, px)
  }
  const frame: Frame | null = size === 'mini' ? null
    : { color: hexInt(seen ? RARITY_COLOR[form.legendary ? 'legendary' : 'common'] : INK.muted), rainbow: false, sparkle: false }
  return artElement(el, surface, key, ck, px, frame, SVG_SCALE[size], false, seen ? safe(form.names[at - 1], 24) : 'an unseen creature')
}

// ---------- the card ----------

const familyMark = (el: El, f: Family) => <el.Text color={FAMILY_COLOR[f]}>{FAMILY_MARK[f]}</el.Text>

/** The one card, at any size. The same card always shows the same colours, marks and order. */
export function card(el: El, surface: Surface, c: CardFace, size: CardSize, o: CardOptions): RenderElement {
  if (size === 'full') return full(el, surface, c, o)
  const { Box, Text } = el
  const width = size === 'tile' ? CARD_WIDTH.tile : size === 'mini' ? CARD_WIDTH.mini : Math.max(10, (o.width ?? 40) - SPRITE.mini.columns - SPACE.loose)
  const words = [
    ...name(el, c, width, o),
    meta(el, c, width),
    o.extra ?? null,
    // a note (a slot, a handle) wraps rather than cut: it may be the only place a seller's handle shows
    (size === 'tile' ? o.note !== undefined : !!o.note) ? <Text dimColor wrap="wrap">{o.note || ' '}</Text> : null,
  ].filter((x): x is RenderElement => !!x)
  // a pressable card is one hover scope (its keyed Box): the pointer anywhere over its art or words lights its name
  if (size === 'row') {
    return (
      <Box key={o.key} flexDirection="row" columnGap={SPACE.loose} width={o.width ?? 40}>
        <Box flexShrink={0}>{art(el, surface, c, size, o)}</Box>
        <Box flexDirection="column" width={width}>{...words}</Box>
      </Box>
    )
  }
  return (
    <Box key={o.key} flexDirection="column" width={width} flexShrink={0}>
      {art(el, surface, c, size, o)}
      {...words}
    </Box>
  )
}

/**
 * The name: plain, or the button that opens or picks the card (a tick when picked), lit while the pointer is anywhere
 * over the card. Never cut: what does not fit the column goes on a line of its own below.
 */
function name(el: El, c: CardFace, width: number, o: CardOptions): RenderElement[] {
  const text = o.ghost ? '???' : displayName(c, 32)
  const room = Math.max(3, width - (o.on && o.hotkey ? 3 : 0) - (o.selected ? 2 : 0))
  const [first, rest] = splitName(text, room)
  const more = rest ? <el.Text wrap="wrap" {...(o.dimmed ? { dimColor: true } : {})}>{rest}</el.Text> : null
  if (!o.on) return [<el.Text wrap="truncate-end">{first}</el.Text>, ...(more ? [more] : [])]
  const label = (o.selected ? `${CHECK} ` : '') + first
  const on = o.on
  const extra = { ...(o.hotkey ? { hotkey: o.hotkey } : {}), ...(o.dimmed ? { dimColor: true } : {}) }
  return [<el.Button key={`${o.key}-pick`} label={label} plain {...extra} hover={LIT} onPress={() => { void on() }} />, ...(more ? [more] : [])]
}

/**
 * The family and level, then the full rarity and finish words: readable without knowing a colour or a glyph.
 */
function meta(el: El, c: CardFace, width: number): RenderElement {
  const { Box, Text } = el
  return (
    <Box flexDirection="column" width={width}>
      <Text wrap="wrap">{familyMark(el, c.family)}<Text>{` ${FAMILY_INFO[c.family].name}`}</Text><Text dimColor>{` · Lv ${c.level}`}</Text></Text>
      <Text wrap="wrap" color={rarityColor(c)}>{rarityLabel(c)}</Text>
    </Box>
  )
}

function full(el: El, surface: Surface, c: CardFace, o: CardOptions): RenderElement {
  const { Box, Text } = el
  const total = o.width ?? 60
  const beside = total >= ART.columns + SPACE.loose + 26
  const w = beside ? total - ART.columns - SPACE.loose : total
  const lv = c.level >= ECONOMY.levels.max ? 'max' : bar((c.xp ?? 0) / xpToNext(c.level), 6)
  const genes = geneScore(c.genes)
  const s = c.stats
  const lines: RenderElement[] = [
    <Text bold wrap="wrap">{o.ghost ? '???' : displayName(c, 32)}</Text>,
    <Text wrap="truncate-end" color={rarityColor(c)}>{fit(rarityLabel(c), w)}</Text>,
    <Text wrap="truncate-end">
      {familyMark(el, c.family)}
      <Text>{` ${FAMILY_INFO[c.family].name} · Lv ${c.level} `}</Text>
      <Text dimColor>{lv}</Text>
    </Text>,
    <Text wrap="truncate-end">
      <Text dimColor>Genes </Text>
      <Text>{bar(genes / 100, 8)}</Text>
      <Text>{` ${genes}%`}</Text>
    </Text>,
    <Text wrap="truncate-end" dimColor>{fit(`HP ${s.hp} · Atk ${s.atk} · Def ${s.def} · Spd ${s.spd}`, w)}</Text>,
  ]
  for (const t of c.traits) {
    const info = (TRAITS as Record<string, { name: string; text: string } | undefined>)[t]
    // the card page is where every word shows whole: traits and stamps wrap rather than cut
    lines.push(
      <Text wrap="wrap">
        <Text>{info ? info.name : safe(t, 24)}</Text>
        {info ? <Text dimColor>{`  ${info.text}`}</Text> : ''}
      </Text>,
    )
  }
  const marks = stamps(c, o)
  if (marks.length > 0) lines.push(<Text wrap="wrap" color={INK.accent}>{marks.join(' · ')}</Text>)
  const origin = originLine(c)
  const state = stateLine(c, o.now)
  if (origin || state) lines.push(<Text wrap="wrap" dimColor>{dots(origin, state)}</Text>)
  return (
    <Box key={o.key} flexDirection={beside ? 'row' : 'column'} columnGap={SPACE.loose} rowGap={beside ? SPACE.none : SPACE.tight}>
      <Box flexShrink={0}>{art(el, surface, c, 'full', o)}</Box>
      <Box flexDirection="column" width={w} flexShrink={1}>{...lines}</Box>
    </Box>
  )
}
