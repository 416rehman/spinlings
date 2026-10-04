// Cards: minting from DNA, stats, looks, levelling and evolution, raised forms, fusion and the small economy helpers.
import type {
  BattleCard, Card, CardForm, CardOrigin, CardStage, Eyes, Family, Form, Genes, Mouth, NewCard, Pattern, Rarity, Rng, Species,
  Stats, TraitId, Trinket,
} from './types.ts'
import { ECONOMY } from './economy.ts'
import { FAMILIES, beatenBy, beats, clampHue } from './families.ts'
import { fusionNameLine } from './naming.ts'
import { between, chance, int, pick, rngFromSeed, shuffle, uint32 } from './rng.ts'
import { PATTERNS, familySpecies, formOf, seasonSpecies } from './species.ts'
import type { SeasonCatalog } from './species.ts'
import { TRAIT_IDS } from './traits.ts'
import { seasonOf, shinyChance } from './world.ts'

export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary']
export const EYES: readonly Eyes[] = ['dot', 'tall', 'sparkle', 'sleepy', 'fierce']
export const MOUTHS: readonly Mouth[] = ['none', 'smile', 'fang', 'o']
export const TRINKETS: readonly Trinket[] = ['hat', 'bow', 'flower', 'scarf', 'monocle']

export function rarityRank(r: Rarity): number {
  return RARITIES.indexOf(r)
}

export function traitCount(r: Rarity): number {
  return r === 'epic' || r === 'legendary' ? 2 : 1
}

/** Every per-card cosmetic and gene derives from this key. */
export function dnaKey(card: Pick<Card, 'species' | 'dna'>): string {
  return `${card.species}:${card.dna >>> 0}`
}

export function genesFromDna(key: string): Genes {
  const rng = rngFromSeed(key + '/genes')
  return [int(rng, 16), int(rng, 16), int(rng, 16), int(rng, 16)]
}

export function traitsFromDna(key: string, count: number): TraitId[] {
  return shuffle(rngFromSeed(key + '/traits'), TRAIT_IDS).slice(0, count)
}

/** The stage a level reaches: 2 at level 4, 3 at level 8 (SPEC section 22). */
export function stageFor(level: number): CardStage {
  const [two, three] = ECONOMY.levels.evolveAt
  return level >= three ? 3 : level >= two ? 2 : 1
}

export type MintBase = {
  /** a season species id, or the kind of an embedded form */
  species: string
  form?: CardForm
  appearance?: Form
  season: number
  family: Family
  /** final form: always stage 3 */
  legendary: boolean
  rarity: Rarity
  shiny: boolean
  dna: number
  origin: CardOrigin
  now: number
  level?: number
  xp?: number
  bound?: boolean
  foil?: boolean
}

/** The one place a card comes into being. Genes and traits come from the DNA; legendaries and Mythics are foil and final. */
export function mintBase(o: MintBase, catalog?: SeasonCatalog): NewCard {
  const dna = o.dna >>> 0
  const key = dnaKey({ species: o.species, dna })
  const level = o.level ?? 1
  const card: NewCard = {
    species: o.species,
    ...(o.form ? { form: o.form } : {}),
    ...(o.appearance ? { appearance: o.appearance } : {}),
    season: o.season,
    family: o.family,
    rarity: o.rarity,
    shiny: o.shiny,
    ...(o.foil || o.rarity === 'legendary' || o.species === 'mythic' ? { foil: true as const } : {}),
    dna,
    genes: genesFromDna(key),
    traits: traitsFromDna(key, traitCount(o.rarity)),
    level,
    xp: o.xp ?? 0,
    stage: o.legendary ? 3 : stageFor(level),
    stats: { hp: 1, atk: 1, def: 1, spd: 1 },
    bound: o.bound ?? false,
    forTrade: false,
    origin: o.origin,
    mintedAt: o.now,
    lockedUntil: 0,
    tiredUntil: 0,
    state: 'owned',
  }
  card.stats = cardStats(card, catalog)
  return card
}

export type MintOptions = Omit<MintBase, 'species' | 'form' | 'season' | 'family' | 'legendary'> & { species: Species }

export function mintCard(o: MintOptions, catalog?: SeasonCatalog): NewCard {
  const { species, ...rest } = o
  return mintBase({ ...rest, ...(catalog ? { appearance: species } : {}), species: species.id, season: species.season, family: species.family, legendary: species.legendary }, catalog)
}

