// Creature parts. Every species, fusion and Mythic is assembled from a torso archetype (the six Body values)
// plus head, ears, wings, tail, legs, arms and muzzle, all picked deterministically from a seed string.
// Each evolution grows the same parts. Pure data: sprite.ts draws them.
import type { Body, Rng } from './types.ts'
import { rngFromSeed, weighted } from './rng.ts'

export type Head = 'merged' | 'round' | 'wide' | 'small'
export type Ears = 'none' | 'pointy' | 'round' | 'long' | 'floppy' | 'nubs' | 'antennae' | 'crest' | 'tuft' | 'sprout' | 'fins'
export type Wings = 'none' | 'small' | 'large' | 'leaf' | 'bat'
export type Tail = 'none' | 'curl' | 'spike' | 'fluffy' | 'fin'
export type Legs = 'none' | 'stubby' | 'long' | 'many'
export type Arms = 'none' | 'nubs' | 'wave'
export type Muzzle = 'none' | 'snout' | 'beak'

export const HEADS: readonly Head[] = ['merged', 'round', 'wide', 'small']
export const EARS: readonly Ears[] = ['none', 'pointy', 'round', 'long', 'floppy', 'nubs', 'antennae', 'crest', 'tuft', 'sprout', 'fins']
export const WINGS: readonly Wings[] = ['none', 'small', 'large', 'leaf', 'bat']
export const TAILS: readonly Tail[] = ['none', 'curl', 'spike', 'fluffy', 'fin']
export const LEGS: readonly Legs[] = ['none', 'stubby', 'long', 'many']
export const ARMS: readonly Arms[] = ['none', 'nubs', 'wave']
export const MUZZLES: readonly Muzzle[] = ['none', 'snout', 'beak']

export type Parts = {
  torso: Body
  /** torso half-width and height in pixels; widths may be fractional, rows are rounded */
  tw: number
  th: number
  /** superellipse exponent of the torso: 2 is round, 3.5 is boxy */
  round: number
  /** > 0 widens the torso toward the bottom, < 0 toward the top */
  taper: number
  /** 0..1, how flat the torso's bottom is */
  flat: number
  head: Head
  hw: number
  hh: number
  ears: Ears
  /** 1..3 */
  earSize: number
  wings: Wings
  tail: Tail
  /** 1..3 */
  tailSize: number
  legs: Legs
  arms: Arms
  muzzle: Muzzle
  /** eye distance from the centre line, 1..3 */
  eyeGap: number
  /** the side the tail grows on and antennae lean toward */
  side: 1 | -1
  /** a lively asymmetry: one antenna, ear or tuft bends */
  tilt: boolean
}

type W<T> = readonly (readonly [T, number])[]
type Arch = {
  tw: [number, number]; th: [number, number]; round: [number, number]; taper: [number, number]; flat: [number, number]
  head: W<Head>; ears: W<Ears>; wings: W<Wings>; tail: W<Tail>; legs: W<Legs>; arms: W<Arms>; muzzle: W<Muzzle>
}

// Each archetype leans toward its own parts but can grow almost any of them, so silhouettes stay varied.
const ARCH: Record<Body, Arch> = {
  blob: {
    tw: [4.5, 6], th: [7, 9], round: [2, 2.4], taper: [0, 0.12], flat: [0.4, 0.8],
    head: [['merged', 9], ['round', 1]],
    ears: [['none', 3], ['pointy', 2], ['round', 3], ['long', 1], ['antennae', 2], ['tuft', 2], ['sprout', 3], ['nubs', 1], ['crest', 1], ['fins', 1]],
    wings: [['none', 7], ['small', 2], ['leaf', 2], ['bat', 1]],
    tail: [['none', 6], ['curl', 1], ['fluffy', 1], ['spike', 1]],
    legs: [['none', 4], ['stubby', 6], ['many', 1]],
    arms: [['none', 6], ['nubs', 2], ['wave', 2]],
    muzzle: [['none', 9], ['snout', 1]],
  },
  critter: {
    tw: [3, 4.5], th: [3, 5], round: [2, 2.6], taper: [0, 0.2], flat: [0.3, 0.6],
    head: [['round', 5], ['wide', 4], ['small', 1]],
    ears: [['pointy', 5], ['round', 4], ['long', 3], ['floppy', 3], ['nubs', 1], ['tuft', 1], ['fins', 1]],
    wings: [['none', 9], ['small', 1], ['bat', 1]],
    tail: [['curl', 4], ['fluffy', 4], ['spike', 2], ['none', 1]],
    legs: [['stubby', 6], ['long', 3]],
    arms: [['none', 6], ['nubs', 2], ['wave', 2]],
    muzzle: [['none', 5], ['snout', 4]],
  },
  bird: {
    tw: [3.5, 5], th: [6, 8], round: [2, 2.3], taper: [0.05, 0.2], flat: [0, 0.3],
    head: [['merged', 6], ['round', 3], ['small', 2]],
    ears: [['crest', 5], ['tuft', 4], ['none', 2], ['antennae', 1], ['pointy', 1]],
    wings: [['small', 4], ['large', 4], ['leaf', 2], ['none', 1]],
    tail: [['none', 4], ['fin', 3], ['spike', 1]],
    legs: [['long', 6], ['stubby', 3]],
    arms: [['none', 1]],
    muzzle: [['beak', 9], ['none', 1]],
  },
  ghost: {
    tw: [4, 5.5], th: [8, 10], round: [2, 2.3], taper: [0, 0.12], flat: [0.6, 0.9],
    head: [['merged', 1]],
    ears: [['none', 4], ['nubs', 2], ['tuft', 3], ['pointy', 3], ['fins', 1], ['crest', 1]],
    wings: [['none', 6], ['bat', 3], ['small', 1]],
    tail: [['curl', 3], ['none', 3]],
    legs: [['none', 1]],
    arms: [['nubs', 3], ['wave', 4], ['none', 3]],
    muzzle: [['none', 1]],
  },
  bug: {
    tw: [3.5, 5], th: [4, 6], round: [2, 2.4], taper: [0, 0.2], flat: [0, 0.4],
    head: [['round', 4], ['small', 3], ['wide', 2], ['merged', 2]],
    ears: [['antennae', 9], ['nubs', 2], ['crest', 1], ['round', 1]],
    wings: [['leaf', 4], ['large', 2], ['small', 3], ['none', 3]],
    tail: [['none', 7], ['spike', 2]],
    legs: [['many', 9], ['long', 1]],
    arms: [['none', 4], ['nubs', 1]],
    muzzle: [['none', 1]],
  },
  wyrm: {
    tw: [3.5, 4.5], th: [5, 7], round: [2, 2.3], taper: [0.1, 0.3], flat: [0, 0.3],
    head: [['wide', 5], ['round', 4]],
    ears: [['nubs', 4], ['crest', 3], ['fins', 4], ['pointy', 2]],
    wings: [['none', 5], ['bat', 4], ['small', 1]],
    tail: [['spike', 4], ['curl', 3], ['fin', 3]],
    legs: [['none', 7], ['stubby', 2]],
    arms: [['none', 2], ['nubs', 2]],
    muzzle: [['snout', 4], ['none', 4]],
  },
}

