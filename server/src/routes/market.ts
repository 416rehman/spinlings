// The market and the leaderboards (SPEC 8, 20, 26): listing, browsing, buying and taking a card off the market,
// and every board with the caller's own rank. Reads skip touch; every change is one guarded batch
// (game/market.ts) that a Conflict re-runs from its reads. Listings past their day lapse on the seller's touch and
// on the hourly sweep (game/social-touch.ts).
import type { Api } from '../app.ts'
import { apiRoute } from '../game/ctx.ts'
import { browse, buyListing, cancelListing, listCard } from '../game/market.ts'
import { rankings } from '../game/stats.ts'

export function market(api: Api): void {
  apiRoute(api, 'market', async (ctx, req) => browse(ctx, req), { touch: false, limit: 'browse' })
  apiRoute(api, 'listCard', async (ctx, req) => ({ listing: await listCard(ctx, req) }))
  apiRoute(api, 'buyListing', async (ctx, req) => buyListing(ctx, req.listingId, req.cardId))
  apiRoute(api, 'cancelListing', async (ctx, req) => ({ listing: await cancelListing(ctx, req.listingId) }))

  apiRoute(api, 'rankings', async (ctx, req) => rankings(ctx.db, ctx.player, req.board ?? 'rating', req.period ?? 'all', ctx.now),
    { touch: false, limit: 'browse' })
}
