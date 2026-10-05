// Where the site's creatures come from, and the honesty rules that bind them (site brief 2.6). Shared
// by the server (postcards, og:images, the no-script scene) and the client bundle, so a postcard link
// always shows the very creature its sender met.
//   Regulars: 8 creatures of no season, 2 per family, minted like promo forms. They stand in the hero,
//     run round the type wheel and fill thin pools. They never appear in the album.
//   The revealed pool: this season's regular species somebody has found, plus today's featured
//     species; a family with fewer than 2 gets its regulars. Legendaries only once found.
//   Never on the site: Mythics, the weekly roamer, colour art of an unfound species, finders' handles.
import { fuse, mintBase } from '../../plugin/hooks/core/cards.ts'
import { promoForm } from '../../plugin/hooks/core/drops.ts'
import { ECONOMY } from '../../plugin/hooks/core/economy.ts'
import { FAMILIES, FAMILY_INFO, beatenBy } from '../../plugin/hooks/core/families.ts'
import { hashString, pick, rngFromSeed, shuffle, uint32, weighted } from '../../plugin/hooks/core/rng.ts'
import { resolveCard } from '../../plugin/hooks/core/species.ts'
import type { BattleCard, CardForm, DailyRule, Family, Rarity, Rng, Species } from '../../plugin/hooks/core/types.ts'
import { featuredSpecies, seasonStart, utcDay } from '../../plugin/hooks/core/world.ts'

export const HOURS = ['morning', 'afternoon', 'dusk', 'night'] as const
export type Hour = (typeof HOURS)[number]
/** Each hour of the day belongs to a family. */
export const HOUR_FAMILY: Record<Hour, Family> = { morning: 'haiku', afternoon: 'opus', dusk: 'fable', night: 'sonnet' }

/** The battle band's arena at night, as the terminal band draws it: sky, ground and ridge per family. */
export const ARENA: Record<Family, [string, string, string]> = {
  haiku: ['#0e2620', '#1f5a45', '#2f7d5f'],
  sonnet: ['#0f1a36', '#1d3570', '#2f54a6'],
  opus: ['#26120d', '#6a2a17', '#9a4426'],
  fable: ['#1a1133', '#3a2262', '#5e3d9a'],
}

/** The hour of a local clock hour (0-23): morning 5-10, afternoon 11-16, dusk 17-20, night 21-4. */
export const hourAt = (h: number): Hour => (h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'dusk' : 'night')

/** `{yyyymmdd}-{hour}-{8 chars of a-z2-7}` */
export const SEED_RE = /^(\d{4})(\d{2})(\d{2})-(morning|afternoon|dusk|night)-([a-z2-7]{8})$/
/** The shape of an entryKey (a species id, or a regular's `family/index`), as a postcard link carries it in `?e=`. */
export const ENTRY_RE = /^[a-z0-9/-]{1,24}$/

/** What the page knows about today, embedded in data-world (site brief 2.7). */
export type SiteWorld = {
  /** the server's clock when the page was made, ms */
  now: number
  day: string
  season: number
  rule: DailyRule
  featured: string
  /**
   * This season's species somebody has found. No first find carries its day: a find's day is its
   * card's mint day, which nobody else may learn (SPEC 20.3).
   */
  found: string[]
  /** those first found on `day` itself, which a meeting on `day` does not draw from yet */
  foundToday: string[]
  /** the season's 36 species as the server froze them */
  species: Species[]
  /** the 8 regulars: haiku 0, haiku 1, sonnet 0, ... */
  regulars: CardForm[]
}

const CATALOGS = new WeakMap<SiteWorld, Map<number, readonly Species[]>>()

/** A page's own frozen species, shared by its meetings, restores and fusions. */
export function catalogFor(w: SiteWorld): Map<number, readonly Species[]> {
  let catalog = CATALOGS.get(w)
  if (!catalog) {
    catalog = new Map([[w.season, w.species]])
    CATALOGS.set(w, catalog)
  }
  return catalog
}

export const regularSeed = (f: Family, i: number) => `spinlings/site/regular/${f}/${i}`

/** A regular's form; its names come from the server (core/naming.ts), never from here. */
export function regularForm(f: Family, i: number, names: [string, string, string]): CardForm {
  const { stamp: _stamp, ...form } = promoForm({ seed: regularSeed(f, i), name: names[0], family: f, rarity: 'common', foil: false, stamp: '' })
  return { ...form, names }
}

export const regularOf = (w: Pick<SiteWorld, 'regulars'>, f: Family, i: number): CardForm => w.regulars[FAMILIES.indexOf(f) * 2 + (i % 2)]!

export type Entry = { species: Species } | { form: CardForm }

const noonOf = (day: string) => Date.parse(day + 'T12:00:00Z')

/** The featured species on a day of the world's season. */
export const featuredOn = (w: SiteWorld, day: string) => (day === w.day ? w.featured : featuredSpecies(noonOf(day), catalogFor(w)))

