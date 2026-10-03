// The player's own state and the public facts of the world: version, world, frozen seasons, /v1/me,
// handle reroll, hiding from the leaderboards and deletion (SPEC 6, 7, 20, 32).
import { API_VERSION, FEATURES } from '../../../plugin/hooks/core/api.ts'
import type { MeResponse, PlayerView } from '../../../plugin/hooks/core/api.ts'
import { RULES_VERSION } from '../../../plugin/hooks/core/battle.ts'
import { leagueOf } from '../../../plugin/hooks/core/economy.ts'
import { GENERATOR_VERSION } from '../../../plugin/hooks/core/species.ts'
import { seasonOf, utcDay, worldOf } from '../../../plugin/hooks/core/world.ts'
import type { Api } from '../app.ts'
import type { Db } from '../db.ts'
import { HttpError } from '../http.ts'
import type { GiftRow, OfferRow, PlayerRow } from '../schema.ts'
import { deletionStmts, newHandle, rerollStmts, rerollWait } from '../game/auth.ts'
import { apiRoute, cached, commit, DAY, ensureSeason, notFound, playerGuard, publicRoute, setPlayer, teamOf } from '../game/ctx.ts'
import { listingsOf } from '../game/market.ts'
import { giftViews, offerViews, packsOf } from '../game/mint.ts'
import { noticesOf } from '../game/notices.ts'
import { handleRerollFrom, nextChargeAt, nextDuelAt, nextWildAt, restedNow } from '../game/pacing.ts'
import { statsOf } from '../game/stats.ts'

/** This server's release, and the newest mod it knows of (SPEC 32). */
export const SERVER_VERSION = '0.1.1'
export const LATEST_CLIENT = '0.1.1'

const OFFERS_SHOWN = 50

/**
 * Players seen today, rounded down to 50, 100, 200, 500, 1000 and so on (0 under 50): a world's
 * size, never a way to tell whether one particular player came by (SPEC 20.3).
 */
export function roughCount(n: number): number {
  if (n < 50) return 0
  const p = 10 ** Math.floor(Math.log10(n))
  return [5, 2, 1].map(m => m * p).find(v => v <= n)!
}
const GIFTS_SHOWN = 20

export function playerView(p: PlayerRow, now: number, extra: { wishlist: string[]; seen: string[] }): PlayerView {
  return {
    handle: p.handle,
    handleRerollFrom: handleRerollFrom(p, now),
    sparks: p.sparks,
    rating: p.rating,
    league: leagueOf(p.rating).name,
    leaderboard: p.board_hidden === 0,
    joinedDay: p.joined,
    battles: p.battles,
    // no account limits on trading any more (SPEC 8): a 0.1.0 mod reads this as its trust gate
    canTrade: true,
    team: teamOf(p),
    wishlist: extra.wishlist,
    cardsVersion: p.cards_version,
    streak: p.streak,
    seen: extra.seen,
    rested: restedNow(p, now),
    nextWildAt: nextWildAt(p),
    nextDuelAt: nextDuelAt(p),
    nextChargeAt: nextChargeAt(p, now),
    stats: statsOf(p),
  }
}

/** Everything the mod shows about its own player: GET /v1/me, and `me` in join and sign-in. */
export async function meResponse(db: Db, p: PlayerRow, now: number): Promise<MeResponse> {
  const [wishes, seen, packs, notices, incoming, outgoing, gifts, listings] = await Promise.all([
    db.all<{ species: string }>('SELECT species FROM wishes WHERE player_id = ? ORDER BY pos', p.id),
    db.all<{ species: string }>('SELECT species FROM album WHERE player_id = ? ORDER BY species', p.id),
    packsOf(db, p.id),
    noticesOf(db, p.id),
    db.all<OfferRow>(`SELECT * FROM offers WHERE to_id = ? AND state = 'open' ORDER BY expires_at DESC LIMIT ?`, p.id, OFFERS_SHOWN),
    db.all<OfferRow>(`SELECT * FROM offers WHERE from_id = ? AND state = 'open' ORDER BY expires_at DESC LIMIT ?`, p.id, OFFERS_SHOWN),
    db.all<GiftRow>(`SELECT * FROM gifts WHERE giver_id = ? AND state = 'open' ORDER BY created DESC, code LIMIT ?`, p.id, GIFTS_SHOWN),
    listingsOf(db, p.id),
  ])
  return {
    player: playerView(p, now, { wishlist: wishes.map(w => w.species), seen: seen.map(s => s.species) }),
    packs,
    notices,
    offers: { incoming: await offerViews(db, incoming), outgoing: await offerViews(db, outgoing) },
    gifts: await giftViews(db, gifts),
    listings,
    now,
  }
}

export function account(api: Api): void {
  publicRoute(api, 'version', async ctx => cached({
    api: API_VERSION,
    server: SERVER_VERSION,
    rules: RULES_VERSION,
    generator: GENERATOR_VERSION,
    minClient: ctx.config.minClient,
    latestClient: LATEST_CLIENT,
    features: [...FEATURES],
  }, 3600))

  publicRoute(api, 'world', async ctx => {
    const seen = (await ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM players WHERE last_seen >= ?', utcDay(ctx.now - DAY)))!.n
    return cached({ ...worldOf(ctx.now), players: roughCount(seen) }, 300)
  })

  // Immutable once made (SPEC 32): a past or current season, never one still to come.
  publicRoute(api, 'season', async (ctx, req) => {
    if (req.season > seasonOf(ctx.now)) notFound('season')
    const { generator, species } = await ensureSeason(ctx.db, req.season)
    return cached({ season: req.season, generator, species }, 31_536_000)
  })

  apiRoute(api, 'me', async ctx => meResponse(ctx.db, ctx.player, ctx.now))

  apiRoute(api, 'deleteMe', async ctx => {
    await ctx.db.batch([playerGuard(ctx.player), ...deletionStmts(ctx.player, ctx.now)])
    return { deleted: true as const }
  }, { touch: false })

  apiRoute(api, 'rerollHandle', async ctx => {
    const p = ctx.player
    const wait = rerollWait(handleRerollFrom(p, ctx.now), ctx.now)
    if (wait > 0) throw new HttpError('rate_limited', 'A new handle once a week', 429, { 'Retry-After': String(Math.ceil(wait / 1000)) })
    const handle = await newHandle(ctx)
    await commit(ctx, rerollStmts(p, handle, ctx.now))
    return { handle, handleRerollFrom: handleRerollFrom({ handle_day: utcDay(ctx.now) }, ctx.now) }
  }, { touch: false })

  // Every player is on the leaderboards unless they hide (SPEC 20); hiding also takes their stats off
  // their profile. The old opt-in column follows along, so a rolled-back server keeps the choice.
  apiRoute(api, 'setLeaderboard', async (ctx, req) => {
    if ((ctx.player.board_hidden === 0) !== req.optIn) {
      await commit(ctx, [setPlayer(ctx.player.id, { board_hidden: !req.optIn, leaderboard: req.optIn })])
    }
    return { leaderboard: req.optIn }
  }, { touch: false })
}
