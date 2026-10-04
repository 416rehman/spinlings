// The Wandering Trader (SPEC section 19): a non-player trader with three deals a day, picked by the date hash, so
// the mod and every server agree. The server validates the cards handed over, consumes them and mints the return.
import type { Card, Family, NewCard, Rarity, Rng, TraderDeal } from './types.ts'
import { ECONOMY } from './economy.ts'
import { mintCard } from './cards.ts'
import { FAMILIES } from './families.ts'
import { chance, pick, rngFromSeed, shuffle, uint32 } from './rng.ts'
import { familySpecies, legendaryOf } from './species.ts'
import type { SeasonCatalog } from './species.ts'
import { seasonOf, shinyChance, utcDay } from './world.ts'

type Template = (a: Family, b: Family) => Omit<TraderDeal, 'id'>

const TEMPLATES: readonly Template[] = [
  (a, b) => ({ name: 'A pair for a rare', give: { count: 2, family: a }, get: { kind: 'cards', count: 1, rarity: 'rare', family: b } }),
  (_, b) => ({ name: 'One epic, two rares', give: { count: 1, rarity: 'epic' }, get: { kind: 'cards', count: 2, rarity: 'rare', family: b } }),
  (_, b) => ({ name: 'A bundle for a pack', give: { count: 5 }, get: { kind: 'pack', count: 1, family: b } }),
  (a) => ({ name: 'Three of a kind', give: { count: 3, family: a, rarity: 'common' }, get: { kind: 'cards', count: 1, rarity: 'rare', family: a } }),
  (_, b) => ({ name: 'Three rares for an epic', give: { count: 3, rarity: 'rare' }, get: { kind: 'cards', count: 1, rarity: 'epic', family: b } }),
]

/** Today's three deals. Ids are `{utcDay}-{0..2}`; each can be used once per player per day (the Trader's stock). */
export function traderDeals(now: number): TraderDeal[] {
  const day = utcDay(now)
  const rng = rngFromSeed('spinlings/trader/' + day)
  return shuffle(rng, TEMPLATES).slice(0, ECONOMY.trader.deals).map((make, k) => {
    const a = pick(rng, FAMILIES)
    const b = pick(rng, FAMILIES.filter(f => f !== a))
    return { id: `${day}-${k}`, ...make(a, b) }
  })
}

/** Why these cards cannot pay for the deal, or null when they can. Bound, held and trade-locked cards never can. */
export function traderGiveProblem(deal: TraderDeal, cards: readonly Pick<Card, 'id' | 'family' | 'rarity' | 'bound' | 'state' | 'lockedUntil'>[], now: number): string | null {
  if (cards.length !== deal.give.count) return `the Trader wants ${deal.give.count} cards`
  if (new Set(cards.map(c => c.id)).size !== cards.length) return 'the same card twice'
  for (const c of cards) {
    if (c.bound || c.state !== 'owned' || c.lockedUntil > now) return 'that card cannot be traded'
    if (deal.give.family && c.family !== deal.give.family) return `the Trader wants ${deal.give.family} cards`
    if (deal.give.rarity && c.rarity !== deal.give.rarity) return `the Trader wants ${deal.give.rarity} cards`
  }
  return null
}

/** What the Trader hands back: fresh current-season cards, or pack families for the server to create. */
export function rollTraderDeal(deal: TraderDeal, rng: Rng, now: number, catalog?: SeasonCatalog): { cards: NewCard[]; packs: Family[] } {
  if (deal.get.kind === 'pack') return { cards: [], packs: Array.from({ length: deal.get.count }, () => deal.get.family) }
  const cards: NewCard[] = []
  for (let i = 0; i < deal.get.count; i++) cards.push(mintFor(deal.get.family, deal.get.rarity, rng, now, 'trader', false, catalog))
  return { cards, packs: [] }
}

/** A fresh card of a family and rarity from the current season (a legendary is the family's legendary). */
export function mintFor(family: Family, rarity: Rarity, rng: Rng, now: number, origin: Card['origin'], bound = false, catalog?: SeasonCatalog): NewCard {
  const season = seasonOf(now)
  const species = rarity === 'legendary' ? legendaryOf(season, family, catalog) : pick(rng, familySpecies(season, family, catalog).filter(s => !s.legendary))
  return mintCard({ species, rarity, shiny: chance(rng, shinyChance(now)), dna: uint32(rng), origin, now, foil: chance(rng, ECONOMY.foil.chance), bound }, catalog)
}
