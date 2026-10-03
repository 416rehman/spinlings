// The offline world's first run and its touch: what happens on the player's behalf before every operation, the same
// steps the server takes (SPEC 6, 14, 15): the daily hello, the season-end grant, a battle left open settling. Plus the
// save's own upkeep: old notices and charges go, and a nearly full collection says so once.
import type { Family } from '../../core/types.ts'
import { starterTeam } from '../../core/cards.ts'
import { ECONOMY, seasonEnd } from '../../core/economy.ts'
import { FAMILIES } from '../../core/families.ts'
import { otherFamily } from '../../core/packs.ts'
import { pick } from '../../core/rng.ts'
import { GENERATOR_VERSION } from '../../core/species.ts'
import { mintFor } from '../../core/trader.ts'
import { DAY_MS, seasonOf, utcDay } from '../../core/world.ts'
import { sweepBattle } from './battles.ts'
import type { Ctx } from './state.ts'
import { addCards, addNotice, grantPack, hasRoom, recentCharges, TEXT } from './state.ts'
import type { LocalState } from './save.ts'
import { blankState, LIMITS } from './save.ts'

/**
 * A new offline save (SPEC 6, First run): the bound starter team saved as the team, two welcome packs (this family
 * and one other) whose cards open trade-locked for 7 days, 100 sparks, and today's hello already counted. Hatching
 * counts as a charge, as joining does online: the welcome packs are the first payoff, and the lamp starts from here.
 */
export function firstRun(ctx: Ctx, family: Family): LocalState {
  const { now, rng } = ctx
  const day = utcDay(now)
  const s = blankState(day)
  s.sparks = ECONOMY.sparks.start
  s.rating = ECONOMY.rating.start
  s.season = seasonOf(now)
  s.helloDay = day
  s.lastChargeAt = now
  s.generators[String(s.season)] = GENERATOR_VERSION
  s.team = addCards(s, ctx, starterTeam(family, rng, now), { bound: true }).map(c => c.id)
  const lockUntil = now + ECONOMY.welcomeLockMs
  for (const f of [family, otherFamily(family, rng)]) grantPack(s, ctx, f, 'welcome', { lockUntil })
  return s
}

/** Season end (SPEC 14), once: reward packs by the final league, a foil legendary for Star, the soft reset, a notice. */
function seasonTurn(s: LocalState, ctx: Ctx, season: number): void {
  const end = seasonEnd(s.rating)
  for (let i = 0; i < end.packs; i++) grantPack(s, ctx, pick(ctx.rng, FAMILIES), 'season')
  const legendary = end.legendary && hasRoom(s, 1, true)
  if (legendary) addCards(s, ctx, [mintFor(pick(ctx.rng, FAMILIES), 'legendary', ctx.rng, ctx.now, 'season')])
  addNotice(s, ctx, 'season-end',
    `Season ${s.season} ended in ${end.league}: ${end.packs} reward pack${end.packs === 1 ? '' : 's'}${legendary ? ' and a foil legendary' : ''}!`)
  s.rating = end.rating
  s.season = season
}

/** Runs every touch step; true when the save changed. */
export function touch(s: LocalState, ctx: Ctx): boolean {
  const { now } = ctx
  const day = utcDay(now)
  const season = seasonOf(now)
  let changed = false
  if (s.helloDay !== day) {
    s.sparks += ECONOMY.sparks.dailyHello
    s.helloDay = day
    changed = true
  }
  if (s.season < season) {
    seasonTurn(s, ctx, season)
    changed = true
  }
  if (s.generators[String(season)] === undefined) {
    s.generators[String(season)] = GENERATOR_VERSION
    changed = true
  }
  if (sweepBattle(s, ctx)) changed = true
  const oldest = utcDay(now - 30 * DAY_MS)
  const notices = s.notices.filter(n => n.day >= oldest)
  const charges = recentCharges(s, now)
  if (notices.length !== s.notices.length || charges.length !== s.charges.length) {
    s.notices = notices
    s.charges = charges
    changed = true
  }
  if (!s.nearFull && s.cards.length >= LIMITS.nearFull) {
    addNotice(s, ctx, 'notice', TEXT.nearFull)
    s.nearFull = true
    changed = true
  } else if (s.nearFull && s.cards.length < LIMITS.nearFull - 200) {
    s.nearFull = false
    changed = true
  }
  return changed
}
