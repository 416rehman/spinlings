// Social (SPEC 8, 19, 20, 24, 26, 30): profiles, the opt-in leaderboard, the trade board, offers,
// gifts and claims. Reads skip touch; every change is one guarded batch (game/social.ts) that a
// Conflict re-runs from its reads. Lapsed offers and gifts settle on their owner's touch and, for
// players who never come back, on the hourly sweep (game/social-touch.ts). Handle rerolls and the
// leaderboard opt-in live in routes/account.ts; drop codes in routes/collection.ts.
import type { Api } from '../app.ts'
import { apiRoute, commit, notFound } from '../game/ctx.ts'
import {
  acceptOffer, cancelGift, cancelOffer, checkOffer, claimGift, counterOffer, declineOffer, liveOffer, makeGift, mustTrade,
  playerByHandle, sendOffer, SOCIAL_TEXT,
} from '../game/social.ts'
import { boardFor, leaderboardTop, profileOf } from '../game/social-board.ts'
import { sweepSocial } from '../game/social-touch.ts'

export function social(api: Api): void {
  // Handles are looked up only by exact match, and every lookup spends from the profile bucket (SPEC 26.4).
  apiRoute(api, 'profile', async (ctx, req) => (await profileOf(ctx.db, req.handle, ctx.now)) ?? notFound('player'), { touch: false, limit: 'profile' })
  apiRoute(api, 'leaderboard', async ctx => leaderboardTop(ctx.db), { touch: false })
  apiRoute(api, 'board', async ctx => boardFor(ctx), { touch: false, limit: 'board' })

  apiRoute(api, 'offer', async (ctx, req) => {
    mustTrade(ctx.player, ctx.now)
    const to = (await playerByHandle(ctx.db, req.to)) ?? notFound('player')
    const sent = sendOffer(ctx, await checkOffer(ctx, to, req.give, req.get), SOCIAL_TEXT.offerReceived)
    await commit(ctx, sent.stmts)
    return { offer: sent.view }
  }, { limit: 'profile' })

  apiRoute(api, 'acceptOffer', async (ctx, req) => ({ offer: await acceptOffer(ctx, await liveOffer(ctx, req.offerId, 'to')) }))
  apiRoute(api, 'declineOffer', async (ctx, req) => ({ offer: await declineOffer(ctx, await liveOffer(ctx, req.offerId, 'to')) }))
  apiRoute(api, 'cancelOffer', async (ctx, req) => ({ offer: await cancelOffer(ctx, await liveOffer(ctx, req.offerId, 'from')) }))
  apiRoute(api, 'counterOffer', async (ctx, req) => ({
    offer: await counterOffer(ctx, await liveOffer(ctx, req.offerId, 'to'), req.give, req.get),
  }))

  apiRoute(api, 'gift', async (ctx, req) => ({ gift: await makeGift(ctx, req.cardId) }))
  apiRoute(api, 'cancelGift', async (ctx, req) => ({ gift: await cancelGift(ctx, req.code) }))
  apiRoute(api, 'claim', async (ctx, req) => ({ card: await claimGift(ctx, req.code) }), { limit: 'claim' })

  api.onSweep(sweepSocial)
}
