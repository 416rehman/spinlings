// The offline collection (SPEC 4, 6, 19, 24): packs from presence and sparks, opening them, the team, fusion,
// recycling, crafting and the Wandering Trader, each by the shared core rule the server uses. No daily quotas: only the
// charge spacing, the bank of 12, sparks, and the room left in the save.
import type {
  BuyPackRequest, CardResponse, ChargeRequest, CraftRequest, FuseRequest, FuseResponse, OpenPackRequest, OpenPackResponse,
  PacksResponse, RecycleResponse, TeamRequest, TeamResponse, TraderDealRequest, TraderDealResponse, TraderDealView, TraderResponse,
} from '../../core/api.ts'
import { craftCost, fuse, mintCard, rarityFits, recycleValue } from '../../core/cards.ts'
import { ECONOMY } from '../../core/economy.ts'
import { rollPack } from '../../core/packs.ts'
import { chance, uint32 } from '../../core/rng.ts'
import { SPECIES_ID, getSpecies } from '../../core/species.ts'
import { rollTraderDeal, traderDeals, traderGiveProblem } from '../../core/trader.ts'
import { dailyRule, fusionCost, seasonOf, shinyChance, utcDay } from '../../core/world.ts'
import type { Ctx } from './state.ts'
import { addCards, grantPack, mustBeFree, needRoom, ownCard, packsView, recentCharges, nextChargeAt, refuse, removeCards } from './state.ts'
import type { LocalState } from './save.ts'

const mustAfford = (s: LocalState, cost: number) => { if (s.sparks < cost) refuse('insufficient_sparks', 'Not enough sparks for that yet') }

// ---------- packs ----------

/** Presence charges a pack: 45 minutes apart (90 beyond 16 a day) into a bank of 12 (SPEC 6, 24). */
export function chargePack(s: LocalState, ctx: Ctx, req: ChargeRequest): PacksResponse {
  if (s.packs.length >= ECONOMY.packs.bank) refuse('cap_reached', 'Open some packs to make room')
  if (ctx.now < nextChargeAt(s, ctx.now)) refuse('rate_limited', 'Your lamp needs a little longer')
  grantPack(s, ctx, req.family, 'charge')
  s.lastChargeAt = ctx.now
  s.charges = [...recentCharges(s, ctx.now), ctx.now]
  return { packs: packsView(s) }
}

export function buyPack(s: LocalState, ctx: Ctx, req: BuyPackRequest): PacksResponse {
  mustAfford(s, ECONOMY.packs.buyCost)
  s.sparks -= ECONOMY.packs.buyCost
  grantPack(s, ctx, req.family, 'bought')
  return { packs: packsView(s) }
}

/** The cards are rolled now, from the current season (SPEC 6). */
export function openPack(s: LocalState, ctx: Ctx, req: OpenPackRequest): OpenPackResponse {
  const pack = s.packs.find(p => p.id === req.packId) ?? refuse('not_found', 'That pack is not here')
  needRoom(s, ECONOMY.packs.size)
  const rolled = rollPack(pack.family, seasonOf(ctx.now), ctx.rng, ctx.now, dailyRule(ctx.now), ctx.catalog)
  const cards = addCards(s, ctx, rolled, { lockedUntil: pack.lockUntil > ctx.now ? pack.lockUntil : 0, bound: pack.bound })
  s.packs = s.packs.filter(p => p.id !== pack.id)
  return { cards }
}

// ---------- the team and single cards ----------

export function setTeam(s: LocalState, _ctx: Ctx, req: TeamRequest): TeamResponse {
  for (const id of req.cardIds) {
    if (ownCard(s, id).state !== 'owned') refuse('not_allowed', 'That card is held right now')
  }
  s.team = [...req.cardIds]
  return { team: s.team }
}

