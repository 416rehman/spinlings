// Server-side rolls: pack contents, wild teams and duel bounties. Every draw comes from the given Rng.
import type { BattleCard, DailyRule, Family, NewCard, Rarity, Rng, Species } from './types.ts'
import { ECONOMY } from './economy.ts'
import { FAMILIES, typeMult } from './families.ts'
import { mintCard, toBattleCard } from './cards.ts'
import { generateMythic, mythicSeed } from './mythics.ts'
import { chance, between, pick, uint32, weighted } from './rng.ts'
import { familySpecies, getSpecies, legendaryOf, seasonSpecies } from './species.ts'
import type { SeasonCatalog } from './species.ts'
import { dailyRule, seasonOf, shinyChance } from './world.ts'

/** One fresh card of the pack's family, with no guaranteed rarity. */
export function rollPack(family: Family, season: number, rng: Rng, now: number, rule: DailyRule = dailyRule(now), catalog?: SeasonCatalog): NewCard[] {
  const p = ECONOMY.packs
  const regular = familySpecies(season, family, catalog).filter(s => !s.legendary)
  const odds = shinyChance(now, rule)
  const out: NewCard[] = []
  for (let slot = 0; slot < p.size; slot++) {
    const rarity = weighted(rng, p.odds)
    const species = rarity === 'legendary' ? legendaryOf(season, family, catalog) : pick(rng, regular)
    const shiny = chance(rng, odds)
    out.push(mintCard({ species, rarity, shiny, dna: uint32(rng), origin: 'pack', now, foil: chance(rng, ECONOMY.foil.chance) }, catalog))
  }
  return out
}

export type WildOptions = {
  catalog?: SeasonCatalog
  rng: Rng
  /** the arena family (the attacker's current model) */
  arena: Family
  now: number
  /** the attacker's team average level */
  level: number
  rule?: DailyRule
  /** today's featured species id (worldOf(now).featured) */
  featured?: string
  /** this week's roaming legendary species id (worldOf(now).roamer) */
  roamer?: string
  /** the rested bonus (isRested): the lead is rare or better */
  rested?: boolean
}

/**
 * A wild team of 1-3 creatures from the current season. Ids are 'wild-0'..'wild-2'. The lead is a Mythic 1 time in 40,
 * else the weekly roamer 1 time in 100; otherwise every slot is a regular species, and a rested lead is rare or better.
 */
export function rollWildTeam(o: WildOptions): BattleCard[] {
  const { rng, arena, now } = o
  const w = ECONOMY.wild
  const season = seasonOf(now)
  const rule = o.rule ?? dailyRule(now)
  const odds = shinyChance(now, rule)
  const regular = seasonSpecies(season, o.catalog).filter(s => !s.legendary)
  const featured = o.featured ? getSpecies(o.featured, o.catalog) : undefined
  const roamer = o.roamer ? getSpecies(o.roamer, o.catalog) : undefined
  const avg = Math.min(ECONOMY.levels.max, Math.max(1, Math.round(o.level)))

  const lead = chance(rng, w.mythicChance) ? 'mythic' : chance(rng, w.roamerChance) && roamer?.legendary ? 'roamer' : 'regular'
  const size = weighted(rng, w.size)
  const team: BattleCard[] = []
  for (let slot = 0; slot < size; slot++) {
    const level = Math.min(ECONOMY.levels.max, Math.max(1, avg + between(rng, -w.levelSpread, w.levelSpread)))
    if (slot === 0 && lead === 'mythic') {
      const card = generateMythic({ seed: mythicSeed(rng), dna: uint32(rng), now, level, shiny: chance(rng, odds) })
      team.push(toBattleCard({ ...card, id: 'wild-0' }))
      continue
    }
    let species: Species
    let rarity: Rarity
    if (slot === 0 && lead === 'roamer') {
      species = roamer!
      rarity = 'legendary'
    } else {
      const source = rng()
      species = source < w.arena
        ? pick(rng, regular.filter(s => s.family === arena))
        : source < w.arena + w.featured && featured && !featured.legendary
          ? featured
          : pick(rng, regular)
      rarity = weighted(rng, slot === 0 && o.rested ? w.restedRarity : w.rarity)
    }
    const shiny = chance(rng, odds)
    const card = mintCard({ species, rarity, shiny, dna: uint32(rng), origin: 'catch', now, level, foil: chance(rng, ECONOMY.foil.chance) }, o.catalog)
    team.push(toBattleCard({ ...card, id: `wild-${slot}` }))
  }
  return team
}

/**
 * The first wild encounter ever (beginner's luck, SPEC 13): one common at ECONOMY.wild.firstLevel (or two below the
 * team's level if that is lower) from the family that fares worst against the player's lead today, with the type
 * cycle, Topsy-Turvy and the arena bonus all counted. A starter team wins it almost always, and that first wild win
 * always catches. Never a Mythic or the roamer; it may still be shiny or foil. The id is 'wild-0'.
 */
export function rollFirstWild(o: Pick<WildOptions, 'rng' | 'arena' | 'now' | 'level' | 'rule' | 'catalog'> & { lead: Family }): BattleCard[] {
  const { rng, arena, now, lead } = o
  const rule = o.rule ?? dailyRule(now)
  // how hard a family hits the lead against how hard the lead hits it back
  const edge = (f: Family) => (typeMult(f, lead, rule) * (f === arena ? ECONOMY.battle.arena : 1)) / typeMult(lead, f, rule)
  const family = FAMILIES.reduce((a, b) => (edge(b) < edge(a) ? b : a))
  const species = pick(rng, familySpecies(seasonOf(now), family, o.catalog).filter(s => !s.legendary))
  const level = Math.max(1, Math.min(ECONOMY.wild.firstLevel, Math.round(o.level) - 2))
  const shiny = chance(rng, shinyChance(now, rule))
  const card = mintCard({ species, rarity: 'common', shiny, dna: uint32(rng), origin: 'catch', now, level, foil: chance(rng, ECONOMY.foil.chance) }, o.catalog)
  return [toBattleCard({ ...card, id: 'wild-0' })]
}

/**
 * A duel bounty: a freshly rolled card of the opponent's lead species, never a legendary. A fusion lead gives its B
 * parent; a lead with no regular species to copy (a legendary, a Mythic, a promo) gives a regular of its family.
 */
export function rollBounty(lead: Pick<BattleCard, 'species' | 'form' | 'family'>, rng: Rng, now: number, rule: DailyRule = dailyRule(now), catalog?: SeasonCatalog): NewCard {
  const parents = lead.form?.parents
  let species = parents ? getSpecies(parents[1], catalog) ?? getSpecies(parents[0], catalog) : getSpecies(lead.species, catalog)
  if (!species || species.legendary) species = pick(rng, familySpecies(seasonOf(now), lead.family, catalog).filter(s => !s.legendary))
  const rarity = weighted(rng, ECONOMY.packs.odds.filter(([r]) => r !== 'legendary'))
  return mintCard({ species, rarity, shiny: chance(rng, shinyChance(now, rule)), dna: uint32(rng), origin: 'bounty', now, foil: chance(rng, ECONOMY.foil.chance) }, catalog)
}

/** Uniform pick of another family for the second welcome pack. */
export function otherFamily(family: Family, rng: Rng): Family {
  return pick(rng, FAMILIES.filter(f => f !== family))
}
