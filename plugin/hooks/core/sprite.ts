// Procedural pixel creatures assembled from parts (parts.ts): a mirrored 16x16 sprite with a little controlled
// asymmetry, coloured and dressed by the card's look. Pure and synchronous, so the mod, the server and the
// tests all draw the same creature.
import type { Accessory, Body, Card, CardForm, CardStage, Family, Form, Rarity, Rng, Trinket } from './types.ts'
import { formLook, look as cardLook } from './cards.ts'
import type { Look } from './cards.ts'
import { FAMILY_INFO, clampHue, hueAt, hueSpan } from './families.ts'
import { exalt, grow, hybrid, partsFor } from './parts.ts'
import type { Ears, Head, Legs, Parts, Tail, Wings } from './parts.ts'
import { hashString, rngFromSeed } from './rng.ts'
import { BODIES, formOf, getSpecies } from './species.ts'

/** [y][x] = 0xRRGGBB, or -1 for transparent. */
export type Pixels = number[][]

export const SIZE = 16
const T = -1
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

/** The six torso archetypes every creature is built on. */
export const BODY_NAMES: readonly Body[] = BODIES

// ---------- colour ----------

function hsl(h: number, s: number, l: number): number {
  h = ((h % 360) + 360) % 360
  s = Math.max(0, Math.min(1, s))
  l = Math.max(0, Math.min(1, l))
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const to = (v: number) => Math.round((v + m) * 255)
  return (to(r) << 16) | (to(g) << 8) | to(b)
}