/**
 * A family's revealed regular species: found ones and the featured one, topped up with the family's
 * regulars while there are fewer than 2. With `day`, the pool a meeting on that day draws from: what
 * was found before the world's own day (it leaves out foundToday). An earlier day draws from that same
 * pool, never from what was found before it, which would date every first find (SPEC 20.3); what
 * it met then is kept by a pinned entry (meet).
 */
export function pool(w: SiteWorld, family: Family, day?: string): Entry[] {
  const found = new Set(w.found)
  if (day !== undefined) for (const id of w.foundToday) found.delete(id)
  const featured = featuredOn(w, day ?? w.day)
  const out: Entry[] = w.species.filter(s => s.family === family && !s.legendary && (found.has(s.id) || s.id === featured)).map(s => ({ species: s }))
  if (out.length < 2) for (const i of [0, 1]) out.push({ form: regularOf(w, family, i) })
  return out
}

/** Whether anyone has found this species this season. */
export const isFound = (w: SiteWorld, id: string) => w.found.includes(id)

/** A pool entry as a short key the visitor's browser keeps beside its seed: a species id, or a regular's family and index. */
export const entryKey = (w: Pick<SiteWorld, 'regulars'>, e: Entry): string =>
  'species' in e ? e.species.id : `${e.form.family}/${w.regulars.indexOf(e.form) % 2}`

/**
 * The entry a kept key names, if a meeting on `day` could have drawn it: a regular, that day's
 * featured species, or a regular species somebody has found. Anything else (an edited key) is null,
 * so a kept key never shows the colours of a species nobody has found.
 */
export function entryOf(w: SiteWorld, key: string, day: string): Entry | null {
  const r = /^(haiku|sonnet|opus|fable)\/([01])$/.exec(key)
  if (r) return { form: regularOf(w, r[1] as Family, Number(r[2])) }
  const s = w.species.find(x => x.id === key && !x.legendary)
  return s && (w.found.includes(s.id) || s.id === featuredOn(w, day)) ? { species: s } : null
}

export type SiteCard = BattleCard & { xp: number }

/** The den's hybrid keeps this page's species names and parent forms after the fusion names load. */
export function fuseSite(w: SiteWorld, a: SiteCard, b: SiteCard, rng: Rng): SiteCard {
  const catalog = catalogFor(w)
  return resolveCard({ ...fuse(a, b, rng, w.now, catalog), id: 'hybrid' }, catalog)
}

export type CardOptions = { rarity: Rarity; shiny: boolean; foil: boolean; dna: number; level?: number; xp?: number; id?: string }

/** A card for a pool entry, minted exactly as the game mints (genes, traits and stats from DNA). */
export function siteCard(w: Pick<SiteWorld, 'season' | 'now'>, e: Entry, o: CardOptions): SiteCard {
  const common = { rarity: o.rarity, shiny: o.shiny, foil: o.foil, dna: o.dna, now: w.now, level: o.level ?? 1, xp: o.xp ?? 0 }
  const c = 'species' in e
    ? mintBase({ ...common, species: e.species.id, appearance: e.species, season: e.species.season, family: e.species.family, legendary: e.species.legendary, origin: 'catch' })
    : mintBase({ ...common, species: 'promo', form: e.form, season: w.season, family: e.form.family, legendary: false, origin: 'promo' })
  const out: SiteCard = {
    id: o.id ?? 'site', species: c.species, season: c.season, family: c.family, rarity: c.rarity, shiny: c.shiny, dna: c.dna,
    genes: c.genes, traits: c.traits, level: c.level, stage: c.stage, stats: c.stats, xp: c.xp,
  }
  if (c.form) out.form = c.form
  if (c.appearance) out.appearance = c.appearance
  if (c.foil) out.foil = true
  return out
}

/** `entry` is entryKey of the creature met: what a browser keeps beside the seed to meet it again later. */
export type Met = { seed: string; day: string; hour: Hour; card: SiteCard; entry: string }

/**
 * The creature a seed meets: the hour's family 50%, the seed day's featured species 15%, any family
 * 35%; common 78, rare 18, epic 4; shiny 1 in 100, foil 1 in 16; level 3 with 100 of 120 xp, so one
 * win evolves it. Null for a malformed seed, a future day or a day of another season than the
 * world's. Which creature comes out depends on what has been found (pool), which grows, so a seed of
 * an earlier day is met again with `pin`, the entry it met then; everything else comes from the seed
 * alone and draws the same either way.
 */