/**
 * A card as a battle and other players see it: no ownership, timestamps or raised look. `raisedIn` is the arena, so the
 * model, a card grew up in, which nobody else may see (SPEC 20.3).
 */
export function toBattleCard(c: BattleCard): BattleCard {
  const out: BattleCard = {
    id: c.id, species: c.species, season: c.season, family: c.family, rarity: c.rarity, shiny: c.shiny, dna: c.dna,
    genes: [...c.genes], traits: [...c.traits], level: c.level, stage: c.stage, stats: { ...statsOf(c) },
  }
  if (c.form) out.form = c.form
  if (c.appearance) out.appearance = c.appearance
  if (c.parentForms) out.parentForms = c.parentForms
  if (c.foil) out.foil = true
  if (c.firstFind) out.firstFind = true
  return out
}

/** The owner's own card in a battle setup: the battle card plus its raised look, shown to the owner alone. */
export function ownBattleCard(c: BattleCard): BattleCard {
  const out = toBattleCard(c)
  if (c.raisedIn) out.raisedIn = c.raisedIn
  return out
}

/** A caught or rewarded battle creature becomes a real card with the same DNA, genes and traits. */
export function cardFromBattleCard(c: BattleCard, origin: CardOrigin, now: number, o: { discoveredBy?: string } = {}): NewCard {
  const { id: _id, firstFind: _first, ...rest } = toBattleCard(c)
  if (rest.form && rest.form.kind === 'mythic' && o.discoveredBy) rest.form = { ...rest.form, discoveredBy: o.discoveredBy }
  return { ...rest, xp: 0, bound: false, forTrade: false, origin, mintedAt: now, lockedUntil: 0, tiredUntil: 0, state: 'owned' }
}

export type StatCard = Pick<BattleCard, 'species' | 'form' | 'appearance' | 'genes' | 'rarity' | 'level' | 'stage' | 'traits'>

export function geneMult(gene: number): number {
  return ECONOMY.stats.geneBase + ECONOMY.stats.genePerPoint * gene
}

/** The stat formula: round(base * gene * rarity * level * stage * trait). */
export function cardStats(card: StatCard, catalog?: SeasonCatalog): Stats {
  const base = formOf(card, catalog).base
  const s = ECONOMY.stats
  const common = s.rarityMult[card.rarity] * (1 + s.levelStep * (card.level - 1)) * s.stageMult[card.stage - 1]!
  const t = ECONOMY.traits
  const has = (id: TraitId) => card.traits.includes(id)
  const mult: Stats = {
    hp: (has('glassHeart') ? t.glassHp : 1) * (has('sleepy') ? t.sleepyHp : 1),
    atk: has('glassHeart') ? t.glassAtk : 1,
    def: 1,
    spd: (has('swift') ? t.swift : 1) * (has('sleepy') ? t.sleepySpd : 1),
  }
  const stat = (k: keyof Stats, i: number) => Math.max(1, Math.round(base[k] * geneMult(card.genes[i]!) * common * mult[k]))
  return { hp: stat('hp', 0), atk: stat('atk', 1), def: stat('def', 2), spd: stat('spd', 3) }
}

/** The stats to show and battle with: the server's when the card carries them, else the formula. */
export function statsOf(card: StatCard & { stats?: Stats }, catalog?: SeasonCatalog): Stats {
  return card.stats ?? cardStats(card, catalog)
}

export function cardPower(card: StatCard & { stats?: Stats }, catalog?: SeasonCatalog): number {
  const s = statsOf(card, catalog)
  return s.hp + 2 * s.atk + 2 * s.def + s.spd
}

/** Gene score as a whole percentage, 0..100. */
export function geneScore(genes: Genes): number {
  return Math.round(((genes[0] + genes[1] + genes[2] + genes[3]) / 60) * 100)
}

export function cardName(card: Pick<Card, 'species' | 'form' | 'appearance' | 'stage'>, catalog?: SeasonCatalog): string {
  return formOf(card, catalog).names[card.stage - 1]!
}