/** Parent A gives the shape, B the family and colours (SPEC 4). A hybrid keeps the longer trade lock of its parents. */
export function fuseCards(s: LocalState, ctx: Ctx, req: { cardId: string } & FuseRequest): FuseResponse {
  if (req.cardId === req.otherId) refuse('bad_request', 'Pick two different cards')
  const a = ownCard(s, req.cardId), b = ownCard(s, req.otherId)
  mustBeFree(a)
  mustBeFree(b)
  const cost = fusionCost(dailyRule(ctx.now))
  mustAfford(s, cost)
  const lock = Math.max(a.lockedUntil, b.lockedUntil)
  const hybrid = fuse(a, b, ctx.rng, ctx.now, ctx.catalog)
  removeCards(s, [a.id, b.id])
  s.sparks -= cost
  const card = addCards(s, ctx, [hybrid], lock > ctx.now ? { lockedUntil: lock } : {})[0]!
  return { card, consumed: [a.id, b.id] }
}

export function recycle(s: LocalState, _ctx: Ctx, req: { cardId: string }): RecycleResponse {
  const c = ownCard(s, req.cardId)
  mustBeFree(c)
  const gained = recycleValue(c)
  removeCards(s, [c.id])
  s.sparks += gained
  return { sparks: s.sparks, gained }
}

/** The current season only (SPEC 4). */
export function craft(s: LocalState, ctx: Ctx, req: CraftRequest): CardResponse {
  const season = Number(SPECIES_ID.exec(req.speciesId)?.[1] ?? 0)
  const species = season === seasonOf(ctx.now) ? getSpecies(req.speciesId, ctx.catalog) : undefined
  if (!species) return refuse('not_allowed', "Only this season's creatures can be crafted")
  if (!rarityFits(species, req.rarity)) refuse('bad_request', species.legendary ? 'A legendary is always legendary' : 'Only legendaries come in legendary')
  const cost = craftCost(req.rarity)
  mustAfford(s, cost)
  needRoom(s, 1)
  const fresh = mintCard({
    species, rarity: req.rarity, shiny: chance(ctx.rng, shinyChance(ctx.now)), dna: uint32(ctx.rng), origin: 'craft', now: ctx.now,
    foil: chance(ctx.rng, ECONOMY.foil.chance),
  }, ctx.catalog)
  s.sparks -= cost
  return { card: addCards(s, ctx, [fresh])[0]! }
}

// ---------- the Wandering Trader (SPEC 19): three deals a day, each once a day, offline exactly as online ----------

function traderView(s: LocalState, now: number): TraderDealView[] {
  const used = s.trader.day === utcDay(now) ? s.trader.used : []
  return traderDeals(now).map((d, k) => ({ ...d, used: used.includes(k) }))
}

export function trader(s: LocalState, ctx: Ctx): TraderResponse {
  return { day: utcDay(ctx.now), deals: traderView(s, ctx.now) }
}

export function traderDeal(s: LocalState, ctx: Ctx, req: { dealId: string } & TraderDealRequest): TraderDealResponse {
  const deals = traderView(s, ctx.now)
  const k = deals.findIndex(d => d.id === req.dealId)
  const deal = deals[k] ?? refuse('not_found', 'The Trader has no such deal today')
  if (deal.used) refuse('conflict', 'You made this deal today. The Trader brings new stock tomorrow')
  const given = req.cardIds.map(id => ownCard(s, id))
  const problem = traderGiveProblem(deal, given, ctx.now)
  if (problem) refuse('not_allowed', problem.charAt(0).toUpperCase() + problem.slice(1))
  const got = rollTraderDeal(deal, ctx.rng, ctx.now, ctx.catalog)
  needRoom(s, got.cards.length - given.length)
  removeCards(s, req.cardIds)
  const cards = addCards(s, ctx, got.cards)
  const packs = got.packs.map(f => grantPack(s, ctx, f, 'trader'))
  const today = utcDay(ctx.now)
  s.trader = { day: today, used: [...(s.trader.day === today ? s.trader.used : []), k] }
  return { cards, packs, consumed: [...req.cardIds] }
}