const mix = (a: number, b: number, t: number) => {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/** Moves hue `h` up to `amount` degrees toward `target` along the short way round. */
function toward(h: number, target: number, amount: number): number {
  const d = ((target - h + 540) % 360) - 180
  return h + Math.sign(d) * Math.min(Math.abs(d), amount)
}

const hueGap = (a: number, b: number) => Math.abs(((b - a + 540) % 360) - 180)

// Each family's hue range is drawn inside a narrower band, so on screen the families stay at least 35 degrees apart.
const BAND: Record<Family, readonly [number, number]> = { haiku: [92, 150], sonnet: [196, 234], opus: [358, 32], fable: [270, 308] }

const bandHue = (family: Family, t: number) => {
  const [a, b] = BAND[family]
  return (a + t * ((b - a + 360) % 360)) % 360
}

/** Where a hue sits in its family's range, 0..1. */
function rangePos(family: Family, hue: number): number {
  const span = hueSpan(family)
  const off = (((clampHue(family, hue) - FAMILY_INFO[family].hue[0]) % 360) + 360) % 360
  return span ? Math.min(1, off / span) : 0.5
}

/**
 * The hue a body is drawn in: its place in the family's range, mapped into the family's band. A shiny moves half
 * the band away, so it stands out and still reads as its family.
 */
export function bodyHue(family: Family, hue: number, shiny = false): number {
  const t = rangePos(family, hue)
  return bandHue(family, shiny ? (t + 0.5) % 1 : t)
}

// accent: hue from, hue span, saturation, lightness
type Style = { sat: number; light: number; accent: readonly [number, number, number, number] }

const STYLE: Record<Family, Style> = {
  haiku: { sat: 0.48, light: 0.58, accent: [335, 40, 0.62, 0.72] },
  sonnet: { sat: 0.5, light: 0.58, accent: [38, 18, 0.8, 0.62] },
  opus: { sat: 0.6, light: 0.56, accent: [44, 12, 0.75, 0.6] },
  fable: { sat: 0.42, light: 0.6, accent: [150, 40, 0.5, 0.64] },
}

type Material = readonly [number, number, number, number]
// Accessory materials by raising family: main, dark, tip, gem. Each family's gem is its complement.
const MATERIAL: Record<Family, Material> = {
  haiku: [0xeea3c0, 0xb35d86, 0xffe58f, 0xd8344f],
  sonnet: [0xbfd0ee, 0x6f88bd, 0xf4f8ff, 0xf2a531],
  opus: [0xe0a640, 0x985a18, 0xffd27a, 0x3f6fe0],
  fable: [0xcdbcf2, 0x8b76c4, 0xfff1b8, 0xf2c445],
}
const GOLD = 0xf2c445, GOLD_DARK = 0xb5821c, GOLD_LIGHT = 0xfff0a8
const SILVER: Material = [0xc9d3e3, 0x7f8aa3, 0xf5f8ff, 0x58c4f0]

export const EYE = 0x1d1726
export const SHINE = 0xfffdf5
/** the heart of a shiny's twinkle */
export const SPARK = 0xfffbe6
/** the sparkles that keep a Mythic company */
export const MOTE_A = 0xd8fbff, MOTE_B = 0xf6dcff
const BLUSH = 0xf08aa0
const MOUTH = 0x76263a, LIPS = 0x2b1a2a
const HAT = 0x5a5470, HAT_SHINE = 0x8a84a0, BAND_RED = 0xd8475e, SCARF_DARK = 0xa8324a
const BOW = 0xe2506a, BOW_DARK = 0xa32e48, PETAL = 0xfbe3ec, PETAL_MID = 0xf6c445

type Palette = {
  outline: number; rim: number; shadow: number; base: number; light: number; gilt: number; shine: number
  mask: number; stalk: number; accent: number; belly: number; snout: number; nose: number; beak: number
  beakDark: number; wing: number; wingDark: number; membrane: number; bone: number; boneDark: number; iris: number
}

/** shiny: bronze outline and gold accents; regal: a legendary's gold rim light; pale: a ghost; aura: a Mythic's light outline */
type Tone = { shiny: boolean; regal: boolean; pale: boolean; aura: boolean }

function paletteOf(family: Family, h: number, lk: Look, tone: Tone): Palette {
  const st = STYLE[family]
  const s = (st.sat + lk.sat + (tone.shiny ? 0.12 : 0)) * (tone.pale ? 0.85 : 1)
  const l = st.light + lk.light + (tone.pale ? 0.07 : 0)
  const [af, as, asat, al] = st.accent
  const light = hsl(toward(h, 60, 10), s * 0.96, l + 0.12)
  const aura = hsl(toward(h, 60, 12), Math.min(0.85, s + 0.25), 0.78)
  return {
    // the outline is coloured on the lit top and left, darkest only along the bottom and right
    outline: tone.aura ? aura : tone.shiny ? hsl(34, 0.62, 0.3) : hsl(toward(h, 255, 20), Math.min(0.75, s * 1.35), 0.25),
    rim: tone.aura ? aura : tone.shiny ? hsl(28, 0.55, 0.15) : hsl(toward(h, 255, 30), Math.min(0.6, s), 0.13),
    shadow: hsl(toward(h, 255, 10), s * 1.04, l - 0.16),
    base: hsl(h, s, l),
    light,
    gilt: mix(light, GOLD, 0.62),
    shine: hsl(toward(h, 60, 16), s * 0.6, Math.min(0.84, l + 0.24)),
    mask: hsl(toward(h, 255, 14), s * 0.8, l - 0.22),
    stalk: hsl(toward(h, 255, 16), Math.min(0.7, s * 1.2), l - 0.24),
    accent: tone.shiny ? GOLD : hsl(af + lk.accent * as, asat, al),
    belly: hsl(toward(h, 60, 24), s * 0.5, Math.min(0.82, l + 0.22)),
    snout: hsl(toward(h, 60, 14), s * 0.75, Math.min(0.8, l + 0.15)),
    nose: hsl(toward(h, 330, 40), 0.5, 0.3),
    beak: hsl(38, 0.85, 0.6),
    beakDark: hsl(24, 0.75, 0.44),
    wing: hsl(toward(h, 60, 18), s * 0.8, Math.min(0.78, l + 0.17)),
    wingDark: hsl(toward(h, 255, 8), s * 0.85, l - 0.05),
    membrane: hsl(toward(h, 255, 6), s * 0.9, l - 0.06),
    bone: hsl(40, 0.4, 0.8),
    boneDark: hsl(34, 0.32, 0.6),
    iris: hsl(toward(h, 200, 30), 0.55, 0.42),
  }
}

// ---------- sources ----------

/** What a form may carry beyond the contract: a species id; a card form's kind, a fusion's parents, a seed. */
type FormExtra = Form & Partial<Pick<CardForm, 'kind' | 'parents' | 'seed'>> & { id?: string }

/** Evolution stages (SPEC section 22). Legendaries and Mythics are always drawn in their final form. */
export type Stage = CardStage

export type SpriteSource =
  | Pick<Card, 'species' | 'form' | 'dna' | 'shiny' | 'rarity' | 'stage' | 'raisedIn'>
  | { form: Form; stage?: Stage; shiny?: boolean; rarity?: Rarity; raisedIn?: Family; seed?: string }

export type DrawOptions = {
  /** stages 2 and 3: the arena family it was raised in; restyles the accessory and tints the hue 20% (35% at stage 3) */
  raisedIn?: Family
  /** the parts seed; defaults to the species id, a fusion's parents or the form's own name */
  seed?: string
  mythic?: boolean
  /** explicit parts, already grown for the stage (tools and tests) */
  parts?: Parts
}

const isMythic = (form: Form) => (form as FormExtra).kind === 'mythic'

/** The 16x16 sprite of a card, or of a bare form (album, Mythics) with its plain look. */
export function spriteFor(src: SpriteSource): Pixels {
  if (!('dna' in src)) {
    const lk = { ...formLook(src.form), shiny: src.shiny ?? false }
    const o: DrawOptions = { mythic: isMythic(src.form) }
    if (src.raisedIn) o.raisedIn = src.raisedIn
    if (src.seed) o.seed = src.seed
    return draw(src.form, lk, src.stage ?? 1, src.form.legendary || src.rarity === 'legendary', o)
  }
  const form = formOf(src)
  const o: DrawOptions = { mythic: src.species === 'mythic' || isMythic(form) }
  if (src.raisedIn) o.raisedIn = src.raisedIn
  return draw(form, cardLook(src), src.stage, form.legendary || src.rarity === 'legendary', o)
}

const UNLOCK_TAIL: Record<Body, Tail> = { blob: 'curl', critter: 'fluffy', bird: 'fin', ghost: 'curl', bug: 'spike', wyrm: 'spike' }
const UNLOCK_WINGS: Record<Body, Wings> = { blob: 'leaf', critter: 'small', bird: 'large', ghost: 'bat', bug: 'leaf', wyrm: 'bat' }
const MYTHIC_EARS: readonly Ears[] = ['pointy', 'round', 'floppy', 'fins', 'none']
const MYTHIC_WINGS: readonly Wings[] = ['none', 'none', 'large', 'leaf', 'bat']
const MYTHIC_TAILS: readonly Tail[] = ['none', 'curl', 'spike', 'fluffy', 'fin']
const MYTHIC_HEADS: readonly Head[] = ['merged', 'round', 'wide', 'small']

/**
 * The parts a form is built from at a stage: each evolution grows them once more, and the final stage also
 * unlocks one new part (a tail, wings, or livelier arms). Legendaries and Mythics take their final, largest form.
 * Fusions take parent A's body and parent B's head-top and wings. Birds always keep their beak.
 */
export function formParts(form: Form, stage: Stage, exalted: boolean, seed?: string): Parts {
  const f = form as FormExtra
  const key = seed ?? f.seed ?? f.id ?? `form/${form.body}/${form.names[0]}`
  let p: Parts
  if (!seed && !f.seed && f.parents) {
    const a = getSpecies(f.parents[0]), b = getSpecies(f.parents[1])
    p = hybrid(partsFor(a ? a.id : 'fusion/' + f.names[0], form.body), partsFor(b ? b.id : 'fusion/' + f.names[1], b ? b.body : form.body))
  } else p = partsFor(key, form.body)
  for (let s = 1; s < (exalted ? 3 : stage); s++) p = grow(p)
  if (exalted) p = exalt(p)
  else if (stage === 3) {
    const options: Parts[] = []
    if (p.tail === 'none') options.push({ ...p, tail: UNLOCK_TAIL[p.torso], tailSize: 3 })
    if (p.wings === 'none' && form.accessory !== 'wings') options.push({ ...p, wings: UNLOCK_WINGS[p.torso] })
    if (p.arms !== 'wave' && p.torso !== 'bird') options.push({ ...p, arms: p.arms === 'none' ? 'nubs' : 'wave' })
    if (options.length) p = options[hashString('unlock/' + key) % options.length]!
  }
  if (p.torso === 'bird') p = { ...p, muzzle: 'beak' }
  if (isMythic(form)) {
    // a Mythic re-rolls its showiest parts from its own seed, so no two look alike
    const h = hashString('mythic-parts/' + key)
    const ears = MYTHIC_EARS.filter(e => form.accessory !== 'spikes' || KEEP.spikes.includes(e))
    p = {
      ...p, ears: ears[h % ears.length]!, wings: MYTHIC_WINGS[(h >>> 4) % MYTHIC_WINGS.length]!,
      tail: MYTHIC_TAILS[(h >>> 8) % MYTHIC_TAILS.length]!, head: p.torso === 'ghost' ? 'merged' : MYTHIC_HEADS[(h >>> 12) % MYTHIC_HEADS.length]!,
    }
  }
  return p
}

// ---------- building the creature: a grid of part kinds ----------
// '#' body  'f' feet, legs and floppy ears  'a' stalk (never outlined)  'e' accent  'w' wing  'W' wing edge
// 'v' bat-wing bone  'm' membrane  't' tail  'T' tail tip  'F' fluff  'h' horn nub  'b' beak  'B' beak underside or
// bird legs  'n' snout  'N' nose  'd' segment line  '1'..'4' accessory material: main, dark, tip, gem
// 'k' 'K' 'j' hat, band, highlight  'q' 'Q' bow, knot  'p' 'P' petal, heart

const LEG_H: Record<Legs, number> = { none: 0, stubby: 1, long: 2, many: 1 }

// Pictures for the left side, read left to right; `ax, ay` is the cell placed on the anchor. Every picture is
// 4-connected, so nothing in it floats.
type Art = { rows: readonly string[]; ax: number; ay: number }
const art = (ax: number, ay: number, ...rows: string[]): Art => ({ rows, ax, ay })

const WING_ART: Record<Exclude<Wings, 'none'>, Art> = {
  small: art(1, 1, 'w.', 'wW'),
  large: art(3, 3, 'w...', 'ww..', 'Www.', '.wwW', '..wW'),
  leaf: art(2, 3, 'w..', 'wW.', '.wW', '..w'),
  bat: art(4, 2, 'v....', 'vmv..', 'vmmmv', 'v.v.v'),
}

const TAIL_ART: Record<Exclude<Tail, 'none'>, readonly Art[]> = {
  curl: [art(1, 1, 'T.', 'tt'), art(2, 3, 'TT.', 't..', 't..', 'ttt'), art(3, 3, 'TTT.', 't.T.', 't...', 'tttt')],
  spike: [art(2, 1, 'TT.', '.tt'), art(3, 2, 'T...', 'tt..', '.ttt'), art(4, 3, 'T....', 'TT...', '.ttt.', '...tt')],
  fluffy: [art(1, 1, 'FF', 'Ft'), art(2, 2, '.FF', 'FFF', 'FFt'), art(3, 2, '.FF.', 'FFFF', '.FFt')],
  fin: [art(1, 1, 'T.', 'tt', 'T.'), art(2, 1, 'T..', 'Ttt', 'T..'), art(3, 2, 'T...', 'TT..', '.ttt', 'TT..', 'T...')],
}

// a wyrm's tail always sweeps out along the ground and hooks up at the tip
const SERPENT: readonly Art[] = [art(2, 1, 'T..', 'ttt'), art(3, 2, 'T...', 't...', 'tttt'), art(4, 3, '.T...', 'Tt...', 't....', 'ttttt')]
const NUB = art(0, 0, '#'), WAVE = art(1, 1, '#.', '##')
const FIN_SMALL = art(0, 1, 'e', 'e', 'e'), FIN_BIG = art(1, 2, 'e.', 'ee', '.e', 'ee', 'e.')
const LEG_SIDE = art(0, 0, 'ff', 'f.'), SPIKE_SIDE = art(1, 0, '31')
const STRAIGHT = [[0, 1], [0, 2], [0, 3], [0, 4]] as const, BENT = [[0, 1], [1, 1], [1, 2], [1, 3], [1, 4]] as const

// Head-top accessories, [stage 2, stage 3]: the final stage wears a grander piece of its own. Crowns and halos
// are centred left halves (the anchor lands on column 7 and is mirrored); the rest are drawn per side.
const CROWN_ART: readonly [Art, Art] = [art(2, 1, '1.1', '111'), art(2, 2, '3.4', '1.1', '121')]
const NARROW_CROWN: readonly [Art, Art] = [art(1, 1, '1.', '11'), art(1, 2, '3.', '1.', '14')]
// horns rest on the top of the head and grow up and out, in the raising family's shape: small, medium, large
const HORN_ART: Record<Family, readonly [Art, Art, Art]> = {
  haiku: [art(1, 1, '3.', '11'), art(1, 2, '3.', '11', '.1'), art(2, 2, '3.3', '111', '..1')],
  sonnet: [art(0, 1, '3', '1'), art(1, 1, '31', '.1'), art(2, 2, '33.', '.1.', '.11')],
  opus: [art(1, 1, '3.', '11'), art(2, 1, '31.', '.11'), art(3, 2, '3...', '11..', '.111')],
  fable: [art(0, 1, '3', '1'), art(0, 2, '3', '1', '1'), art(1, 3, '.3', '.1', '11', '.1')],
}
// antenna tips sit on the cell above the stalk's end
const ANTENNA_TIP: Record<Family, readonly [Art, Art]> = {
  haiku: [art(1, 1, '13', '.1'), art(1, 1, '.13', '11.')],
  sonnet: [art(1, 1, '3.', '33'), art(1, 2, '3.', '33', '.3')],
  opus: [art(1, 1, '.3', '14'), art(1, 1, '33', '14')],
  fable: [art(1, 1, '.3', '33'), art(1, 2, '.3.', '343', '.3.')],
}
// rising from behind the head's upper corners; the anchor is the root cell, hidden behind the head
const ACC_WING_ART: Record<Family, readonly [Art, Art]> = {
  haiku: [art(3, 4, '3...', '131.', '1131', '.131', '..11'), art(4, 5, '3....', '13...', '1131.', '.1131', '..131', '...11')],
  sonnet: [art(4, 4, '3....', '31...', '311..', '.311.', '..311'), art(5, 5, '3.....', '33....', '311...', '.3111.', '..3111', '...311')],
  opus: [art(3, 3, '2...', '12..', '.121', '..11'), art(4, 4, '2....', '12...', '.122.', '..121', '...11')],
  fable: [art(3, 4, '.11.', '1441', '1111', '.111', '..11'), art(4, 5, '.11..', '1441.', '14411', '11111', '.1111', '...11')],
}
// a halo floats above the head, with a clear row between where there is room: a flat ring no wider than the head,
// glinting at the final stage; fable's is a crescent moon to one side
const WIDE_RING: readonly [Art, Art] = [art(3, 2, '.111', '11..', '.111'), art(3, 2, '.113', '11..', '.111')]
const RING: readonly [Art, Art] = [art(2, 2, '.11', '11.', '.11'), art(2, 2, '.13', '11.', '.11')]
const NARROW_RING: readonly [Art, Art] = [art(1, 2, '11', '1.', '11'), art(1, 2, '13', '1.', '11')]
const MOON: readonly [Art, Art] = [art(0, 2, '.33', '33.', '.33'), art(0, 2, '.333', '33..', '.333')]

/** The accessory an evolved creature raised away from home grows: its raising family's signature. */
export const SIGNATURE: Record<Family, Accessory> = { haiku: 'antennae', sonnet: 'wings', opus: 'horns', fable: 'halo' }

// The head top holds one thing of each kind: an accessory drops the ears that would pile into it or double it
// (horns replace pointed ears, antennae grow from antennae), and any ear left is kept clear of it.
const KEEP: Record<Accessory, readonly Ears[]> = {
  crown: ['pointy', 'round', 'long', 'floppy', 'nubs', 'fins'],
  halo: ['pointy', 'round', 'floppy', 'nubs', 'fins'],
  horns: ['round', 'floppy', 'crest', 'tuft', 'sprout', 'fins'],
  antennae: ['round', 'floppy', 'crest', 'tuft', 'fins'],
  spikes: ['round', 'long', 'floppy', 'nubs', 'fins'],
  wings: ['pointy', 'round', 'long', 'floppy', 'nubs', 'antennae', 'crest', 'tuft', 'sprout', 'fins'],
}

function earHeight(e: Ears, s: number): number {
  switch (e) {
    case 'pointy': case 'tuft': return s
    case 'round': return s >= 3 ? 3 : 2
    case 'long': return s + 2
    case 'nubs': return 2
    case 'antennae': return s + 1
    case 'crest': case 'sprout': return s === 1 ? 2 : 3
    default: return 0
  }
}

/** An accessory's size, 0..2: bigger at the final stage and on a species with bigger ears. */
const accSize = (full: boolean, es: number) => (full ? 1 : 0) + (es >= 3 ? 1 : 0)
const antennaPath = (tilt: boolean, size: number) => (tilt ? BENT : STRAIGHT).slice(0, 1 + size)

/** Rows an accessory of size `g` needs above the head; `grand` picks the final stage's own art. */
function accHeight(acc: Accessory, style: Family, g: number, grand: boolean, tilt: boolean): number {
  switch (acc) {
    case 'crown': return CROWN_ART[grand ? 1 : 0].rows.length
    case 'horns': return HORN_ART[style][g]!.rows.length
    case 'antennae': return antennaPath(tilt, g).at(-1)![1] + 1 + ANTENNA_TIP[style][grand ? 1 : 0].ay
    case 'spikes': return 2 + g
    case 'wings': return grand ? 3 : 2
    default: return 0
  }
}

/** Half-widths per row of a superellipse-ish shape, top to bottom. */
function profile(w: number, h: number, round: number, taper: number, flat: number, dome = round): number[] {
  const out: number[] = []
  for (let i = 0; i < h; i++) {
    const t = ((i + 0.5) / h) * 2 - 1
    const u = Math.abs(t > 0 ? t * (1 - flat) : t), e = t < 0 ? dome : round
    const f = Math.pow(Math.max(0, 1 - Math.pow(u, e)), 1 / e)
    out.push(Math.max(1, Math.min(6, Math.round(w * f * (1 + taper * t)))))
  }
  return out
}

/** A ghost: a domed head over a body that tapers to a point, where its wisp curls away. */
function wisp(w: number, h: number): number[] {
  const out: number[] = []
  for (let i = 0; i < h; i++) {
    const t = ((i + 0.5) / h) * 2 - 1
    const f = t < 0 ? Math.pow(1 - Math.pow(-t, 2.1), 1 / 2.1) : 1 - 0.8 * Math.pow(t, 1.6)
    out.push(Math.max(1, Math.min(6, Math.round(w * f))))
  }
  return out
}

/** A coiled body: a short neck over rings that widen toward the ground. */
function coils(w: number, h: number): number[] {
  const out = [Math.max(2, Math.round(w * 0.45))]
  const rings = Math.max(1, Math.floor((h - 1) / 2))
  for (let r = 0; r < rings; r++) {
    const rw = Math.max(2, Math.round(w * (0.55 + (0.45 * (r + 1)) / rings)))
    out.push(rw - 1, rw)
  }
  while (out.length < h) out.push(out[out.length - 1]!)
  return out.slice(0, h)
}

/**
 * What a creature wears: an accessory (grander at stage 3), maybe a floating halo, a head trinket, in a family's
 * style, under a roof (the highest row it grows to). `floor` is the top row of the head at the stage before: a
 * body never shrinks below it to make room for what it now wears.
 */
type Dress = {
  acc: Accessory | null; halo: boolean; stage: Stage; style: Family; roof: number; trinket: Trinket; floor: number
  /** where wings grew at the stage before */
  rise?: boolean | undefined
  /** a Mythic's corner sparkles need room */
  sparkles: boolean
}

type Built = {
  kind: string[][]
  /** 1 torso, 2 head */
  region: number[][]
  /** cells that float unoutlined: the halo */
  glow: boolean[][]
  eyeY: number
  gap: number
  /** eyes are 2 pixels wide when the face has room, else 1 */
  eyeW: 1 | 2
  headTop: number
  /** first row below the head, 0 when the head is merged */
  chin: number
  /** first row of the lower body, below the face */
  split: number
  /** wings rose from behind the head rather than spreading beside the body */
  rise: boolean | undefined
}

const grid = <V>(v: V): V[][] => Array.from({ length: SIZE }, () => Array<V>(SIZE).fill(v))
type Cell = [number, number, string]

function build(species: Parts, dress: Dress, rng: Rng): Built {
  const { acc, style, roof, stage } = dress
  const full = stage === 3, ai = full ? 1 : 0
  // dna: small individual differences on top of the species' parts
  const p: Parts = { ...species }
  if (rng() < 0.3) p.side = p.side > 0 ? -1 : 1
  if (rng() < 0.25) p.tilt = !p.tilt
  if (rng() < 0.3) p.earSize = Math.max(1, Math.min(3, p.earSize + (rng() < 0.5 ? -1 : 1)))
  if (rng() < 0.3) p.tailSize = Math.max(1, Math.min(3, p.tailSize + (rng() < 0.5 ? -1 : 1)))
  // a rare runt or chonk
  const girth = rng()
  if (girth < 0.1) { p.tw = Math.max(2.5, p.tw - 0.5); p.hw = Math.max(3, p.hw - 0.5) }
  else if (girth > 0.9) { p.tw = Math.min(6.5, p.tw + 0.5); p.hw = Math.min(6, p.hw + 0.5) }
  if ((acc && !KEEP[acc].includes(p.ears)) || (dress.halo && !KEEP.halo.includes(p.ears))) p.ears = 'none'

  const K = grid('.'), R = grid(0), G = grid(false), Z = grid(false)
  const ok = (x: number, y: number) => x >= 1 && x <= 14 && y >= 1 && y <= 14
  const set = (x: number, y: number, k: string) => { if (ok(x, y)) K[y]![x] = k }
  const both = (x: number, y: number, k: string) => { set(x, y, k); set(15 - x, y, k) }
  /** the cells of left-side art at (x, y); side -1 keeps it on the left, 1 mirrors it to the right, 0 draws both */
  const cellsOf = (a: Art, x: number, y: number, side: -1 | 0 | 1): Cell[] => {
    const out: Cell[] = []
    a.rows.forEach((r, ry) => [...r].forEach((ch, rx) => {
      if (ch === '.') return
      const gx = x + rx - a.ax, gy = y + ry - a.ay
      if (side <= 0) out.push([gx, gy, ch])
      if (side >= 0) out.push([15 - gx, gy, ch])
    }))
    return out
  }
  const inFrame = (cells: Cell[]) => cells.every(([x, y]) => ok(x, y))
  const solid = (x: number, y: number) => ok(x, y) && K[y]![x] !== '.' && !G[y]![x]
  /**
   * Draws an appendage behind what is already there, only if it stays inside the frame, shows at least `min`
   * cells a side, and every cell it shows reaches the creature orthogonally: nothing floats.
   */
  const attach = (a: Art, x: number, y: number, side: -1 | 0 | 1, min: number): boolean => {
    const cells = cellsOf(a, x, y, side)
    if (!inFrame(cells)) return false
    // cells around the head-top pieces stay clear, so nothing touches them
    const shown = cells.filter(([cx, cy]) => K[cy]![cx] === '.' && !Z[cy]![cx])
    if (shown.length < min * (side === 0 ? 2 : 1)) return false
    const left = new Map(shown.map(c => [c[1] * SIZE + c[0], c]))
    const todo = shown.filter(([cx, cy]) => N4.some(([dx, dy]) => solid(cx + dx, cy + dy)))
    for (const [cx, cy] of todo) left.delete(cy * SIZE + cx)
    while (todo.length) {
      const [cx, cy] = todo.pop()!
      for (const [dx, dy] of N4) {
        const n = left.get((cy + dy) * SIZE + cx + dx)
        if (n) { left.delete((cy + dy) * SIZE + cx + dx); todo.push(n) }
      }
    }
    if (left.size) return false
    for (const [cx, cy, ch] of shown) K[cy]![cx] = ch
    return true
  }
  /**
   * Draws head-top pieces in front and reserves the cells around them, so no ear grows into them; a glow keeps a
   * wider berth, since the outline of whatever came near would touch it.
   */
  const crown = (cells: Cell[], glow = false) => {
    for (const [x, y, ch] of cells) {
      if (!ok(x, y) && !(glow && y === 0 && ok(x, 1))) continue
      if (glow) { if (K[y]![x] !== '.') continue; G[y]![x] = true }
      K[y]![x] = ch
      const r = glow ? 2 : 1
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.abs(dx) + Math.abs(dy) <= r && ok(x + dx, y + dy)) Z[y + dy]![x + dx] = true
    }
  }

  // 1. layout, bottom up: grow toward the stage's roof and to at least the body of the stage before, then shrink
  // back under the roof as far as that allows. A young creature is mostly head; by the final stage the body has
  // caught up.
  const merged = p.head === 'merged'
  const ghost = p.torso === 'ghost'
  const bottom = 14 - LEG_H[p.legs] - (ghost ? 1 : 0)
  // es: ear size; g: accessory size; clear: the clear row under a halo
  let th = ghost ? Math.max(p.th, 7) : p.th, hh = merged ? 0 : p.hh, es = p.earSize, g = accSize(full, es), clear = 1
  const haloArt = dress.halo ? (style === 'fable' ? MOON : RING)[ai] : null
  const head = () => (merged ? bottom - th + 1 : bottom - th + 2 - hh)
  const accH = () => (acc && !(acc === 'spikes' && dress.halo) ? accHeight(acc, style, g, full && g > 0, p.tilt) : 0)
  // the highest row the creature reaches: its ears, its accessory, or its halo over a clear row (unoutlined, a halo
  // may rise one row higher, to the very edge of the frame)
  const top = () => head() - Math.max(earHeight(p.ears, es), accH(), haloArt ? haloArt.rows.length + clear : 0)
  const maxTh = merged ? Math.min(12, Math.round(p.tw * 1.6) + stage - 1) : 7
  const bigger = (i: number) => {
    const headTurn = !merged && (stage === 1 ? i % 3 !== 2 : stage === 3 ? i % 3 === 2 : i % 2 === 1)
    if (headTurn && hh < 6) hh++
    else if (th < maxTh) th++
    else if (!merged && hh < 6) hh++
    else return false
    return true
  }
  let i = 0
  while (i < 10 && top() > roof && bigger(i)) i++
  // never smaller than the stage before, whatever it now wears on its head
  while (head() > dress.floor && bigger(i)) i++
  const minTh = ghost ? 7 : merged ? 5 : 3
  while (top() < roof && head() < dress.floor) {
    if (stage === 3 && hh > 4) hh--
    else if (th > minTh) th--
    else if (hh > 4) hh--
    else if (es > 1) es--
    else break
  }
  // past the roof the head top stays inside the frame: the halo gives up its clear row, then the accessory and the
  // ears a size, before the body gives way
  while (top() < 1) {
    if (haloArt && clear) clear = 0
    else if (g > 0) g--
    else if (es > 1) es--
    else if (th > minTh) th--
    else if (hh > 4) hh--
    else break
  }
  const grand = full && g > 0
  const torsoTop = bottom - th + 1
  const headTop = merged ? torsoTop : torsoTop + 1 - hh
  const tp = p.torso === 'wyrm' ? coils(p.tw, th)
    : ghost ? wisp(Math.min(p.tw, 4.5), th)
    : profile(p.tw, th, p.round, p.taper, p.flat, merged ? 2.1 : p.round)
  const hp = merged ? tp : profile(p.hw, hh, p.head === 'wide' ? 2.25 : p.head === 'small' ? 2 : 2.1, 0, 0.25)
  // dna: corner rows round off (or now and then square up) a little, never wider than the row inside them, so
  // shapes stay convex
  const nudge = (rows: number[], i: number, inner: number) => {
    const v = rows[i]! + [-1, -1, 0, 1][Math.floor(rng() * 4)]!
    rows[i] = Math.max(1, Math.min(v, rows[inner] ?? v, 6))
  }
  if (tp.length > 3) { nudge(tp, 0, 1); nudge(tp, tp.length - 1, tp.length - 2); nudge(tp, tp.length - 2, tp.length - 3) }
  if (!merged && hp.length > 3) { nudge(hp, 1, 2); nudge(hp, 0, 1) }
  const eyeY = merged ? torsoTop + Math.max(2, Math.round(th * 0.33)) : headTop + Math.max(1, Math.floor((hh - 1) / 2))
  // a bug's waist, between thorax and abdomen, always below the face
  const waist = p.torso === 'bug' ? Math.max(torsoTop + Math.round(th * 0.4), merged ? eyeY + 4 : 0) : 0
  if (waist && waist < bottom - 1) tp[waist - torsoTop] = Math.max(1, tp[waist - torsoTop]! - 1)

  const tw = (y: number) => tp[y - torsoTop] ?? 0
  const hw = (y: number) => (merged ? tw(y) : hp[y - headTop] ?? 0)
  const width = (y: number) => Math.max(tw(y), hw(y))
  const faceW = Math.min(hw(eyeY), hw(eyeY + 1))
  const gap = Math.max(1, Math.min(p.eyeGap, faceW - 3))
  const eyeW: 1 | 2 = faceW >= gap + 3 ? 2 : 1
  const shoulder = merged ? Math.min(eyeY + 3, bottom - 1) : Math.min(torsoTop + 1, bottom)
  const chin = merged ? 0 : headTop + hh

  // 2. torso, then the head over it
  for (let y = torsoTop; y <= bottom; y++) for (let d = 0; d < tw(y); d++) { both(7 - d, y, '#'); R[y]![7 - d] = R[y]![8 + d] = 1 }
  if (waist && waist < bottom - 1) for (let d = 0; d < tw(waist) - 1; d++) both(7 - d, waist, 'd')
  // a wyrm's coils: a short seam at each side under every ring but the last
  if (p.torso === 'wyrm') for (let y = torsoTop + 2; y < bottom - 1; y += 2) {
    if (y > eyeY + 2) for (let d = Math.max(1, tw(y) - 3); d < tw(y) - 1; d++) both(7 - d, y, 'd')
  }
  if (!merged) for (let y = headTop; y < headTop + hh; y++) for (let d = 0; d < hw(y); d++) { both(7 - d, y, '#'); R[y]![7 - d] = R[y]![8 + d] = 2 }
  // a ghost tapers into a wisp that curls to one side
  if (ghost) {
    const x = p.side > 0 ? 7 + tw(bottom) : 8 - tw(bottom)
    for (const wx of [x, x + p.side]) if (ok(wx, bottom + 1)) { K[bottom + 1]![wx] = '#'; R[bottom + 1]![wx] = 1 }
  }

  // 3. the head top: the accessory (or halo) first, then whatever ears still fit beside it
  const w0 = hw(headTop), w1 = hw(headTop + 1) || w0
  const xo = 8 - w1, xt = 8 - w0
  // horns and antennae grow from the first row of the head wide enough to keep the pair apart
  let yr = headTop
  while (hw(yr) < 3 && yr < headTop + 2) yr++
  const xs = [9 - hw(yr), 10 - hw(yr), 11 - hw(yr)].filter(x => x <= 6)
  const earCells = (s: number): Cell[] => {
    const out: Cell[] = []
    const pair = (x: number, y: number, k: string) => { out.push([x, y, k], [15 - x, y, k]) }
    const lean = (dx: number, dy: number, k: string) => out.push([p.side > 0 ? 7 + dx : 8 - dx, headTop - dy, k])
    const xr = Math.max(xo, xt - 1)
    switch (p.ears) {
      case 'pointy': {
        const bend = p.tilt && s > 1 && xo > 1
        for (let k = 0; k <= s; k++) for (let c = 0; c <= s - k; c++) if (!(bend && k === s)) pair(xo + c, headTop - k, '#')
        if (bend) { pair(xo - 1, headTop - s, '#'); pair(xo - 1, headTop - s + 1, '#') }
        if (s >= 2) { pair(xo + 1, headTop - 1, 'e'); if (s >= 3) pair(xo + 1, headTop - 2, 'e') }
        break
      }
      case 'round': {
        const d = s >= 3 ? 3 : 2
        for (let r = 0; r < d; r++) for (let c = 0; c < d; c++) {
          if (d === 3 && (r === 0 || r === 2) && (c === 0 || c === 2) && !(r === 2 && c === 2)) continue
          pair(xr + c - (d === 3 ? 1 : 0), headTop - d + r, '#')
        }
        pair(xr + (d === 3 ? 0 : 1), headTop - (d === 3 ? 2 : 1), 'e')
        break
      }
      case 'long': {
        const xl = xr + 1, bend = p.tilt && s >= 2
        for (let k = 1; k <= s + 2; k++) {
          const sh = bend && k > 2 ? -1 : 0
          pair(xl + sh, headTop - k, '#')
          if (k < s + 2) pair(xl + 1 + sh, headTop - k, k >= 2 ? 'e' : '#')
        }
        break
      }
      case 'floppy':
        for (let k = 1; k <= s + 1; k++) {
          const x = 7 - hw(headTop + k)
          pair(x, headTop + k, 'f')
          if (k > 1 && k <= s) pair(x - 1, headTop + k, 'f')
        }
        break
      case 'nubs':
        pair(xt + 1, headTop - 1, 'h'); pair(xt + 1, headTop - 2, 'h')
        break
      case 'antennae': {
        const xb = Math.min(6, xt + 1)
        for (const sd of [-1, 1] as const) {
          const path = p.tilt && sd === p.side ? BENT : STRAIGHT
          const m = (x: number) => (sd < 0 ? x : 15 - x)
          for (let i = 0; i < s; i++) out.push([m(xb - path[i]![0]), headTop - path[i]![1], 'a'])
          // a bud of three cells leaning outward, so it reads even where the stalk is thin
          const [tx, ty] = path[s]!
          out.push([m(xb - tx), headTop - ty, 'e'], [m(xb - tx - 1), headTop - ty, 'e'], [m(xb - tx - 1), headTop - ty + 1, 'e'])
        }
        break
      }
      case 'crest':
        // a single fin swept back to one side
        for (const [dx, dy] of s === 1 ? [[0, 1], [1, 1], [1, 2]] : s === 2 ? [[0, 1], [1, 1], [1, 2], [2, 2], [2, 3]]
          : [[0, 1], [1, 1], [2, 1], [1, 2], [2, 2], [3, 2], [2, 3], [3, 3]]) lean(dx!, dy!, 'e')
        break
      case 'tuft':
        // a cowlick that curls back over
        for (const [dx, dy] of [[0, 1], [1, 1], ...(s >= 2 ? [[1, 2]] : []), ...(s >= 3 ? [[1, 3], [0, 3]] : [])]) lean(dx!, dy!, '#')
        break
      case 'sprout': {
        const len = s === 1 ? 1 : 2
        for (let k = 1; k <= len; k++) lean(1, k, 'a')
        lean(2, len, 'e'); lean(3, len, 'e'); lean(3, len + 1, 'e')
        if (s >= 3) { lean(1, len + 1, 'e'); lean(0, len + 1, 'e') }
        break
      }
      case 'fins':
        out.push(...cellsOf(s >= 2 ? FIN_BIG : FIN_SMALL, 7 - hw(eyeY), eyeY, 0))
        break
    }
    return out
  }
  // ears in their own place, largest first; beside a head-top piece a pair may also sit one cell further out, still
  // on the head, to make room for it
  const outward = (cells: Cell[]): Cell[] => cells.map(([x, y, k]): Cell => [x < 8 ? x - 1 : x + 1, y, k])
  const onHead = (cells: Cell[]) => cells.every(([x, y]) => ok(x, y)) && cells.some(([x, y]) => N4.some(([dx, dy]) => R[y + dy]?.[x + dx] && K[y + dy]![x + dx] === '#'))
  const paired = ['pointy', 'round', 'long', 'nubs', 'antennae'].includes(p.ears) && (acc !== null || dress.halo)
  const biggest = Math.max(1, Math.min(es, 6 - xo))
  const earVariants = Array.from({ length: biggest }, (_, k) => biggest - k).flatMap(s => {
    const own = earCells(s), out = outward(own)
    return [{ s, cells: own, framed: s === 1 || own.every(([, y]) => y >= 1) }, ...(paired && onHead(out) ? [{ s, cells: out, framed: true }] : [])]
  }).filter(v => v.framed)
  // Of an accessory's variants (best first), the first that still leaves the ears room beside it, so a creature keeps
  // its ears as it grows; the ears drop only when none does. A glow keeps a wider berth.
  const roomy = (cells: Cell[], r: number) => earVariants.some(v => !v.cells.some(([x, y]) => y < headTop && cells.some(([cx, cy]) => Math.abs(cx - x) + Math.abs(cy - y) <= r)))
  const wear = (variants: Cell[][], glow = false) => {
    const fit = variants.filter(c => c.every(([x, y]) => ok(x, y) || (glow && y === 0 && ok(x, 1))))
    crown((p.ears === 'none' ? undefined : fit.find(c => roomy(c, glow ? 2 : 1))) ?? fit[0] ?? variants[0] ?? [], glow)
  }
  if (acc === 'crown') {
    wear((w0 > 3 ? [CROWN_ART, NARROW_CROWN] : [NARROW_CROWN]).map(a => cellsOf(a[grand ? 1 : 0], 7, headTop - 1, 0)))
  } else if (acc === 'horns') {
    wear(xs.map(x => cellsOf(HORN_ART[style][g]!, x, yr - 1, 0)))
  } else if (acc === 'antennae') {
    const stalk = antennaPath(p.tilt, g), [ldx, ldy] = stalk.at(-1)!
    wear(xs.map(x => {
      const one: Cell[] = [...stalk.map(([dx, dy]): Cell => [x - dx, yr - dy, 'a']), ...cellsOf(ANTENNA_TIP[style][grand ? 1 : 0], x - ldx, yr - ldy - 1, -1)]
      return [...one, ...one.map(([cx, cy, ch]): Cell => [15 - cx, cy, ch])]
    }))
  } else if (acc === 'spikes' && !dress.halo) {
    // a frill along the curve of the head from its crown toward one side, shorter toward the edge, stopping short
    // of an ear (under a halo, only the spikes down the sides)
    const frill = (reach: number) => {
      const cells: Cell[] = []
      for (let d = 0; d <= reach; d++) {
        const x = p.side > 0 ? 8 + d : 7 - d
        let y = headTop
        while (y < bottom && K[y]![x] === '.') y++
        cells.push([x, y - 1, '1'])
        const tall = d % 2 ? 0 : 1 + g - d / 2
        for (let k = 1; k <= tall; k++) cells.push([x, y - 1 - k, k === tall ? '3' : '1'])
      }
      return cells
    }
    const reach = Math.min(width(eyeY) - 2, 2 + g)
    wear(Array.from({ length: Math.min(reach, 2) + 1 }, (_, k) => frill(reach - k)))
  }
  if (haloArt) {
    const y = headTop - 2 - clear
    // the widest ring the head allows
    const wide = Math.max(...Array.from({ length: eyeY + 2 - headTop }, (_, k) => hw(headTop + k)))
    const rings = [WIDE_RING, RING, NARROW_RING].slice(Math.max(dress.sparkles ? 1 : 0, Math.min(2, 5 - wide))).map(r => cellsOf(r[ai], 7, y, 0))
    wear(style === 'fable' ? [cellsOf(haloArt, 6, y, p.side > 0 ? 1 : -1)] : rings, true)
  }
  if (p.ears !== 'none') for (const { cells } of earVariants) {
    if (cells.some(([x, y]) => y < headTop && ok(x, y) && Z[y]![x])) continue
    const mine = new Set<number>()
    for (const [x, y, ch] of cells) {
      if (!ok(x, y) || (K[y]![x] !== '.' && !mine.has(y * SIZE + x))) continue
      K[y]![x] = ch
      mine.add(y * SIZE + x)
    }
    break
  }

  // 4. head trinkets: a hat only on a bare head top; a bow or flower at the temple, clear of the face
  const onFace = ([x, y]: Cell) => y >= eyeY - 1 && y <= eyeY + 2 && x >= 6 - gap && x <= 9 + gap
  if (dress.trinket === 'hat' && !acc && !dress.halo && headTop >= 3) {
    // worn at a jaunty angle, toward the creature's side
    const sh = p.side > 0 ? 2 : 0
    const hat: Cell[] = [5, 6, 7, 8].map((x): Cell => [x + sh, headTop - 1, 'k'])
    hat.push([6 + sh, headTop - 2, 'K'], [7 + sh, headTop - 2, 'K'])
    if (headTop >= 4) hat.push([6 + sh, headTop - 3, 'j'], [7 + sh, headTop - 3, 'k'])
    for (const [x, y, ch] of hat) set(x, y, ch)
  } else if (dress.trinket === 'bow' || dress.trinket === 'flower') {
    const a = dress.trinket === 'bow' ? art(1, 1, 'q.q', 'qQq', 'q.q') : art(1, 1, '.p.', 'pPp', '.p.')
    const spots: [number, number][] = [[8 - hw(headTop + 1), headTop + 1], [8 - hw(headTop), headTop], [xt, headTop - 1], [xt + 1, headTop - 2], [8 - hw(headTop + 2), headTop + 2]]
    // clear of the head-top pieces where it can be
    const fits = spots.map(([x, y]) => cellsOf(a, x, y, p.side > 0 ? 1 : -1)).filter(c => inFrame(c) && !c.some(onFace))
    for (const [cx, cy, ch] of fits.find(c => !c.some(([x, y]) => Z[y]![x])) ?? fits[0] ?? []) set(cx, cy, ch)
  }

  // 5. snout or beak
  if (p.muzzle === 'snout' && hw(eyeY + 2) >= 3 && hw(eyeY + 3) >= 3) {
    both(6, eyeY + 2, 'n'); both(7, eyeY + 2, 'N'); both(6, eyeY + 3, 'n'); both(7, eyeY + 3, 'n')
  } else if (p.muzzle === 'beak') { both(7, eyeY + 1, 'b'); both(7, eyeY + 2, 'B') }

  // 6. appendages sit behind the body: beside it where there is room, else peeking out from behind it. Wings ride
  // at the shoulder or, for some species, low at the hip.
  /** the row an appendage was placed at, or -1 */
  const placeAt = (a: Art, ys: number[], side: -1 | 0 | 1, min: number) => {
    for (let k = 0; k <= 3; k++) for (const y of ys) if (y >= 1 && y <= bottom && attach(a, 7 - width(y) + k, y, side, min)) return y
    return -1
  }
  const place = (a: Art, ys: number[], side: -1 | 0 | 1, min: number) => placeAt(a, ys, side, min) >= 0
  const backY = merged ? [torsoTop + 2, torsoTop + 3, torsoTop + 1] : [headTop + 2, headTop + 1, headTop + 3]
  // wings spread beside the body or rise from behind the head, and keep to where they grew at the stage before
  let rise: boolean | undefined
  const wings = (arts: Art[], fronts: number[]) => {
    const order = dress.rise === undefined ? [[...fronts, ...backY]] : dress.rise ? [backY, fronts] : [fronts, backY]
    for (const ys of order) for (const a of arts) {
      const y = placeAt(a, ys, 0, a === WING_ART.small ? 3 : 4)
      if (y >= 0) { rise = !fronts.includes(y); return }
    }
  }
  if (p.wings !== 'none' && acc !== 'wings') {
    const low = !ghost && (Math.round(species.tw * 2) + species.th) % 2 === 1
    const ys = low ? [shoulder + 2, shoulder + 1, shoulder, shoulder - 1] : [shoulder, shoulder + 1, shoulder - 1, shoulder + 2]
    // where a big wing cannot show, a small one still does
    wings([...new Set([WING_ART[p.wings], WING_ART.small])], ys.filter(y => y >= torsoTop - 1))
  }
  if (p.tail !== 'none') {
    const ys = ghost ? [bottom - 1, bottom - 2, bottom - 3] : p.torso === 'wyrm' ? [bottom, bottom - 1, bottom - 2] : [bottom - 1, bottom - 2, bottom]
    // a tail that cannot show tries its smaller self, so a real tail reads or none at all
    const arts = p.torso === 'wyrm' ? SERPENT : TAIL_ART[p.tail]
    for (let size = Math.min(3, Math.max(1, p.tailSize)); size >= 1; size--) if (place(arts[size - 1]!, ys, p.side > 0 ? 1 : -1, 3)) break
  }
  if (acc === 'wings') wings(ACC_WING_ART[style].slice(0, grand ? 2 : 1).reverse(), [shoulder, shoulder + 1, shoulder - 1])
  if (p.arms !== 'none' && !(merged && p.wings !== 'none')) {
    const y = shoulder + (merged ? 0 : 1), x = 7 - width(y)
    if (p.arms === 'wave') { attach(NUB, x, y, p.side > 0 ? 1 : -1, 1); attach(WAVE, x, y, p.side > 0 ? -1 : 1, 3) }
    else attach(NUB, x, y, 0, 1)
  }
  if (acc === 'spikes') {
    for (const y of full ? [torsoTop + 1, torsoTop + 3, torsoTop + 5] : [torsoTop + 1, torsoTop + 3]) if (y < bottom) attach(SPIKE_SIDE, 7 - width(y), y, 0, 2)
  }

  // 7. legs
  const bw = tp[tp.length - 1]!
  const fx = Math.max(1, Math.min(bw - 1, Math.round(bw * 0.5)))
  const legKind = p.muzzle === 'beak' ? 'B' : 'f'
  if (p.legs === 'stubby') { both(7 - fx, bottom + 1, 'f'); if (bw >= 3) both(6 - fx, bottom + 1, 'f') }
  else if (p.legs === 'long') { both(7 - fx, bottom + 1, legKind); both(7 - fx, bottom + 2, legKind); both(6 - fx, bottom + 2, legKind) }
  else if (p.legs === 'many') {
    for (const y of [bottom - 3, bottom - 1]) if (y > torsoTop) attach(LEG_SIDE, 7 - tw(y), y, 0, 2)
    both(7 - fx, bottom + 1, 'f')
  }

  // 8. nothing floats: whatever does not reach the body orthogonally is dropped (the halo glows on its own)
  const kept = grid(false)
  const todo: [number, number][] = []
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (R[y]![x] && K[y]![x] !== '.') { kept[y]![x] = true; todo.push([x, y]) }
  while (todo.length) {
    const [x, y] = todo.pop()!
    for (const [dx, dy] of N4) if (solid(x + dx, y + dy) && !kept[y + dy]![x + dx]) { kept[y + dy]![x + dx] = true; todo.push([x + dx, y + dy]) }
  }
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (K[y]![x] !== '.' && !G[y]![x] && !kept[y]![x]) K[y]![x] = '.'

  return { kind: K, region: R, glow: G, eyeY, gap, eyeW, headTop, chin, split: merged ? eyeY + 3 : chin, rise }
}

