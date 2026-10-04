// Species generator 2 as shipped in v0.2.2. New generations get new modules; this one never retunes.
import type { Accessory, Body, Family, Pattern, Species, Stats } from '../types.ts'
import { speciesNames } from './v2-names.ts'

const FAMILIES: readonly Family[] = ['haiku', 'sonnet', 'opus', 'fable']
const BODIES: readonly Body[] = ['blob', 'critter', 'bird', 'ghost', 'bug', 'wyrm']
const PATTERNS: readonly Pattern[] = ['none', 'spots', 'stripes', 'belly', 'mask']
const ACCESSORIES: readonly Accessory[] = ['horns', 'crown', 'antennae', 'halo', 'spikes', 'wings']
const FAMILIES_V2: Record<Family, { hue: [number, number]; bias: Stats }> = {
  haiku: { hue: [85, 165], bias: { hp: 24, atk: 26, def: 18, spd: 32 } },
  sonnet: { hue: [190, 255], bias: { hp: 28, atk: 26, def: 24, spd: 22 } },
  opus: { hue: [345, 40], bias: { hp: 34, atk: 30, def: 24, spd: 12 } },
  fable: { hue: [260, 320], bias: { hp: 26, atk: 28, def: 22, spd: 24 } },
}
const BLOCKED_WORDS = [
  'fuck', 'shit', 'cunt', 'bitch', 'dick', 'cock', 'piss', 'slut', 'whore', 'twat', 'wank', 'tits', 'porn', 'rape',
  'nazi', 'fag', 'nigg', 'anus', 'penis', 'vagin', 'boob', 'butt', 'poop', 'turd', 'damn', 'hell',
  'pikachu', 'pokemon', 'digimon', 'eevee', 'mewtwo', 'snorlax', 'gengar', 'jigglypuff', 'charizard', 'bulbasaur',
  'squirtle', 'mario', 'luigi', 'zelda', 'kirby', 'yoshi', 'sonic', 'totoro', 'groot', 'yoda', 'grogu', 'shrek',
  'stitch', 'elmo', 'simba', 'nemo', 'gollum', 'smaug', 'hobbit', 'godzilla', 'mothra', 'gundam', 'inkling',
  'twiglet', 'furby', 'tamagotchi', 'moomin', 'pusheen', 'gremlin', 'muppet', 'smurf', 'minion', 'ewok', 'wookie',
] as const

function rngFromSeed(seed: string): () => number {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i)
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
  let a = h1 >>> 0, b = h2 >>> 0, c = h3 >>> 0, d = h4 >>> 0
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

function baseStats(family: Family, jitter: readonly number[], mult = 1): Stats {
  const b = FAMILIES_V2[family].bias
  const r = (v: number) => Math.round(v * mult * 100) / 100
  return {
    hp: r(20 + (b.hp + jitter[0]!)), atk: r(4 + (b.atk + jitter[1]!) / 2),
    def: r(3 + (b.def + jitter[2]!) / 2), spd: r(1 + (b.spd + jitter[3]!) / 2),
  }
}

function hueAt(family: Family, t: number): number {
  const [from, to] = FAMILIES_V2[family].hue
  return (from + t * ((to - from + 360) % 360)) % 360
}

function speciesNameLine(seed: string, family: Family, legendary: boolean, taken: Iterable<string>): [string, string, string] {
  const t = [...taken]
  for (let i = 0; i < 4; i++) {
    const line = speciesNames(seed, family, legendary, t)
    const bad = line.filter(name => {
      const n = name.toLowerCase()
      return /(.)\1\1/.test(n) || BLOCKED_WORDS.some(w => n.includes(w))
    })
    if (!bad.length) return [...line]
    t.push(...bad)
  }
  throw new Error('Every name the generator offered is blocked')
}

type Draft = { seed: string; rng: () => number; body: Body; hue: number; pattern: Pattern; accessory: Accessory; jitter: number[] }

export function generateSeasonV2(season: number): Species[] {
  if (!Number.isInteger(season) || season < 1 || season > 9999) throw new RangeError('Bad season')
  const out: Species[] = []
  const taken: string[] = []
  for (const family of FAMILIES) {
    const drafts: Draft[] = []
    for (let index = 0; index < 9; index++) {
      const seed = `spinlings/season/${season}/${family}/${index}`
      const rng = rngFromSeed(seed)
      const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)]!
      drafts.push({
        seed, rng, body: pick(BODIES), hue: Math.round(hueAt(family, 0.08 + 0.84 * rng())),
        pattern: pick(PATTERNS), accessory: pick(ACCESSORIES),
        jitter: [0, 0, 0, 0].map(() => -8 + Math.floor(rng() * 17)),
      })
    }
    const regular = drafts.slice(0, 8)
    for (let i = 7; i >= 0 && new Set(regular.map(d => d.body)).size < 5; i--) {
      const body = regular[i]!.body
      if (regular.findIndex(d => d.body === body) === i) continue
      regular[i]!.body = BODIES.find(b => !regular.some(d => d.body === b))!
    }
    drafts[8]!.accessory = drafts[8]!.rng() < 0.5 ? 'crown' : 'halo'
    drafts.forEach((d, index) => {
      const legendary = index === 8
      const names = speciesNameLine(d.seed, family, legendary, taken)
      taken.push(...names)
      out.push({
        id: `s${season}-${family}-${index}`, season, index, family,
        body: d.body, hue: d.hue, pattern: d.pattern, accessory: d.accessory,
        base: baseStats(family, d.jitter, legendary ? 1.15 : 1), names, legendary,
      })
    })
  }
  return out
}
