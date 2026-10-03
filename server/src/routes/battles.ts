// Battles (SPEC 5, 13-19, 24, 26, 32): start, finish and catch. The server picks the team, the
// opponent and the seed, re-simulates the inputs with the battle's own rules version and pays out in
// one guarded batch; the client only animates. Another player's battle answers 404 (SPEC 26.3).
// Pacing instead of quotas (SPEC 24): wild starts 8 minutes apart, duels 2, one open battle, and no
// finish sooner than the server's own replay could have played. A finish pays once; asked again,
// it answers what it answered the first time, so an answer lost on the way is never a lost result.
import { finishAfter } from '../../../plugin/hooks/core/economy.ts'
import type { Api } from '../app.ts'
import { fail, HttpError } from '../http.ts'
import { abandoned, autoSettle, closeBattle, finishedAgain, openBattleOf, ownBattle, prepareCatch, prepareStart, replay, settleBattle } from '../game/battles.ts'
import { apiRoute, commit, loadPlayer } from '../game/ctx.ts'
import { checkDuelStart, checkWildStart } from '../game/pacing.ts'

export function battles(api: Api): void {
  apiRoute(api, 'startBattle', async (ctx, req) => {
    if (req.kind === 'wild' && req.revenge !== undefined) fail('bad_request', 'A revenge is a duel')
    let p = ctx.player
    if (req.kind === 'wild') checkWildStart(p, ctx.now)
    else checkDuelStart(p, ctx.now)
    // one open battle at a time: the one left open settles first, with no inputs (SPEC 15)
    const open = await openBattleOf(ctx.db, p.id)
    if (open) {
      await commit(ctx, await autoSettle(ctx, open, p))
      p = (await loadPlayer(ctx.db, p.id)) ?? fail('unauthorized', 'Unauthorized')
    }
    const start = await prepareStart(ctx, p, req)
    await commit({ db: ctx.db, player: p }, start.stmts)
    return start.response
  })

  apiRoute(api, 'finishBattle', async (ctx, req) => {
    const b = await ownBattle(ctx.db, ctx.player.id, req.battleId)
    if (b.state === 'settled' && b.outcome) return finishedAgain(b, ctx.now)
    if (b.state !== 'open' || abandoned(b, ctx.now)) fail('conflict', 'That battle is already over')
    const log = replay(b, req.inputs)
    if (!log) {
      await commit(ctx, closeBattle(b, ctx.now))
      fail('conflict', 'That battle is already over')
    }
    // never sooner than the rounds the server's own replay of these inputs plays, at 1.5 s each (SPEC
    // 15), even when presses make it longer than the finishAfter the start gave: Retry-After says how long
    const ready = finishAfter(b.started_at, log.rounds.length)
    if (ctx.now < ready) {
      throw new HttpError('conflict', 'The battle is still playing', 409, { 'Retry-After': String(Math.ceil((ready - ctx.now) / 1000)) })
    }
    const settled = await settleBattle(ctx, b, ctx.player, 'finish', log)
    await commit(ctx, settled.stmts)
    return settled.response
  })

  apiRoute(api, 'catchCreature', async (ctx, req) => {
    const b = await ownBattle(ctx.db, ctx.player.id, req.battleId)
    const caught = await prepareCatch(ctx, ctx.player, b, req.index)
    await commit(ctx, caught.stmts)
    return { card: caught.card }
  })
}