// ---------- drawing ----------

const BODYISH = new Set(['#', 't'])
/** the highest row a creature may reach at each stage, so every evolution visibly grows */
const ROOF = [5, 3, 1] as const
// kinds that keep the head's colours on a two-tone creature, and kinds that always take the body's
const UPPER = new Set(['w', 'W', 'v', 'm', 'e', 'a', '1', '2', '3', '4']), LOWER = new Set(['t', 'T'])

/**
 * The body hue of a creature raised under another family: 20% of the way toward that family's hue at stage 2 and
 * 35% at stage 3, never leaving its own family's range. Stage 1 and home-raised creatures keep their hue.
 */
export function raisedHue(hue: number, family: Family, raisedIn: Family | undefined, stage: Stage): number {
  if (stage === 1 || !raisedIn || raisedIn === family) return hue
  const target = hueAt(raisedIn, 0.5)
  return clampHue(family, toward(hue, target, (stage === 3 ? 0.35 : 0.2) * hueGap(hue, target)))
}

/** Draws a form with a given look. Exposed for tools; cards go through spriteFor. */
export function draw(form: Form, lk: Look, stage: Stage, legendary: boolean, o: DrawOptions = {}): Pixels {
  const mythic = o.mythic ?? false
  const exalted = legendary || mythic
  // legendaries and Mythics never evolve: they are always in their final form
  const st: Stage = exalted ? 3 : stage
  let p = o.parts ?? formParts(form, st, exalted, o.seed)
  // a Mythic stays slim enough for its sparkles
  if (mythic && !o.parts) p = { ...p, tw: Math.min(p.tw, 4.5), hw: Math.min(p.hw, 4.5), wings: p.wings === 'large' ? 'leaf' : p.wings }
  const raised = st > 1 ? o.raisedIn : undefined
  const style = raised ?? form.family
  const dressAt = (s: Stage, floor: number, rise?: boolean): Dress => {
    const away = s > 1 && raised !== undefined && raised !== form.family
    let acc: Accessory | null = s === 1 ? null : away && !exalted ? SIGNATURE[raised] : form.accessory
    // Mythics always float a halo, keeping only an accessory that stays clear of it
    const halo = acc === 'halo' || mythic
    if (acc === 'halo' || (mythic && acc !== 'wings' && acc !== 'spikes')) acc = null
    // a Mythic stops a row short of the top and keeps its halo narrow, leaving its sparkles room in the corners
    return { acc, halo, stage: s, style: s > 1 ? style : form.family, roof: mythic ? 2 : ROOF[s - 1]!, trinket: lk.trinket, floor, rise, sparkles: mythic }
  }
  // every stage grows out of the one before it, its body at least as big and its wings where they were: lay the
  // earlier stages out first
  let floor = SIZE, rise: boolean | undefined
  if (!exalted && !o.parts) for (let s = 1; s < st; s++) {
    const prev = build(formParts(form, s as Stage, false, o.seed), dressAt(s as Stage, floor, rise), rngFromSeed('shape/' + lk.shapeSeed))
    floor = prev.headTop
    rise = prev.rise ?? rise
  }
  const regal = legendary && !mythic
  const b = build(p, dressAt(st, floor, rise), rngFromSeed('shape/' + lk.shapeSeed))
  const K = b.kind, R = b.region

  const hue = raisedHue(lk.hue, form.family, raised, st)
  const tone: Tone = { shiny: lk.shiny, regal, pale: p.torso === 'ghost', aura: mythic }
  let high = paletteOf(form.family, bodyHue(form.family, hue, lk.shiny), lk, tone), low = high
  if (mythic) {
    // a Mythic is iridescent: head and body sit at opposite ends of its family's band
    const t = rangePos(form.family, hue) < 0.5 ? 0 : 1
    high = paletteOf(form.family, bandHue(form.family, t), lk, tone)
    low = paletteOf(form.family, bandHue(form.family, 1 - t), lk, tone)
  } else {
    // a fusion's head keeps parent B's family colours; its body takes parent A's
    const parents = (form as FormExtra).parents
    const a = parents ? getSpecies(parents[0]) : undefined
    if (a) low = paletteOf(a.family, bodyHue(a.family, a.hue, lk.shiny), lk, tone)
  }
  const at = (x: number, y: number) => K[y]?.[x] ?? '.'
  const palAt = (x: number, y: number) => {
    const k = at(x, y)
    return LOWER.has(k) || (!UPPER.has(k) && y >= b.split) ? low : high
  }
  const [m1, m2, m3, m4] = exalted
    ? [GOLD, GOLD_DARK, GOLD_LIGHT, MATERIAL[style][3]]
    : lk.shiny ? [SILVER[0], SILVER[1], SILVER[2], MATERIAL[style][3]] : MATERIAL[style]

  const body = (x: number, y: number) => BODYISH.has(at(x, y))
  const px: Pixels = Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(T))

  // 1. colour every part, with soft light from the upper left (gilded on a legendary)
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const c = at(x, y)
    if (c === '.') continue
    const rp = palAt(x, y)
    let v: number
    switch (c) {
      case '#': case 't': {
        const above = body(x, y - 1), below = body(x, y + 1), left = body(x - 1, y), right = body(x + 1, y)
        // a legendary's gold rim light runs along its outer top and left edges only, never round seams and parts
        const lit = regal && R[y]![x] && (at(x, y - 1) === '.' || (at(x - 1, y) === '.' && x < 8)) ? rp.gilt : rp.light
        v = !above ? lit
          : !below ? rp.shadow
          : b.chin && y === b.chin && R[y]![x] === 1 && R[y - 1]![x] === 2 ? rp.shadow
          : !right && x > 7 ? rp.shadow
          : !left && x < 8 ? lit
          : rp.base
        break
      }
      case 'f': case 'd': case 'v': v = rp.shadow; break
      case 'a': v = rp.stalk; break
      case 'e': case 'T': v = rp.accent; break
      case 'w': v = rp.wing; break
      case 'W': v = rp.wingDark; break
      case 'm': v = rp.membrane; break
      case 'F': v = at(x, y - 1) === '.' ? rp.wing : rp.belly; break
      case 'h': v = at(x, y - 1) === '.' ? rp.bone : rp.boneDark; break
      case 'b': v = rp.beak; break
      case 'B': v = rp.beakDark; break
      case 'n': v = rp.snout; break
      case 'N': v = rp.nose; break
      case '1': v = m1; break
      case '2': v = m2; break
      case '3': v = m3; break
      case '4': v = m4; break
      case 'k': v = HAT; break
      case 'K': v = BAND_RED; break
      case 'j': v = HAT_SHINE; break
      case 'q': v = BOW; break
      case 'Q': v = BOW_DARK; break
      case 'p': v = PETAL; break
      case 'P': v = PETAL_MID; break
      default: v = rp.base
    }
    px[y]![x] = v
  }
  const isBody = (x: number, y: number) => at(x, y) === '#' && R[y]?.[x] !== 0
  // a shine dab on the upper left of the head
  for (let y = b.headTop + 1; y < b.eyeY; y++) {
    let x = 1
    while (x < 8 && !isBody(x, y)) x++
    if (x < 6 && isBody(x + 1, y) && isBody(x + 1, y - 1)) { px[y]![x + 1] = palAt(x + 1, y).shine; break }
  }

  // 2. pattern, on the torso (and around the eyes for masks); dna picks its colourway
  const prng = rngFromSeed('pattern/' + lk.shapeSeed)
  const way = (lk.shapeSeed >>> 8) % 3
  const interior = (x: number, y: number) => isBody(x, y) && isBody(x - 1, y) && isBody(x + 1, y) && isBody(x, y - 1) && isBody(x, y + 1)
  const face = (x: number, y: number) => y >= b.eyeY - 2 && y <= b.eyeY + 3 && x >= 5 - b.gap && x <= 10 + b.gap
  const eyeL = 7 - b.gap - (b.eyeW - 1), eyeR = 8 + b.gap + (b.eyeW - 1)
  let top = SIZE, bottom = 0
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (isBody(x, y)) { top = Math.min(top, y); bottom = Math.max(bottom, y) }
  const snouted = at(7, b.eyeY + 2) === 'N'
  const mouthY = snouted ? b.eyeY + 4 : b.eyeY + 2
  if (lk.pattern === 'spots') {
    let n = 0
    for (let tries = 0; tries < 80 && n < 5; tries++) {
      const x = 1 + Math.floor(prng() * 14), y = top + Math.floor(prng() * (bottom - top + 1))
      if (!interior(x, y) || face(x, y)) continue
      const c = way === 2 ? palAt(x, y).light : palAt(x, y).accent
      if ([px[y - 1]![x], px[y + 1]![x], px[y]![x - 1], px[y]![x + 1], px[y]![x]].includes(c)) continue
      px[y]![x] = c
      n++
    }
  } else if (lk.pattern === 'stripes') {
    for (let y = b.eyeY + 3; y < bottom; y += 2) {
      let l = 0
      while (l < 8 && !isBody(l, y)) l++
      for (const x of [l + 1, l + 2]) if (x < 7 && interior(x, y)) {
        const c = way === 2 ? palAt(x, y).mask : palAt(x, y).shadow
        px[y]![x] = c; px[y]![15 - x] = c
      }
    }
  } else if (lk.pattern === 'belly') {
    // only on a real tummy: two rows clear of the mouth, with room for a proper patch
    const from = Math.max(mouthY + 2, b.chin + 1)
    if (bottom - from + 1 >= 4) for (let y = from; y < bottom; y++) {
      const half = y === from || y === bottom - 1 ? 1 : 2
      for (let x = 8 - half; x < 8 + half; x++) if (interior(x, y)) px[y]![x] = way === 2 ? palAt(x, y).shine : palAt(x, y).belly
    }
  } else if (lk.pattern === 'mask') {
    // a patch around each eye, with a bridge of body colour between them
    for (let y = b.eyeY - 1; y <= b.eyeY + 2; y++) for (let x = 0; x < SIZE; x++) {
      const near = (x >= eyeL - 1 && x <= 6) || (x >= 9 && x <= eyeR + 1)
      if (near && (interior(x, y) || (isBody(x, y) && y >= b.eyeY && y <= b.eyeY + 1))) px[y]![x] = palAt(x, y).mask
    }
  }

  // 3. face: big eyes with a catchlight, a little mouth, blush
  const masked = lk.pattern === 'mask'
  const faceOk = (x: number, y: number) => { const c = at(x, y); return c === '#' || c === 'n' || c === 'N' }
  const onFace = (x: number, y: number, c: number) => { if (faceOk(x, y)) px[y]![x] = c }
  const ey = b.eyeY, two = b.eyeW === 2
  for (const side of [0, 1]) {
    const out = side === 0 ? -1 : 1
    const ix = side === 0 ? 7 - b.gap : 8 + b.gap, ox = ix + out
    switch (lk.eyes) {
      case 'tall':
        if (two) { onFace(ox, ey, SHINE); onFace(ix, ey, EYE); onFace(ox, ey + 1, EYE); onFace(ix, ey + 1, EYE) }
        else { onFace(ix, ey, EYE); onFace(ix, ey + 1, EYE) }
        break
      case 'sparkle':
        if (two) { onFace(ox, ey, SHINE); onFace(ix, ey, EYE); onFace(ox, ey + 1, EYE); onFace(ix, ey + 1, high.iris) }
        else { onFace(ix, ey, EYE); onFace(ix, ey + 1, EYE) }
        break
      case 'dot': onFace(ix, ey, EYE); onFace(ix, ey + 1, EYE); break
      case 'sleepy': onFace(ix, ey + 1, EYE); onFace(ox, ey + 1, EYE); break
      case 'fierce':
        onFace(ix, ey, EYE); onFace(ix, ey + 1, EYE)
        if (two) onFace(ox, ey + 1, EYE)
        break
    }
    // a grown-up look at the final stage: a lid over the inner corner of each eye
    if (st === 3 && two && (lk.eyes === 'tall' || lk.eyes === 'sparkle') && isBody(ix, ey - 1)) px[ey - 1]![ix] = palAt(ix, ey - 1).shadow
    if (!masked && (lk.shapeSeed >>> 4) % 4 !== 0 && at(ox, ey + 2) === '#' && !snouted) px[ey + 2]![ox] = BLUSH
  }
  const beak = at(7, ey + 1) === 'b'
  if (!beak && faceOk(7, mouthY) && faceOk(8, mouthY) && !(snouted && at(7, mouthY) !== '#')) {
    const deep = faceOk(7, mouthY + 1) && faceOk(8, mouthY + 1)
    switch (lk.mouth) {
      case 'smile':
        if (deep && b.gap >= 3) { onFace(6, mouthY, LIPS); onFace(9, mouthY, LIPS); onFace(7, mouthY + 1, LIPS); onFace(8, mouthY + 1, LIPS) }
        else { onFace(7, mouthY, LIPS); onFace(8, mouthY, LIPS) }
        break
      case 'fang': onFace(7, mouthY, LIPS); onFace(8, mouthY, LIPS); if (deep) onFace(8, mouthY + 1, SHINE); break
      case 'o': onFace(7, mouthY, MOUTH); onFace(8, mouthY, MOUTH); if (deep) { onFace(7, mouthY + 1, MOUTH); onFace(8, mouthY + 1, MOUTH) } break
    }
  }

  // 4. body trinkets: a scarf at the neck, a gold monocle on one eye
  if (lk.trinket === 'scarf') {
    // round the neck: the first row below the mouth at least six pixels wide, else the widest row below the eyes
    const wide = (y: number) => [...Array(SIZE).keys()].filter(x => isBody(x, y)).length
    let y = b.chin || mouthY + 1
    while (y < bottom && wide(y) < 6) y++
    if (wide(y) < 6) for (let k = ey + 2; k <= bottom; k++) if (wide(k) > wide(y)) y = k
    let r = -1
    for (let x = 0; x < SIZE; x++) if (isBody(x, y)) { px[y]![x] = BAND_RED; r = x }
    if (r > 0) for (const [dy, c] of [[1, BAND_RED], [2, SCARF_DARK]] as const) if (isBody(r - 1, y + dy)) px[y + dy]![r - 1] = c
  } else if (lk.trinket === 'monocle') {
    const ix = 8 + b.gap, ox = ix + b.eyeW - 1
    const ring: [number, number][] = [[ix, ey - 1], [ox, ey - 1], [ox + 1, ey], [ox + 1, ey + 1], [ix, ey + 2], [ox, ey + 2]]
    for (const [x, y] of ring) if (isBody(x, y)) px[y]![x] = GOLD
    if (isBody(ox + 1, ey + 2)) px[ey + 2]![ox + 1] = GOLD_DARK
  }

  // 5. outline everything but the glow and the stalks: lit colour on the top and left, darkest on the bottom and right
  const outPx: Pixels = px.map(r => r.slice())
  const bare = (x: number, y: number) => at(x, y) === 'a' || (b.glow[y]?.[x] ?? false)
  const solid = (x: number, y: number) => (px[y]?.[x] ?? T) !== T && !bare(x, y)
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (px[y]![x] !== T) continue
    const nb = N4.find(([dx, dy]) => solid(x + dx, y + dy))
    if (!nb) continue
    const pal = palAt(x + nb[0], y + nb[1])
    outPx[y]![x] = solid(x, y - 1) || solid(x - 1, y) ? pal.rim : pal.outline
  }

  // 6. sparkles in free corners: two around a Mythic, one twinkle on a shiny (never missing). A sparkle wants a clear
  // 3x3 patch (r 2), else just room for its own five pixels (r 1).
  const free = (x: number, y: number, r: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (Math.abs(dx) + Math.abs(dy) <= r && (outPx[y + dy]?.[x + dx] ?? 0) !== T) return false
    return true
  }
  const star = (x: number, y: number, mid: number, arm: number) => {
    for (const [dx, dy] of N4) outPx[y + dy]![x + dx] = arm
    outPx[y]![x] = mid
  }
  const spots = (corners: readonly [number, number][]) => {
    const list: [number, number, number][] = []
    for (const r of [2, 1]) {
      for (const [x, y] of corners) list.push([x, y, r])
      for (let y = 1; y <= 14; y++) for (let x = 1; x <= 14; x++) list.push([x, y, r])
    }
    return list
  }
  if (mythic) {
    let n = 0
    for (const [x, y, r] of spots([[2, 2], [13, 13], [13, 2], [2, 13]])) if (n < 2 && free(x, y, r)) { star(x, y, MOTE_A, MOTE_B); n++ }
  }
  if (lk.shiny) {
    const [x, y] = spots([[13, 2], [2, 2]]).find(([sx, sy, r]) => free(sx, sy, r)) ?? [-1, -1]
    if (x >= 0) star(x, y, SPARK, GOLD_LIGHT)
    else {
      // no room anywhere: two specks of light on the body, clear of the face
      const specks: [number, number][] = []
      for (const inner of [true, false]) for (let y2 = 0; y2 < SIZE; y2++) for (let x2 = 0; x2 < SIZE; x2++) {
        if ((inner ? interior(x2, y2) : isBody(x2, y2)) && !face(x2, y2) && specks.length < 2) specks.push([x2, y2])
      }
      for (const [x2, y2] of specks) outPx[y2]![x2] = SPARK
    }
  }
  return outPx
}

