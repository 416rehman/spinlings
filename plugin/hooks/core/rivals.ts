// Rival trainers (SPEC section 19): generated duel opponents that fill in whenever no real player fits.
// A Rival's team is sized to the player's own team power, a little tougher as their rating climbs.
import type { BattleCard, NewCard, Rng } from './types.ts'
import { ECONOMY } from './economy.ts'
import { RARITIES, cardPower, mintCard, rarityRank, toBattleCard } from './cards.ts'
import { rivalName } from './naming.ts'
import { between, chance, pick, uint32, weighted } from './rng.ts'
import { seasonSpecies } from './species.ts'
import type { SeasonCatalog } from './species.ts'
import { seasonOf, shinyChance } from './world.ts'

export type Rival = {
  /** shown as "Rival {name}" */
  name: string
  rating: number
  team: BattleCard[]
}

/** How much stronger than the player's own team a Rival's is: 1.0 at rating 1000, +8% per 400 rating, clamped. */
export function rivalScale(rating: number): number {
  const r = ECONOMY.rival
  return Math.min(r.maxScale, Math.max(r.minScale, 1 + ((rating - r.scaleAt) / 400) * r.scalePer400))
}

export type RivalOptions = {
  catalog?: SeasonCatalog
  rng: Rng
  now: number
  /** the player's rating */
  rating: number
  /** the player's team power: the sum of cardPower over its team */
  power: number
  /** the player's team size, 1-3 */
  size: number
}

/** A Rival whose team power matches the player's, scaled by rating. Ids are 'rival-0'..'rival-2'. */
export function rollRival(o: RivalOptions): Rival {
  const { rng, now } = o
  const size = Math.min(ECONOMY.teamSize, Math.max(1, Math.round(o.size)))
  const target = (Math.max(1, o.power) / size) * rivalScale(o.rating)
  const regular = seasonSpecies(seasonOf(now), o.catalog).filter(s => !s.legendary)
  const team: BattleCard[] = []
  for (let slot = 0; slot < size; slot++) {
    const species = pick(rng, regular)
    const rolled = weighted(rng, ECONOMY.wild.rarity)
    const dna = uint32(rng)
    const shiny = chance(rng, shinyChance(now))
    const foil = chance(rng, ECONOMY.foil.chance)
    // the rolled rarity at the closest level; when no level comes within 10%, a humbler (or, for a strong team, a
    // grander) rarity, never legendary
    const r0 = rarityRank(rolled), epic = rarityRank('epic')
    const ranks = [r0, ...Array.from({ length: r0 }, (_, k) => r0 - 1 - k), ...Array.from({ length: epic - r0 }, (_, k) => r0 + 1 + k)]
    let best: NewCard | undefined
    const miss = (c: NewCard) => Math.abs(cardPower(c, o.catalog) - target)
    for (const rank of ranks) {
      if (best && miss(best) <= target * 0.1) break
      for (let level = 1; level <= ECONOMY.levels.max; level++) {
        const c = mintCard({ species, rarity: RARITIES[rank]!, shiny, dna, origin: 'catch', now, level, foil }, o.catalog)
        if (!best || miss(c) < miss(best)) best = c
      }
    }
    team.push(toBattleCard({ ...best!, id: `rival-${slot}` }))
  }
  const spread = ECONOMY.rival.ratingSpread
  return {
    name: rivalName(String(uint32(rng))),
    rating: Math.max(ECONOMY.rating.floor, o.rating + between(rng, -spread, spread)),
    team,
  }
}
