// Season species: 8 regular + 1 legendary per family, all derived from the season number, plus the forms that live
// on cards themselves (fusions, Mythics and promos).
import type { Accessory, Body, Card, CardForm, CardFormKind, Family, Form, Pattern, Species, Stats } from './types.ts'
import { ECONOMY } from './economy.ts'
import { FAMILIES, FAMILY_INFO, hueAt } from './families.ts'
import { between, int, rngFromSeed } from './rng.ts'
import { speciesNameLine } from './naming.ts'

export { isBlocked } from './naming.ts'

/** The species generator's version (SPEC section 32). Bump it, append-only, whenever generated species change. */
export const GENERATOR_VERSION = 2

export const BODIES: readonly Body[] = ['blob', 'critter', 'bird', 'ghost', 'bug', 'wyrm']
export const PATTERNS: readonly Pattern[] = ['none', 'spots', 'stripes', 'belly', 'mask']
export const ACCESSORIES: readonly Accessory[] = ['horns', 'crown', 'antennae', 'halo', 'spikes', 'wings']
export const FORM_KINDS: readonly CardFormKind[] = ['fusion', 'mythic', 'promo']

export const SPECIES_ID = /^s([1-9]\d{0,3})-(haiku|sonnet|opus|fable)-([0-8])$/

export function speciesId(season: number, family: Family, index: number): string {
  return `s${season}-${family}-${index}`
}

/** True for card species values that carry an embedded form: 'fusion', 'mythic' and 'promo'. */
export function isFormKind(species: string): species is CardFormKind {
  return (FORM_KINDS as readonly string[]).includes(species)
}

/** Base stats from the family's bias, per-stat jitter and a multiplier (1.15 for legendaries). */
export function baseStats(family: Family, jitter: readonly number[], mult = 1): Stats {
  const b = FAMILY_INFO[family].bias
  const r = (v: number) => Math.round(v * mult * 100) / 100
  return {
    hp: r(20 + (b.hp + jitter[0]!)),
    atk: r(4 + (b.atk + jitter[1]!) / 2),
    def: r(3 + (b.def + jitter[2]!) / 2),
    spd: r(1 + (b.spd + jitter[3]!) / 2),
  }
}

export function statJitter(rng: () => number): number[] {
  return [0, 0, 0, 0].map(() => between(rng, -ECONOMY.stats.jitter, ECONOMY.stats.jitter))
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k])
    Object.freeze(v)
  }
  return v
}

type Draft = { seed: string; rng: () => number; body: Body; hue: number; pattern: Pattern; accessory: Accessory; jitter: number[] }

function generate(season: number): Species[] {
  const out: Species[] = []
  const taken: string[] = []
  for (const family of FAMILIES) {
    const drafts: Draft[] = []
    for (let index = 0; index < 9; index++) {
      const seed = `spinlings/season/${season}/${family}/${index}`
      const rng = rngFromSeed(seed)
      drafts.push({
        seed,
        rng,
        body: BODIES[int(rng, BODIES.length)]!,
        hue: Math.round(hueAt(family, 0.08 + 0.84 * rng())),
        pattern: PATTERNS[int(rng, PATTERNS.length)]!,
        accessory: ACCESSORIES[int(rng, ACCESSORIES.length)]!,
        jitter: statJitter(rng),
      })
    }
    // At least 5 bodies among the 8 regulars: later duplicates give way to unused bodies, in order.
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
        id: speciesId(season, family, index), season, index, family,
        body: d.body, hue: d.hue, pattern: d.pattern, accessory: d.accessory,
        base: baseStats(family, d.jitter, legendary ? ECONOMY.stats.legendaryBase : 1), names, legendary,
      })
    })
  }
  return out
}

const cache = new Map<number, readonly Species[]>()
const installed = new Map<number, readonly Species[]>()

/** The season's 36 species: for each family in FAMILIES order, indexes 0..7 regular then 8 legendary. */
export function seasonSpecies(season: number): readonly Species[] {
  if (!Number.isInteger(season) || season < 1 || season > 9999) throw new RangeError(`bad season ${season}`)
  let list = installed.get(season) ?? cache.get(season)
  if (!list) {
    if (cache.size >= 16) cache.clear()
    list = deepFreeze(generate(season))
    cache.set(season, list)
  }
  return list
}

/**
 * Installs a season frozen by the server (GET /v1/season/{n}, already validated), so online cards render from the
 * server's species even when its generator version differs from this one. Returns false for a bad list.
 */
export function installSeason(season: number, species: readonly Species[]): boolean {
  const ok = species.length === 36 && species.every((s, i) =>
    s.season === season && s.index === i % 9 && s.family === FAMILIES[Math.floor(i / 9)] && s.id === speciesId(season, s.family, s.index))
  if (ok) installed.set(season, deepFreeze(structuredCopy(species)))
  return ok
}

function structuredCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export function familySpecies(season: number, family: Family): readonly Species[] {
  return seasonSpecies(season).filter(s => s.family === family)
}

export function legendaryOf(season: number, family: Family): Species {
  return seasonSpecies(season).find(s => s.family === family && s.legendary)!
}

export function getSpecies(id: string): Species | undefined {
  const m = SPECIES_ID.exec(id)
  if (!m) return undefined
  return seasonSpecies(Number(m[1])).find(s => s.id === id)
}

/** The form behind a card: its season species, or its own embedded form. Throws on an unknown species. */
export function formOf(card: Pick<Card, 'species' | 'form'>): Form | CardForm {
  if (isFormKind(card.species)) {
    if (!card.form) throw new Error(`${card.species} card without its form`)
    return card.form
  }
  const s = getSpecies(card.species)
  if (!s) throw new Error(`unknown species ${card.species}`)
  return s
}

/** Final-form creatures (legendaries, Mythics, legendary promos) are always stage 3 and never evolve. */
export function isFinalForm(card: Pick<Card, 'species' | 'form'>): boolean {
  return formOf(card).legendary
}