const span = (rng: Rng, [lo, hi]: [number, number]) => lo + (hi - lo) * rng()
const half = (v: number) => Math.round(v * 2) / 2

/** The stage-1 parts grown from a seed: a species id, or a fusion's or Mythic's own seed. */
export function partsFor(seed: string, torso: Body): Parts {
  const a = ARCH[torso] ?? ARCH.blob
  const rng = rngFromSeed('parts/' + seed)
  const head = weighted(rng, a.head)
  const hw = half(head === 'wide' ? 5 + rng() * 0.5 : head === 'small' ? 3.5 + rng() * 0.5 : 4 + rng())
  const hh = Math.round(head === 'wide' ? 4 + rng() : head === 'small' ? 4 + rng() : 5 + rng())
  const p: Parts = {
    torso,
    tw: half(span(rng, a.tw)),
    th: Math.round(span(rng, a.th)),
    round: span(rng, a.round),
    taper: span(rng, a.taper),
    flat: span(rng, a.flat),
    head, hw, hh,
    ears: weighted(rng, a.ears),
    earSize: 1 + Math.floor(rng() * 2.4),
    wings: weighted(rng, a.wings),
    tail: weighted(rng, a.tail),
    tailSize: 1 + Math.floor(rng() * 2),
    legs: weighted(rng, a.legs),
    arms: weighted(rng, a.arms),
    muzzle: weighted(rng, a.muzzle),
    eyeGap: 1 + Math.floor(rng() * 2.6),
    side: rng() < 0.5 ? 1 : -1,
    tilt: rng() < 0.45,
  }
  // a merged head keeps the face on the torso, which then needs the height and a domed top
  if (head === 'merged') {
    p.th = Math.max(p.th, 7)
    p.tw = Math.max(p.tw, 4)
    p.round = Math.max(p.round, 2.3)
    p.taper = Math.min(p.taper, 0.12)
  }
  if (torso === 'wyrm') p.tailSize = 2 + Math.floor(rng() * 2)
  return p
}

/** Each evolution keeps every part and grows it: a bigger torso and head, longer ears and tail, bigger wings. */
export function grow(p: Parts): Parts {
  return {
    ...p,
    tw: Math.min(6, p.tw + 0.5),
    th: p.th + (p.head === 'merged' ? 2 : 1),
    hw: Math.min(6, p.hw + 0.5),
    hh: p.hh + 1,
    earSize: Math.min(3, p.earSize + 1),
    wings: p.wings === 'small' ? 'large' : p.wings,
    tailSize: Math.min(3, p.tailSize + 1),
    legs: p.legs === 'stubby' && p.torso === 'critter' ? 'long' : p.legs,
  }
}

/** Legendaries and Mythics: the largest version of every part, and always winged or tailed. */
export function exalt(p: Parts): Parts {
  return {
    ...p,
    tw: Math.max(p.tw, 5),
    th: p.th + 1,
    hw: Math.max(p.hw, 4.5),
    earSize: 3,
    wings: p.wings === 'small' || (p.wings === 'none' && p.tail === 'none') ? 'large' : p.wings,
    tailSize: 3,
  }
}

/** Parts of a fusion: parent A's torso, legs and tail with parent B's head-top, wings and muzzle. */
export function hybrid(a: Parts, b: Parts): Parts {
  return { ...a, ears: b.ears, earSize: b.earSize, wings: b.wings, muzzle: a.torso === 'bird' ? a.muzzle : b.muzzle === 'beak' ? 'none' : b.muzzle, eyeGap: b.eyeGap }
}