export type Look = {
  family: Family
  /** body hue in degrees before any shiny rotation, inside the family range */
  hue: number
  /** saturation and lightness offsets, -0.08..0.08 and -0.06..0.06 */
  sat: number
  light: number
  /** 0..1, where in the family's accent range the accent colour sits */
  accent: number
  pattern: Pattern
  eyes: Eyes
  mouth: Mouth
  trinket: Trinket
  /** seeds the re-roll of every edge pixel */
  shapeSeed: number
  shiny: boolean
}

/** A card's individual look, all from its DNA. */
export function look(card: Pick<Card, 'species' | 'form' | 'appearance' | 'dna' | 'shiny'>, catalog?: SeasonCatalog): Look {
  const form = formOf(card, catalog)
  const rng = rngFromSeed(dnaKey(card))
  const c = ECONOMY.cosmetics
  const hue = clampHue(form.family, form.hue + (rng() * 2 - 1) * c.hueShift)
  const light = (rng() * 2 - 1) * c.lightShift
  const sat = (rng() * 2 - 1) * c.satShift
  const pattern = rng() < c.defaultPattern ? form.pattern : pick(rng, PATTERNS)
  const eyes = pick(rng, EYES)
  const mouth = pick(rng, MOUTHS)
  const trinket = rng() < c.trinket ? pick(rng, TRINKETS) : 'none'
  return {
    family: form.family, hue: Math.round(hue * 10) / 10, sat, light, accent: rng(), pattern, eyes, mouth, trinket,
    shapeSeed: uint32(rng), shiny: card.shiny,
  }
}

/**
 * The plain look of a form with no card behind it (album entries), keyed by the species id or the form's own seed
 * where it has one, so it never shifts when names do.
 */
export function formLook(form: Form): Look {
  const f = form as Form & { id?: string; seed?: string }
  const rng = rngFromSeed('look/' + (f.id ?? f.seed ?? form.names[0]))
  return {
    family: form.family, hue: form.hue, sat: 0, light: 0, accent: rng(), pattern: form.pattern,
    eyes: 'tall', mouth: 'smile', trinket: 'none', shapeSeed: uint32(rng), shiny: false,
  }
}

export function xpToNext(level: number): number {
  return ECONOMY.levels.xpPerLevel * level
}

/**
 * The raising family (SPEC section 18): the arena family a card battled in most. Ties for the most, and a card that
 * never battled, go to its own family.
 */
export function raisingFamily(counts: Partial<Record<Family, number>>, own: Family): Family {
  let best = own, most = counts[own] ?? 0, tie = false
  for (const f of FAMILIES) {
    if (f === own) continue
    const n = counts[f] ?? 0
    if (n > most) { best = f; most = n; tie = false } else if (n === most) tie = true
  }
  return tie || most === 0 ? own : best
}

export type XpCard = Pick<Card, 'level' | 'xp' | 'stage'> & { family?: Family; raisedIn?: Family; stats?: Stats }

/**
 * Adds xp, levelling up (max 10) and evolving at levels 4 and 8. Final forms are already stage 3 and never change.
 * The first evolution fixes `raisedIn` (the raising family now, see raisingFamily; defaults to the card's own family).
 * A card that carries stats gets them recomputed. Returns a new card.
 */
export function applyXp<T extends XpCard>(card: T, gained: number, raisedIn?: Family, catalog?: SeasonCatalog): { card: T; levelsGained: number; evolved: boolean } {
  let level = card.level
  let xp = card.xp + Math.max(0, gained)
  while (level < ECONOMY.levels.max && xp >= xpToNext(level)) {
    xp -= xpToNext(level)
    level++
  }
  if (level >= ECONOMY.levels.max) xp = 0
  const stage = Math.max(card.stage, stageFor(level)) as CardStage
  const out: T = { ...card, level, xp, stage }
  const raised = raisedIn ?? card.family
  if (card.stage === 1 && stage > 1 && out.raisedIn === undefined && raised) out.raisedIn = raised
  if (card.stats && 'genes' in card) out.stats = cardStats(out as unknown as StatCard, catalog)
  return { card: out, levelsGained: level - card.level, evolved: stage !== card.stage }
}

type FuseParent = Pick<Card, 'species' | 'form' | 'appearance' | 'season' | 'family' | 'rarity' | 'dna' | 'shiny' | 'foil' | 'genes' | 'traits' | 'level' | 'stage'>