/** Every opaque pixel in one flat colour: an unseen album entry. */
export function silhouette(px: Pixels, colour = 0x3a3646): Pixels {
  return px.map(r => r.map(c => (c === T ? T : colour)))
}

// ---------- 8x8 minis ----------

/**
 * Shrinks a sprite to a size x size mini that still reads as the creature: peel the thin edge colours (outline,
 * stalks, sparkles), fit the body core into the frame (feet on the floor, centred between the eyes), give each
 * cell the most common colour of its area, mark ears and horns on the top row, then place two eyes symmetrically
 * at least one cell apart and outline again. Works on any pixels.
 */
export function miniSprite(px: Pixels, size = 8): Pixels {
  const H = px.length, W = px[0]?.length ?? 0
  const get = (x: number, y: number) => px[y]?.[x] ?? T
  const open = (x: number, y: number) => get(x, y) === T
  const edge = new Map<number, number>(), count = new Map<number, number>()
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = get(x, y)
    if (c === T) continue
    count.set(c, (count.get(c) ?? 0) + 1)
    if (open(x - 1, y) || open(x + 1, y) || open(x, y - 1) || open(x, y + 1)) edge.set(c, (edge.get(c) ?? 0) + 1)
  }
  // colours that mostly touch the open air are the outline and its kin
  const thin = new Set([...edge].filter(([c, n]) => n >= 0.6 * count.get(c)!).map(([c]) => c))
  // the mini's single outline is the lighter of the big sprite's main rim tones, so it shows on dark terminals
  // and never swallows the eyes
  let outline = T, most = 0
  for (const [c, n] of edge) if (thin.has(c) && n > most) { outline = c; most = n }
  for (const [c, n] of edge) if (thin.has(c) && n >= most / 3 && light(c) > light(outline) && light(c) < 0.5) outline = c
  const fill = (x: number, y: number) => { const c = get(x, y); return c !== T && !thin.has(c) }

  let x0 = W, y0 = H, x1 = -1, y1 = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fill(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
  const mini: Pixels = Array.from({ length: size }, () => Array<number>(size).fill(T))
  if (x1 < 0) return mini
  // fit the core of the body, not its thin wings, tails, legs and antennae: the box of pixels whose four
  // neighbours are all filled, grown back by one
  let cx0 = W, cy0 = H, cx1 = -1, cy1 = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!(fill(x, y) && fill(x - 1, y) && fill(x + 1, y) && fill(x, y - 1) && fill(x, y + 1))) continue
    cx0 = Math.min(cx0, x); cx1 = Math.max(cx1, x); cy0 = Math.min(cy0, y); cy1 = Math.max(cy1, y)
  }
  if (cx1 >= 0) { x0 = Math.max(x0, cx0 - 1); x1 = Math.min(x1, cx1 + 1); y0 = Math.max(y0, cy0 - 1) }

  const isEye = (c: number) => c === EYE
  let eyes = 0, ex = 0, ey = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = get(x, y)
    if (!isEye(c)) continue
    eyes++; ex += x + 0.5; ey += y
  }
  // centre on the eyes, so a tail on one side does not push the face off-centre
  const cx = eyes ? ex / eyes : (x0 + x1 + 1) / 2
  // ears and horns: columns that rise at least two rows above the core
  const ears: number[] = []
  for (let x = x0; x <= x1; x++) if (y0 >= 2 && fill(x, y0 - 1) && fill(x, y0 - 2)) ears.push(x)

  const outlined = outline !== T
  const room = outlined ? size - 2 : size
  const half = Math.max(cx - x0, x1 + 1 - cx)
  const w = half * 2, h = y1 - y0 + 1
  const tall = room - (ears.length ? 1 : 0)
  const s = Math.max(w / room, h / tall, 1)
  const ow = Math.min(room, Math.round(w / s)), oh = Math.min(tall, Math.round(h / s))
  const offX = (size - room) / 2 + Math.floor((room - ow) / 2), offY = (size - room) / 2 + (room - oh)
  // source x of a target column, measured so the result stays mirror-symmetric around the eyes
  const sx = (tx: number) => cx + (tx - ow / 2) * s
  const skip = (c: number) => isEye(c) || c === SHINE
  const tally = new Map<number, number>()
  for (const r of px) for (const c of r) if (c !== T && !thin.has(c) && !skip(c)) tally.set(c, (tally.get(c) ?? 0) + 1)
  let fallback = EYE, fallbackN = 0
  for (const [c, n] of tally) if (n > fallbackN) { fallback = c; fallbackN = n }
  for (let ty = 0; ty < oh; ty++) for (let tx = 0; tx < ow; tx++) {
    const sx0 = sx(tx), sx1 = sx(tx + 1), sy0 = y0 + ty * s, sy1 = y0 + (ty + 1) * s
    const counts = new Map<number, number>()
    let area = 0, solid = 0
    for (let y = Math.floor(sy0); y < Math.ceil(sy1); y++) for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) {
      const a = Math.max(0, Math.min(x + 1, sx1) - Math.max(x, sx0)) * Math.max(0, Math.min(y + 1, sy1) - Math.max(y, sy0))
      if (a <= 0) continue
      area += a
      const c = get(x, y)
      if (c === T || thin.has(c)) continue
      solid += a
      if (!skip(c)) counts.set(c, (counts.get(c) ?? 0) + a)
    }
    if (solid < area * 0.42) continue
    // the creature's main colour wins close calls, so edge shading does not smear the mini
    let best = T, bestN = 0
    for (const [c, n] of counts) if (n * (c === fallback ? 1.6 : 1) > bestN) { best = c; bestN = n * (c === fallback ? 1.6 : 1) }
    mini[offY + ty]![offX + tx] = best === T ? fallback : best
  }
  if (ears.length && offY >= 1 + (outlined ? 1 : 0)) {
    const colour = new Map<number, number>()
    for (const x of ears) for (const y of [y0 - 1, y0 - 2]) { const c = get(x, y); if (!skip(c)) colour.set(c, (colour.get(c) ?? 0) + 1) }
    const c = [...colour.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback
    for (const x of ears) {
      const tx = Math.floor((x + 0.5 - cx) / s + ow / 2)
      if (tx >= 0 && tx < ow && mini[offY]![offX + tx] !== T) mini[offY - 1]![offX + tx] = c
    }
  }

  // eyes: the mean row and spread of the source's eye pixels, mapped and kept symmetric
  if (eyes > 0 && ow >= 3) {
    let spread = 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isEye(get(x, y))) spread += Math.abs(x + 0.5 - cx)
    let my = offY + Math.max(0, Math.min(oh - 1, Math.floor((ey / eyes + 0.5 - y0) / s)))
    const gap = Math.max(ow % 2 ? 1 : 1.5, Math.min(ow / 2 - 0.5, Math.round((spread / eyes) / s - 0.5) + (ow % 2 ? 0 : 0.5)))
    let xl = Math.round(offX + ow / 2 - 0.5 - gap), xr = Math.round(offX + ow / 2 - 0.5 + gap)
    // keep the eyes off the edge of the face, so the outline never swallows them
    while (xr - xl > 3 && (mini[my]![xl - 1] === T || mini[my]![xr + 1] === T)) { xl++; xr-- }
    while (my < offY + oh - 1 && ((mini[my - 1]?.[xl] ?? T) === T || (mini[my - 1]?.[xr] ?? T) === T)) my++
    for (const x of [xl, xr]) if (mini[my]?.[x] !== undefined) mini[my]![x] = EYE
  }
  if (!outlined) return mini
  const out = mini.map(r => r.slice())
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (mini[y]![x] !== T) continue
    if ([mini[y - 1]?.[x], mini[y + 1]?.[x], mini[y]![x - 1], mini[y]![x + 1]].some(c => c !== undefined && c !== T)) out[y]![x] = outline
  }
  return out
}

