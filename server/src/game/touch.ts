// Touch: what happens on the player's behalf before GET /v1/me and every mutation (any authenticated
// route without `touch: false`). Each step reads the fresh player row and returns its writes; touch
// commits each step's writes as one batch behind the player's version guard, then re-reads the row
// for the next. A Conflict anywhere re-runs the whole request (app.ts). Steps must cost no query
// when there is nothing to do, and write the player row relatively (col = col + ?) where they can.
import { ECONOMY, seasonEnd } from '../../../plugin/hooks/core/economy.ts'
import { FAMILIES } from '../../../plugin/hooks/core/families.ts'
import { pick } from '../../../plugin/hooks/core/rng.ts'
import { mintFor } from '../../../plugin/hooks/core/trader.ts'
import { seasonOf, utcDay } from '../../../plugin/hooks/core/world.ts'
import type { Api, PlayerCtx } from '../app.ts'
import type { Stmt } from '../db.ts'
import { fail } from '../http.ts'
import type { PlayerRow } from '../schema.ts'
import { battleTouch } from './battles-touch.ts'
import { addSparks, commit, ensureSeason, loadPlayer, rngOf, setPlayer } from './ctx.ts'
import { grantPack, mintCards } from './mint.ts'
import { NOTICE_TEXT, notice } from './notices.ts'
import { socialTouch } from './social-touch.ts'

/** One touch step: the writes to commit for this player now, or [] (the usual case). */
export type TouchStep = (ctx: PlayerCtx) => Promise<Stmt[]>

/** The daily hello: 10 sparks on the player's first touch of each UTC day (joining pays the first day). */
export const dailyHello: TouchStep = async ctx => {
  const day = utcDay(ctx.now)
  if (ctx.player.hello_day === day) return []
  return [addSparks(ctx.player.id, ECONOMY.sparks.dailyHello), setPlayer(ctx.player.id, { hello_day: day })]
}

/**
 * Season end (SPEC 14), once, on the player's first touch in a new season: reward packs by the
 * league of their final rating, a foil legendary for Star, the soft reset, and a notice.
 */
export const seasonTurn: TouchStep = async ctx => {
  const p = ctx.player
  const season = seasonOf(ctx.now)
  if (p.season >= season) return []
  const end = seasonEnd(p.rating)
  const rng = rngOf(ctx)
  const stmts: Stmt[] = []
  for (let i = 0; i < end.packs; i++) stmts.push(grantPack(ctx, p.id, pick(rng, FAMILIES), 'season').stmt)
  if (end.legendary) stmts.push(...(await mintCards(ctx, p.id, [mintFor(pick(rng, FAMILIES), 'legendary', rng, ctx.now, 'season')])).stmts)
  stmts.push(notice(ctx, p.id, 'season-end', NOTICE_TEXT.seasonEnd(p.season, end.league, end.packs, end.legendary)))
  stmts.push(setPlayer(p.id, { season, rating: end.rating }))
  return stmts
}

/**
 * In order: the daily hello, a battle left open settling (so one won before midnight still counts
 * for the season it was fought in), the season end, then the social step.
 */
export const TOUCH_STEPS: readonly TouchStep[] = [dailyHello, battleTouch, seasonTurn, socialTouch]

/** Runs every step for the player; the fresh row when anything was written, so the handler gets it. */
export async function onTouch(ctx: PlayerCtx): Promise<PlayerRow | void> {
  await ensureSeason(ctx.db, seasonOf(ctx.now))
  let p = ctx.player
  let changed = false
  for (const step of TOUCH_STEPS) {
    const at: PlayerCtx = { ...ctx, player: p }
    const stmts = await step(at)
    if (!stmts.length) continue
    await commit(at, stmts)
    p = (await loadPlayer(ctx.db, p.id)) ?? fail('unauthorized', 'Unauthorized')
    changed = true
  }
  if (changed) return p
}

export function registerTouch(api: Api): void {
  api.onTouch(onTouch)
}
