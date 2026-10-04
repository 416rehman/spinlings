// Season species: 8 regular + 1 legendary per family, all derived from the season number, plus the forms that live
// on cards themselves (fusions, Mythics and promos).
import type { Accessory, Body, Card, CardForm, CardFormKind, Family, Form, Pattern, Species, Stats } from './types.ts'
import { ECONOMY } from './economy.ts'
import { FAMILIES, FAMILY_INFO } from './families.ts'
import { between } from './rng.ts'
import { generateSeason } from './generators/index.ts'

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

const cache = new Map<string, readonly Species[]>()
/** One world's frozen species. Callers own it; generated offline species never read another world's catalog. */
export type SeasonCatalog = ReadonlyMap<number, readonly Species[]>

/** The season's 36 species: for each family in FAMILIES order, indexes 0..7 regular then 8 legendary. */
export function seasonSpecies(season: number, catalog?: SeasonCatalog, generator = GENERATOR_VERSION): readonly Species[] {
  if (!Number.isInteger(season) || season < 1 || season > 9999) throw new RangeError(`bad season ${season}`)
  const key = `${generator}/${season}`
  let list = catalog?.get(season) ?? cache.get(key)
  if (!list) {
    if (cache.size >= 16) cache.clear()
    list = deepFreeze(generateSeason(season, generator))
    cache.set(key, list)
  }
  return list
}

/**
 * Installs a season frozen by the server (GET /v1/season/{n}, already validated), so online cards render from the
 * server's species. The explicit catalog belongs to one origin or database. Returns false for a bad list.
 */
export function installSeason(season: number, species: readonly Species[], catalog: Map<number, readonly Species[]>): boolean {
  const ok = species.length === 36 && species.every((s, i) =>
    s.season === season && s.index === i % 9 && s.family === FAMILIES[Math.floor(i / 9)] && s.id === speciesId(season, s.family, s.index))
  if (ok) catalog.set(season, deepFreeze(structuredCopy(species)))
  return ok
}

function structuredCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export function familySpecies(season: number, family: Family, catalog?: SeasonCatalog): readonly Species[] {
  return seasonSpecies(season, catalog).filter(s => s.family === family)
}

export function legendaryOf(season: number, family: Family, catalog?: SeasonCatalog): Species {
  return seasonSpecies(season, catalog).find(s => s.family === family && s.legendary)!
}

export function getSpecies(id: string, catalog?: SeasonCatalog): Species | undefined {
  const m = SPECIES_ID.exec(id)
  if (!m) return undefined
  return seasonSpecies(Number(m[1]), catalog).find(s => s.id === id)
}

/** The form behind a card: its season species, or its own embedded form. Throws on an unknown species. */
export function formOf(card: Pick<Card, 'species' | 'form' | 'appearance'>, catalog?: SeasonCatalog): Form | CardForm {
  if (isFormKind(card.species)) {
    if (!card.form) throw new Error(`${card.species} card without its form`)
    return card.form
  }
  const s = card.appearance ?? getSpecies(card.species, catalog)
  if (!s) throw new Error(`unknown species ${card.species}`)
  return s
}

/** Binds a card's look to its world, without changing the authoritative stats or the wire's embedded form. */
export function resolveCard<T extends Pick<Card, 'species' | 'form' | 'appearance' | 'parentForms'>>(card: T, catalog: SeasonCatalog): T {
  if (!isFormKind(card.species)) {
    const appearance = getSpecies(card.species, catalog)
    return appearance ? { ...card, appearance } : card
  }
  const parents = card.form?.parents
  return parents ? { ...card, parentForms: parents.map(id => getSpecies(id, catalog) ?? null) as [Form | null, Form | null] } : card
}

/** Restores transient card appearance after a schema read, including nested battles, profiles and ceremonies. */
export function resolveCards<T>(value: T, catalog: SeasonCatalog): T {
  if (Array.isArray(value)) return value.map(item => resolveCards(item, catalog)) as T
  if (!value || typeof value !== 'object') return value
  const obj = value as Record<string, unknown>
  const next = Object.fromEntries(Object.entries(obj).map(([key, item]) =>
    [key, key === 'appearance' || key === 'parentForms' ? item : resolveCards(item, catalog)]))
  return typeof obj.species === 'string' && typeof obj.id === 'string' && Array.isArray(obj.genes) && obj.stats
    ? resolveCard(next as unknown as Card, catalog) as T : next as T
}

/** Final-form creatures (legendaries, Mythics, legendary promos) are always stage 3 and never evolve. */
export function isFinalForm(card: Pick<Card, 'species' | 'form' | 'appearance'>, catalog?: SeasonCatalog): boolean {
  return formOf(card, catalog).legendary
}
