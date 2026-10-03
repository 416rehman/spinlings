// The collection (SPEC 4, 6, 8, 19, 24, 25, 26): cards, packs (charge, buy, open), the team, fusion,
// recycling, for-trade, crafting, the wishlist, the Wandering Trader and drop codes. Each mutation
// reads, decides, then commits one guarded batch (SPEC 16); a Conflict re-runs it from its reads.
// Another player's card or pack answers 404, exactly like one that does not exist (SPEC 26.3).
// There are no daily quotas (SPEC 24): only the charge spacing, the bank of 12 and sparks.
import { craftCost, fuse, mintCard, rarityFits, recycleValue } from '../../../plugin/hooks/core/cards.ts'
import { mintDropReward } from '../../../plugin/hooks/core/drops.ts'
import { ECONOMY } from '../../../plugin/hooks/core/economy.ts'
import { rollPack } from '../../../plugin/hooks/core/packs.ts'
import { chance, uint32 } from '../../../plugin/hooks/core/rng.ts'
import { getSpecies } from '../../../plugin/hooks/core/species.ts'
import { rollTraderDeal, traderGiveProblem } from '../../../plugin/hooks/core/trader.ts'
import type { Family } from '../../../plugin/hooks/core/types.ts'
import { dailyRule, fusionCost, seasonOf, shinyChance, utcDay } from '../../../plugin/hooks/core/world.ts'
import type { Api } from '../app.ts'
import { stmt } from '../db.ts'
import { fail } from '../http.ts'
import { spendJoinCounter } from '../ratelimit.ts'
import { addSparks, apiRoute, commit, mustAfford, notFound, rngOf, setPlayer, teamOf } from '../game/ctx.ts'
import {
  bankGuard, deletePack, dropByCode, dropLive, dropReward, mustBeFree, mustBeHome, mustBeTradeable, ownPack,
  packGuard, redeemStmts, seasonOfSpecies, takeCards, traderView, useDeal,
} from '../game/collection.ts'
import { bumpCards, CARDS_CURSOR, cardGuard, cardsPage, grantPack, mintCards, ownCard, ownCards, packsOf, saveCard, unopenedCount } from '../game/mint.ts'
import { checkCharge, markCharge, trusted } from '../game/pacing.ts'

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function collection(api: Api): void {
  // The caller's own cards with their server-computed stats (SPEC 32), a page at a time: a mod that
  // knows pages asks again with ?after={next} until next is absent (older mods read the first page).
  apiRoute(api, 'cards', async ctx => {
    const after = ctx.url.searchParams.get('after')
    if (after !== null && !CARDS_CURSOR.test(after)) fail('bad_request', 'Malformed cursor')
    const page = await cardsPage(ctx.db, ctx.player.id, after)
    return { cards: page.cards, version: ctx.player.cards_version, ...(page.next ? { next: page.next } : {}) }
  })

  // ---- packs ----

  // Presence charges a pack: 45 minutes apart (90 beyond 16 in a day) into a bank of 12 (SPEC 6, 24).
  apiRoute(api, 'chargePack', async (ctx, req) => {
    const p = ctx.player
    checkCharge(p, ctx.now, await unopenedCount(ctx.db, p.id))
    const g = grantPack(ctx, p.id, req.family, 'charge')
    await commit(ctx, [bankGuard(p.id), g.stmt, markCharge(p, ctx.now)])
    return { packs: await packsOf(ctx.db, p.id) }
  })

  apiRoute(api, 'buyPack', async (ctx, req) => {
    const p = ctx.player
    const cost = ECONOMY.packs.buyCost
    mustAfford(p, cost)
    const g = grantPack(ctx, p.id, req.family, 'bought')
    await commit(ctx, [g.stmt, addSparks(p.id, -cost)])
    return { packs: await packsOf(ctx.db, p.id) }
  })

  // The cards are rolled now, from the current season (SPEC 6). The row goes, so a replay finds nothing.
  apiRoute(api, 'openPack', async (ctx, req) => {
    const p = ctx.player
    const pack = (await ownPack(ctx.db, p.id, req.packId)) ?? notFound('pack')
    const rolled = rollPack(pack.family as Family, seasonOf(ctx.now), rngOf(ctx), ctx.now)
    const minted = await mintCards(ctx, p.id, rolled, { ...(pack.lock_until > ctx.now ? { lockedUntil: pack.lock_until } : {}), bound: pack.bound === 1 })
    await commit(ctx, [packGuard(p.id, pack.id), deletePack(pack.id), ...minted.stmts])
    return { cards: minted.cards }
  })

  // ---- the team and single cards ----

  apiRoute(api, 'setTeam', async (ctx, req) => {
    const p = ctx.player
    const cards = await ownCards(ctx.db, p.id, req.cardIds)
    cards.forEach(mustBeHome)
    if (JSON.stringify(teamOf(p)) !== JSON.stringify(req.cardIds)) {
      await commit(ctx, [...cards.map(c => cardGuard(c, 'owned')), setPlayer(p.id, { team: JSON.stringify(req.cardIds), team_size: req.cardIds.length })])
    }
    return { team: req.cardIds }
  })

  // Listing is part of trading, so it waits for the trust gate (SPEC 8, 30); taking a card off never does.
  apiRoute(api, 'setForTrade', async (ctx, req) => {
    const p = ctx.player
    const c = await ownCard(ctx.db, p.id, req.cardId)
    if (req.forTrade) {
      mustBeTradeable(c, ctx.now)
      if (!trusted(p, ctx.now)) fail('not_allowed', 'Trading opens once your account is 3 days old with 10 battles')
    } else mustBeHome(c)
    if (c.card.forTrade === req.forTrade) return { card: c.card }
    const next = { ...c.card, forTrade: req.forTrade }
    await commit(ctx, [cardGuard(c, 'owned'), saveCard(c, next), bumpCards(p.id)])
    return { card: next }
  })

  // Parent A gives the shape, B the family and colours (SPEC 4). A hybrid of a trade-locked parent
  // stays locked as long, so fusing never frees a welcome card early.
  apiRoute(api, 'fuse', async (ctx, req) => {
    const p = ctx.player
    if (req.cardId === req.otherId) fail('bad_request', 'Pick two different cards')
    const pair = await ownCards(ctx.db, p.id, [req.cardId, req.otherId])
    const a = pair[0]!, b = pair[1]!
    mustBeFree(a)
    mustBeFree(b)
    const cost = fusionCost(dailyRule(ctx.now))
    mustAfford(p, cost)
    const lock = Math.max(a.card.lockedUntil, b.card.lockedUntil)
    const minted = await mintCards(ctx, p.id, [fuse(a.card, b.card, rngOf(ctx), ctx.now)], lock > ctx.now ? { lockedUntil: lock } : {})
    await commit(ctx, [...takeCards(p, [a, b]), addSparks(p.id, -cost), ...minted.stmts])
    return { card: minted.cards[0]!, consumed: [a.card.id, b.card.id] as [string, string] }
  })

  // Shiny doubles, foil adds half again, a Mythic doubles once more (SPEC 6); bound cards stay.
  apiRoute(api, 'recycle', async (ctx, req) => {
    const p = ctx.player
    const c = await ownCard(ctx.db, p.id, req.cardId)
    mustBeFree(c)
    const gained = recycleValue(c.card)
    await commit(ctx, [...takeCards(p, [c]), addSparks(p.id, gained)])
    return { sparks: p.sparks + gained, gained }
  })

  // The current season only (SPEC 4); the season is read from the id before any species is looked up.
  apiRoute(api, 'craft', async (ctx, req) => {
    const p = ctx.player
    const species = seasonOfSpecies(req.speciesId) === seasonOf(ctx.now) ? getSpecies(req.speciesId) : undefined
    if (!species) fail('not_allowed', "Only this season's creatures can be crafted")
    if (!rarityFits(species, req.rarity)) fail('bad_request', species.legendary ? 'A legendary is always legendary' : 'Only legendaries come in legendary')
    const cost = craftCost(req.rarity)
    mustAfford(p, cost)
    const rng = rngOf(ctx)
    const fresh = mintCard({
      species, rarity: req.rarity, shiny: chance(rng, shinyChance(ctx.now)), dna: uint32(rng), origin: 'craft', now: ctx.now,
      foil: chance(rng, ECONOMY.foil.chance),
    })
    const minted = await mintCards(ctx, p.id, [fresh])
    await commit(ctx, [addSparks(p.id, -cost), ...minted.stmts])
    return { card: minted.cards[0]! }
  })

  // Any season that has begun: past seasons' cards still trade.
  apiRoute(api, 'setWishlist', async (ctx, req) => {
    const p = ctx.player
    if (req.species.some(s => seasonOfSpecies(s) > seasonOf(ctx.now))) fail('bad_request', 'That creature has not appeared yet')
    const now = (await ctx.db.all<{ species: string }>('SELECT species FROM wishes WHERE player_id = ? ORDER BY pos', p.id)).map(w => w.species)
    if (JSON.stringify(now) !== JSON.stringify(req.species)) {
      await commit(ctx, [
        stmt('DELETE FROM wishes WHERE player_id = ?', p.id),
        ...req.species.map((s, pos) => stmt('INSERT INTO wishes (player_id, species, pos) VALUES (?, ?, ?)', p.id, s, pos)),
      ])
    }
    return { wishlist: req.species }
  })

  // ---- the Wandering Trader (SPEC 19): three deals a day, each once per player per day ----

  apiRoute(api, 'trader', async ctx => ({ day: utcDay(ctx.now), deals: await traderView(ctx.db, ctx.player.id, ctx.now) }))

  apiRoute(api, 'traderDeal', async (ctx, req) => {
    const p = ctx.player
    const deals = await traderView(ctx.db, p.id, ctx.now)
    const k = deals.findIndex(d => d.id === req.dealId)
    const deal = deals[k] ?? notFound('deal')
    if (deal.used) fail('conflict', 'You made this deal today. The Trader brings new stock tomorrow')
    const cards = await ownCards(ctx.db, p.id, req.cardIds)
    const problem = traderGiveProblem(deal, cards.map(c => c.card), ctx.now)
    if (problem) fail('not_allowed', sentence(problem))
    const got = rollTraderDeal(deal, rngOf(ctx), ctx.now)
    const minted = await mintCards(ctx, p.id, got.cards)
    const packs = got.packs.map(f => grantPack(ctx, p.id, f, 'trader'))
    await commit(ctx, [...takeCards(p, cards), useDeal(p.id, ctx.now, k), ...minted.stmts, ...packs.map(g => g.stmt)])
    return { cards: minted.cards, packs: packs.map(g => g.pack), consumed: req.cardIds }
  })

  // ---- drops (SPEC 25) ----

  // Every attempt, right or wrong, spends from the address's exact counter (and the token's bucket),
  // so guessing is slow. A wrong code and a closed drop answer alike, so codes cannot be probed.
  apiRoute(api, 'redeem', async (ctx, req) => {
    const p = ctx.player
    const spend = await spendJoinCounter(ctx.db, 'redeem', ctx.addressKey, ctx.now)
    const refuse = async (code: 'not_found' | 'conflict' | 'cap_reached', message: string): Promise<never> => {
      await ctx.db.batch(spend)
      return fail(code, message)
    }
    const drop = await dropByCode(ctx.db, req.code)
    if (!drop || !dropLive(drop, ctx.now)) return refuse('not_found', 'No such code')
    if (await ctx.db.get('SELECT 1 FROM redemptions WHERE drop_id = ? AND player_id = ?', drop.id, p.id)) {
      return refuse('conflict', 'You already redeemed this code')
    }
    if (drop.supply !== null && drop.redeemed >= drop.supply) return refuse('cap_reached', 'Every one of these has found a home')
    const reward = dropReward(drop) ?? fail('unavailable', 'This code is resting, try again later')
    const bound = drop.bound === 1
    const got = mintDropReward(reward, rngOf(ctx), ctx.now, bound)
    const minted = await mintCards(ctx, p.id, got.cards, { bound })
    const packs = got.packs.map(f => grantPack(ctx, p.id, f, 'promo', { bound }))
    await commit(ctx, [...spend, ...redeemStmts(drop, p.id, ctx.now), ...minted.stmts, ...packs.map(g => g.stmt)])
    return { cards: minted.cards, packs: packs.map(g => g.pack) }
  }, { limit: 'redeem' })
}