// ---------- renderers ----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64; no btoa, so it runs anywhere. */
export function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (b === undefined ? '=' : B64[(n >> 6) & 63]!) + (c === undefined ? '=' : B64[n & 63]!)
  }
  return s
}

const DEFAULT = 0x01000000, UPPER_HALF = 0x2580, LOWER_HALF = 0x2584, SPACE = 0x20

export type RasterCells = { columns: number; rows: number; cells: string }

/** Terminal Raster: one cell holds two vertical pixels as half blocks; transparent shows the terminal default. */
export function toRaster(px: Pixels): RasterCells {
  const w = px[0]?.length ?? 0, rows = Math.ceil(px.length / 2)
  const bytes = new Uint8Array(w * rows * 12)
  const view = new DataView(bytes.buffer)
  for (let r = 0; r < rows; r++) for (let c = 0; c < w; c++) {
    const top = px[2 * r]?.[c] ?? T, bot = px[2 * r + 1]?.[c] ?? T
    const cell = top === T && bot === T ? [SPACE, DEFAULT, DEFAULT]
      : top === T ? [LOWER_HALF, bot, DEFAULT]
      : bot === T ? [UPPER_HALF, top, DEFAULT]
      : [UPPER_HALF, top, bot]
    const o = (r * w + c) * 12
    view.setUint32(o, cell[0]!, true)
    view.setUint32(o + 4, cell[1]!, true)
    view.setUint32(o + 8, cell[2]!, true)
  }
  return { columns: w, rows, cells: base64(bytes) }
}

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0')
const light = (c: number) => (Math.max(c >> 16, (c >> 8) & 255, c & 255) + Math.min(c >> 16, (c >> 8) & 255, c & 255)) / 510

