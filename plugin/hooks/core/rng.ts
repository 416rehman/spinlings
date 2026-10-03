// Seeded hashing and randomness. Everything random in the game flows through an Rng built here.
import type { Rng } from './types.ts'

/** cyrb128: four 32-bit words from a string. Stable across every JS engine. */
export function hash128(s: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1; h3 ^= h1; h4 ^= h1
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
}

/** A uint32 hash of a string. */
export function hashString(s: string): number {
  return hash128(s)[0]
}

/** sfc32 seeded from the 128-bit hash of `seed`; returns uniform floats in [0, 1). */
export function rngFromSeed(seed: string | number): Rng {
  let [a, b, c, d] = hash128(String(seed))
  const next = (): number => {
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
  for (let i = 0; i < 12; i++) next()
  return next
}

/** Integer in [0, n). */
export function int(rng: Rng, n: number): number {
  return Math.floor(rng() * n)
}

/** Integer in [lo, hi], both inclusive. */
export function between(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1))
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p
}

export function uint32(rng: Rng): number {
  return Math.floor(rng() * 4294967296) >>> 0
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick from an empty list')
  return items[Math.floor(rng() * items.length)]!
}

/** Picks by weight; weights need not sum to 1. Order of `entries` is part of the draw. */
export function weighted<T>(rng: Rng, entries: readonly (readonly [T, number])[]): T {
  let total = 0
  for (const [, w] of entries) total += w
  let r = rng() * total
  for (const [value, w] of entries) {
    if (r < w) return value
    r -= w
  }
  return entries[entries.length - 1]![0]
}

/** A shuffled copy (Fisher-Yates). */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = out[i]!
    out[i] = out[j]!
    out[j] = t
  }
  return out
}