export function meet(seed: string, w: SiteWorld, pin?: string): Met | null {
  const m = SEED_RE.exec(seed)
  if (!m) return null
  const day = `${m[1]}-${m[2]}-${m[3]}`
  const t = noonOf(day)
  if (!Number.isFinite(t) || utcDay(t) !== day || day > w.day || t < seasonStart(w.season) || t >= seasonStart(w.season + 1)) return null
  const hour = m[4] as Hour
  const rng = rngFromSeed('spinlings/site/meet/' + seed)
  const r = rng()
  const featured = w.species.find(s => s.id === featuredOn(w, day))
  const drawn: Entry = r >= 0.5 && r < 0.65 && featured
    ? { species: featured }
    : pick(rng, pool(w, r < 0.5 ? HOUR_FAMILY[hour] : pick(rng, FAMILIES), day))
  const e = (pin === undefined ? null : entryOf(w, pin, day)) ?? drawn
  const rarity = weighted(rng, ECONOMY.wild.rarity)
  const shiny = rng() < ECONOMY.shiny.chance
  const foil = rng() < ECONOMY.foil.chance
  const card = siteCard(w, e, { rarity, shiny, foil, dna: uint32(rng), level: ECONOMY.starter.level, xp: ECONOMY.starter.xp, id: 'you' })
  return { seed, day, hour, card, entry: entryKey(w, e) }
}

/** A new seed for today at this hour; `random` gives 8 random bytes (crypto.getRandomValues). */
export function newSeed(day: string, hour: Hour, random: Uint8Array): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz234567'
  return `${day.replace(/-/g, '')}-${hour}-${[...random.slice(0, 8)].map(b => abc[b & 31]).join('')}`
}

/**
 * The hero's two regulars: one from the family the hour's family beats and one from the family that
 * beats it, at levels 4 and 5 (stage 2), the same for everyone all day.
 */
export function teamRegulars(w: SiteWorld, hour: Hour): [SiteCard, SiteCard] {
  const hf = HOUR_FAMILY[hour]
  const make = (f: Family, level: number, id: string) => {
    const i = hashString(`spinlings/site/team/${w.day}/${f}`) % 2
    return siteCard(w, { form: regularOf(w, f, i) }, { rarity: 'common', shiny: false, foil: false, dna: hashString(regularSeed(f, i) + '/dna'), level, id })
  }
  return [make(FAMILY_INFO[hf].beats, 4, 'reg-a'), make(beatenBy(hf), 5, 'reg-b')]
}

/** A regular as a card, for the type wheel and the den's guests. */
export const regularCard = (w: SiteWorld, f: Family, i: number, level = 1) =>
  siteCard(w, { form: regularOf(w, f, i) }, { rarity: 'common', shiny: false, foil: false, dna: hashString(regularSeed(f, i) + '/dna'), level, id: `reg-${f}-${i}` })

/** The demo battle's wild one: the featured species at level 5, wild rarity, fresh DNA. */
export function wildCard(w: SiteWorld, rng: Rng): SiteCard {
  const featured = w.species.find(s => s.id === w.featured)!
  return siteCard(w, { species: featured }, {
    rarity: weighted(rng, ECONOMY.wild.rarity), shiny: rng() < ECONOMY.shiny.chance, foil: rng() < ECONOMY.foil.chance,
    dna: uint32(rng), level: 5, id: 'wild-0',
  })
}

export type PackSlot = { card: SiteCard } | { unfound: Species }

/**
 * One pack card at slot odds: a legendary nobody has found turns into its gold silhouette. `entry`
 * fixes which creature a non-legendary roll gives (a pack deals its deck without repeats).
 */
export function rollSlot(w: SiteWorld, family: Family, rng: Rng, _last: boolean, entry?: Entry): PackSlot {
  const rarity = weighted(rng, ECONOMY.packs.odds)
  const shiny = rng() < ECONOMY.shiny.chance
  const foil = rng() < ECONOMY.foil.chance
  const dna = uint32(rng)
  if (rarity === 'legendary') {
    const leg = w.species.find(s => s.family === family && s.legendary)!
    return isFound(w, leg.id) ? { card: siteCard(w, { species: leg }, { rarity, shiny, foil: true, dna }) } : { unfound: leg }
  }
  return { card: siteCard(w, entry ?? pick(rng, pool(w, family)), { rarity, shiny, foil, dna }) }
}

/** A pack's deck: the family's revealed species and both of its regulars, each once. */
export function packDeck(w: SiteWorld, family: Family): Entry[] {
  const out = pool(w, family)
  for (const i of [0, 1]) {
    const form = regularOf(w, family, i)
    if (!out.some(e => 'form' in e && e.form === form)) out.push({ form })
  }
  return out
}

/**
 * A pack from a family's revealed pool, at the real size and slot odds. It deals a shuffled deck, so a
 * creature repeats only once the deck runs out (a family with fewer revealed creatures than pack slots).
 */
export function rollPack(w: SiteWorld, family: Family, rng: Rng): PackSlot[] {
  const deck = shuffle(rng, packDeck(w, family))
  return Array.from({ length: ECONOMY.packs.size }, (_, i) => rollSlot(w, family, rng, i === ECONOMY.packs.size - 1, deck[i % deck.length]))
}