/** A crisp SVG; horizontal runs of one colour share a rect. */
export function toSvg(px: Pixels, scale = 8): string {
  const h = px.length, w = px[0]?.length ?? 0
  let rects = ''
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w;) {
      const c = px[y]![x]!
      let run = 1
      while (x + run < w && px[y]![x + run] === c) run++
      if (c !== T) rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${hex(c)}"/>`
      x += run
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges">${rects}</svg>`
}

// ---------- emoji mosaic ----------

export const MOSAIC = { red: '🟥', orange: '🟧', yellow: '🟨', green: '🟩', blue: '🟦', purple: '🟪', brown: '🟫', black: '⬛', white: '⬜' }

/** The nearest square emoji for a colour, by hue band so muted pastels keep their family colour. */
export function emojiFor(c: number): string {
  if (c === T) return MOSAIC.white
  const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min
  if (l < 0.2 || (d < 0.12 && l < 0.45)) return MOSAIC.black
  if (d < 0.12 || l > 0.9) return MOSAIC.white
  const h = ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360
  if ((h < 45 || h >= 345) && l < 0.42) return MOSAIC.brown
  if (h < 15 || h >= 335) return MOSAIC.red
  if (h < 42) return l < 0.45 ? MOSAIC.brown : MOSAIC.orange
  if (h < 70) return MOSAIC.yellow
  if (h < 165) return MOSAIC.green
  if (h < 255) return MOSAIC.blue
  return MOSAIC.purple
}

/** An emoji mosaic, one line per row. Transparent is white so the dark outline frames the creature. */
export function emojiMosaic(px: Pixels): string {
  return px.map(row => row.map(emojiFor).join('')).join('\n')
}