/** Fuses two cards into a new hybrid. Both parents are consumed by the caller. */
export function fuse(a: FuseParent, b: FuseParent, rng: Rng, now: number, catalog?: SeasonCatalog): NewCard {
  const fa = formOf(a, catalog), fb = formOf(b, catalog)
  const lb = look(b, catalog)
  const dna = uint32(rng)

  let rank = Math.max(rarityRank(a.rarity), rarityRank(b.rarity))
  if (chance(rng, ECONOMY.fusion.tierUp) && rank < rarityRank('epic')) rank++
  const rarity = RARITIES[rank]!

  const noise = ECONOMY.fusion.geneNoise
  const genes = [0, 1, 2, 3].map(i =>
    Math.min(15, Math.max(0, Math.round((a.genes[i]! + b.genes[i]!) / 2 + between(rng, -noise, noise))))) as Genes

  const fromA = shuffle(rng, a.traits), fromB = shuffle(rng, b.traits)
  const [first, second] = chance(rng, 0.5) ? [fromA, fromB] : [fromB, fromA]
  const traits: TraitId[] = []
  const want = traitCount(rarity)
  for (const t of [first[0], second[0], ...first.slice(1), ...second.slice(1), ...shuffle(rng, TRAIT_IDS)]) {
    if (traits.length >= want) break
    if (t && !traits.includes(t)) traits.push(t)
  }

  const level = Math.max(1, Math.floor((a.level + b.level) / 2) - 1)
  const season = seasonOf(now)
  const taken: string[] = []
  for (const s of new Set([season, a.season, b.season])) for (const sp of seasonSpecies(s, catalog)) taken.push(...sp.names)
  const r2 = (v: number) => Math.round(v * 100) / 100
  const form: CardForm = {
    kind: 'fusion',
    family: fb.family,
    body: fa.body,
    hue: lb.hue,
    pattern: lb.pattern,
    accessory: fa.accessory,
    base: { hp: r2((fa.base.hp + fb.base.hp) / 2), atk: r2((fa.base.atk + fb.base.atk) / 2), def: r2((fa.base.def + fb.base.def) / 2), spd: r2((fa.base.spd + fb.base.spd) / 2) },
    names: fusionNameLine(fa.names[0], fb.names[0], taken),
    legendary: false,
    parents: [a.species, b.species],
  }
  const shiny = chance(rng, shinyChance(now))
  // every legendary is foil (SPEC 14), a hybrid one too
  const foil = rarity === 'legendary' || (a.foil && b.foil) || chance(rng, ECONOMY.foil.chance)
  const card: NewCard = {
    species: 'fusion', form, season, family: fb.family, rarity, shiny, ...(foil ? { foil: true as const } : {}),
    dna, genes, traits, level, xp: 0, stage: stageFor(level), stats: { hp: 1, atk: 1, def: 1, spd: 1 },
    bound: false, forTrade: false, origin: 'fusion', mintedAt: now, lockedUntil: 0, tiredUntil: 0, state: 'owned',
  }
  card.stats = cardStats(card)
  return card
}

/** Recycling pays by rarity: shiny doubles, foil adds half again, and a Mythic (legendary rarity) doubles once more. */
export function recycleValue(card: Pick<Card, 'rarity' | 'shiny' | 'foil' | 'species'>): number {
  const e = ECONOMY
  return Math.round(e.recycle[card.rarity] * (card.shiny ? e.recycleShiny : 1) * (card.foil ? e.recycleFoil : 1) * (card.species === 'mythic' ? e.recycleMythic : 1))
}

export function craftCost(rarity: Rarity): number {
  return ECONOMY.craft[rarity]
}

/** Legendary species are always legendary rarity and regular species never are. */
export function rarityFits(species: Species, rarity: Rarity): boolean {
  return species.legendary === (rarity === 'legendary')
}

/** Three bound commons at level 3, one good battle from evolving: the player's family, the one it beats, the one that beats it. */
export function starterTeam(family: Family, rng: Rng, now: number, catalog?: SeasonCatalog): NewCard[] {
  const season = seasonOf(now)
  return [family, beats(family), beatenBy(family)].map(f => {
    const species = pick(rng, familySpecies(season, f, catalog).filter(s => !s.legendary))
    const shiny = chance(rng, shinyChance(now))
    return mintCard({
      species, rarity: 'common', shiny, dna: uint32(rng), origin: 'starter', now, level: ECONOMY.starter.level, xp: ECONOMY.starter.xp, bound: true,
    }, catalog)
  })
}
