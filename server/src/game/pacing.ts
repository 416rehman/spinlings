// Server pacing and trust (SPEC 15, 24): no daily quotas anywhere, only spacing between starts, the
// pack bank, the pair limit, the minimum battle duration and the one-time trust gate. Everything is
// computed from the player row the handler already read, so the version guard keeps it exact.
import { ECONOMY, canTrade, chargeSpacingMs, finishAfter, isRested, pairCounts } from '../../../plugin/hooks/core/economy.ts'
import { utcDay } from '../../../plugin/hooks/core/world.ts'
import { stmt } from '../db.ts'
import type { Db, Stmt } from '../db.ts'
import { HttpError } from '../http.ts'
import type { PlayerRow } from '../schema.ts'
import { addDays, DAY, dayStart, readJson, setPlayer } from './ctx.ts'

export { finishAfter, pairCounts }

const B = ECONOMY.battle

/** Refuses with 429 rate_limited and a Retry-After until `at`. */
export function waitUntil(at: number, now: number, message: string): void {
  if (now < at) throw new HttpError('rate_limited', message, 429, { 'Retry-After': String(Math.ceil((at - now) / 1000)) })
}

// ---- battles -----------------------------------------------------------------------------------

/** The last battle start of either kind (ms, 0 = never): the rested bonus counts from it. */
export const lastBattleAt = (p: Pick<PlayerRow, 'last_wild_at' | 'last_duel_at'>): number => Math.max(p.last_wild_at, p.last_duel_at)

/**
 * The next wild lead is rare or better after 4 hours without a battle (SPEC 17); the client cannot
 * claim it. A player who has never finished one is new, not back from a break. The sweep zeroes
 * start marks a day old, which reads as long ago.
 */
export const restedNow = (p: Pick<PlayerRow, 'battles' | 'last_wild_at' | 'last_duel_at'>, now: number): boolean =>
  p.battles > 0 && isRested(lastBattleAt(p), now)

export const nextWildAt = (p: Pick<PlayerRow, 'last_wild_at'>): number => (p.last_wild_at ? p.last_wild_at + B.wildSpacingMs : 0)
export const nextDuelAt = (p: Pick<PlayerRow, 'last_duel_at'>): number => (p.last_duel_at ? p.last_duel_at + B.duelSpacingMs : 0)

/** A wild start 8 minutes or more after the previous one, a duel 2 minutes (revenge included). */
export const checkWildStart = (p: PlayerRow, now: number) => waitUntil(nextWildAt(p), now, 'Nothing is rustling yet')
export const checkDuelStart = (p: PlayerRow, now: number) => waitUntil(nextDuelAt(p), now, 'Your team is catching its breath')

/** Records a battle start for the spacing; put it in the start's batch. */
export const markWildStart = (p: Pick<PlayerRow, 'id'>, now: number): Stmt => setPlayer(p.id, { last_wild_at: now })
export const markDuelStart = (p: Pick<PlayerRow, 'id'>, now: number): Stmt => setPlayer(p.id, { last_duel_at: now })

/**
 * A finished battle (any kind): the count the trust gate and the gift bonus read, and the distinct
 * days with a finished battle. Relative, so it composes with other writes to the row.
 */
export const battleFinished = (playerId: string, now: number): Stmt => {
  const day = utcDay(now)
  return stmt(
    'UPDATE players SET battles = battles + 1, battle_days = battle_days + (battle_day != ?), battle_day = ? WHERE id = ?',
    day, day, playerId,
  )
}

/** Earlier finished duels between the two accounts in the last 24 hours; pairCounts(n) says whether this one moves rating and defense sparks. */
export async function pairDuels(db: Db, a: string, b: string, now: number): Promise<number> {
  const since = now - B.pairWindowMs
  return (await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM battles WHERE kind = 'duel' AND state = 'settled' AND started_at > ?
       AND ((attacker_id = ? AND defender_id = ?) OR (attacker_id = ? AND defender_id = ?))`,
    since, a, b, b, a,
  ))!.n
}

/** The daily first win pays a pack once per UTC day. */
export const firstWinDue = (p: Pick<PlayerRow, 'first_win_day'>, now: number): boolean => p.first_win_day !== utcDay(now)
export const markFirstWin = (p: Pick<PlayerRow, 'id'>, now: number): Stmt => setPlayer(p.id, { first_win_day: utcDay(now) })

// ---- pack charges ------------------------------------------------------------------------------

/** Accepted charges in the last 24 hours (ms). */
export const recentCharges = (p: Pick<PlayerRow, 'charges'>, now: number): number[] =>
  readJson<number[]>(p.charges, []).filter(t => typeof t === 'number' && t > now - DAY)

/** The earliest the next charge is accepted: 45 minutes on, 90 beyond 16 charges in 24 hours (0 = now). */
export function nextChargeAt(p: Pick<PlayerRow, 'last_charge_at' | 'charges'>, now: number): number {
  return p.last_charge_at ? p.last_charge_at + chargeSpacingMs(recentCharges(p, now).length) : 0
}

/** Refuses a charge too soon (rate_limited) or into a full bank (cap_reached). */
export function checkCharge(p: PlayerRow, now: number, unopened: number): void {
  if (unopened >= ECONOMY.packs.bank) throw new HttpError('cap_reached', 'Open some packs to make room', 429)
  waitUntil(nextChargeAt(p, now), now, 'Your lamp needs a little longer')
}

/** Records an accepted charge; put it in the charge's batch. */
export const markCharge = (p: PlayerRow, now: number): Stmt =>
  setPlayer(p.id, { last_charge_at: now, charges: JSON.stringify([...recentCharges(p, now), now]) })

// ---- trust and handles -------------------------------------------------------------------------

/**
 * The trust gate for trading and sending gifts (SPEC 30): 3 calendar days since the join day and 10
 * finished battles. Claiming a gift needs nothing.
 */
export const trusted = (p: Pick<PlayerRow, 'joined' | 'battles'>, now: number): boolean => canTrade(dayStart(p.joined), p.battles, now)

/** The UTC day from which the handle may be rerolled again: a week after the last reroll. */
export const handleRerollFrom = (p: Pick<PlayerRow, 'handle_day'>, now: number): string =>
  p.handle_day ? addDays(p.handle_day, ECONOMY.handleRerollMs / DAY) : utcDay(now)
